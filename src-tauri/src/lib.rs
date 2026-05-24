use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

static CURRENT_CHILD: Mutex<Option<CommandChild>> = Mutex::new(None);

#[derive(Serialize, Deserialize, Clone)]
pub struct Region {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct VideoOperation {
    pub mode: String,                 // "blur" | "crop" | "text"
    pub region: Option<Region>,       // required for blur/crop
    pub blur_strength: Option<u32>,
    // Time range (in seconds). If None → apply to entire video
    pub start_time: Option<f64>,
    pub end_time: Option<f64>,
    // For text mode
    pub text: Option<String>,
    pub font_size: Option<u32>,
    pub font_color: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct RemoveLogoRequest {
    pub input_path: String,
    pub output_path: String,
    pub operations: Vec<VideoOperation>,
    pub video_duration: Option<f64>,
    // For image overlays (future full support)
    pub extra_images: Option<Vec<String>>,
}

#[tauri::command]
async fn remove_logo(app: tauri::AppHandle, req: RemoveLogoRequest) -> Result<String, String> {
    if req.operations.is_empty() {
        return Err("No operations provided".into());
    }

    let shell = app.shell();

    let ffmpeg = shell
        .sidecar("ffmpeg")
        .map_err(|e| format!("ffmpeg sidecar not found: {}", e))?;

    // === Build dynamic multi-operation filter graph ===
    let mut filter_parts: Vec<String> = vec![];
    let mut current_input = "[0:v]".to_string();

    for (i, op) in req.operations.iter().enumerate() {
        let label = format!("op{}", i);
        let enable = match (op.start_time, op.end_time) {
            (Some(s), Some(e)) => format!(":enable='between(t,{},{})'", s, e),
            (Some(s), None)    => format!(":enable='gte(t,{})'", s),
            (None, Some(e))    => format!(":enable='lte(t,{})'", e),
            _ => "".to_string(),
        };

        match op.mode.as_str() {
            "blur" => {
                let r = op.region.as_ref().ok_or("Blur requires region")?;
                let blur = op.blur_strength.unwrap_or(20);

                let main_label = format!("main{}", i);
                let logo_label = format!("logo{}", i);
                let blurred_label = format!("blurred{}", i);

                filter_parts.push(format!(
                    "{}split[{}][{}];[{}]crop={}:{}:{}:{}{},boxblur={}:1[{}];[{}][{}]overlay={}:{}[{}]",
                    current_input,
                    main_label, logo_label,
                    logo_label, r.w, r.h, r.x, r.y, enable, blur, blurred_label,
                    main_label, blurred_label, r.x, r.y, label
                ));
                current_input = format!("[{}]", label);
            }
            "crop" => {
                let r = op.region.as_ref().ok_or("Crop requires region")?;
                filter_parts.push(format!(
                    "{}crop={}:{}:{}:{}{}[{}]",
                    current_input, r.w, r.h, r.x, r.y, enable, label
                ));
                current_input = format!("[{}]", label);
            }
            "text" => {
                let r = op.region.as_ref().ok_or("Text requires region (position)")?;
                let txt = op.text.as_deref().unwrap_or("Text");
                let size = op.font_size.unwrap_or(24);
                let color = op.font_color.as_deref().unwrap_or("white");

                // Polished drawtext with background box + time range support
                filter_parts.push(format!(
                    "{}drawtext=text='{}':x={}:y={}:fontsize={}:fontcolor={}:box=1:boxcolor=black@0.65:boxborderw=8{}{}[{}]",
                    current_input,
                    txt.replace("'", "\\'"),
                    r.x, r.y, size, color, enable,
                    label
                ));
                current_input = format!("[{}]", label);
            }
            "image" => {
                let r = op.region.as_ref().ok_or("Image overlay requires region")?;
                // If extra_images provided, use the first available image as overlay source
                let img_index = 1; // 0 = main video, 1+ = extra images
                filter_parts.push(format!(
                    "{}[{}]scale={}:{}[scaled{}];[scaled{}]overlay={}:{}[{}]",
                    current_input,
                    img_index, r.w, r.h, i,
                    i, r.x, r.y, label
                ));
                current_input = format!("[{}]", label);
            }
            _ => return Err(format!("Unknown mode: {}", op.mode)),
        }
    }

    let filter_complex = filter_parts.join(";");

    // Build command
    let mut cmd = ffmpeg.args(["-y", "-i", &req.input_path]);

    // Optimization for single simple crop
    if req.operations.len() == 1 && req.operations[0].mode == "crop" {
        let op = &req.operations[0];
        if let Some(r) = &op.region {
            cmd = cmd.args(["-vf", &format!("crop={}:{}:{}:{}", r.w, r.h, r.x, r.y)]);
        }
    } else {
        cmd = cmd.args(["-filter_complex", &filter_complex]);
    }

    let (mut rx, child) = cmd
        .args(["-c:a", "copy", "-c:v", "libx264", "-preset", "fast", &req.output_path])
        .spawn()
        .map_err(|e| e.to_string())?;

    // Store child for cancellation (simple global for MVP)
    {
        let mut guard = CURRENT_CHILD.lock().unwrap();
        *guard = Some(child);
    }

    // Progress + ETA
    let mut last_speed: Option<f64> = None;
    let total_duration = req.video_duration.unwrap_or(0.0);

    while let Some(event) = rx.recv().await {
        if let tauri_plugin_shell::process::CommandEvent::Stderr(line) = event {
            let line = String::from_utf8_lossy(&line);

            if let Some(time) = parse_ffmpeg_time(&line) {
                if let Some(sp) = parse_ffmpeg_speed(&line) {
                    last_speed = Some(sp);
                }

                let eta = if let (Some(speed), true) = (last_speed, total_duration > 0.0) {
                    let remaining = (total_duration - time) / speed.max(0.1);
                    Some(remaining)
                } else {
                    None
                };

                let _ = app.emit("ffmpeg-progress", serde_json::json!({
                    "current": time,
                    "speed": last_speed,
                    "eta": eta
                }));
            }
        }
    }

    Ok(req.output_path)
}

fn parse_ffmpeg_speed(line: &str) -> Option<f64> {
    if let Some(pos) = line.find("speed=") {
        let rest = &line[pos + 6..];
        let speed_str = rest.split('x').next()?;
        return speed_str.trim().parse().ok();
    }
    None
}

#[tauri::command]
fn cancel_processing() {
    if let Some(child) = CURRENT_CHILD.lock().unwrap().take() {
        let _ = child.kill();
    }
}

#[tauri::command]
async fn get_video_info(app: tauri::AppHandle, path: String) -> Result<serde_json::Value, String> {
    let shell = app.shell();
    // Try to use ffprobe from the same sidecar location
    let ffprobe = shell.sidecar("ffprobe")
        .map_err(|_| "ffprobe not bundled yet (use same build as ffmpeg)".to_string())?;

    let output = ffprobe
        .args(["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", &path])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let json: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| e.to_string())?;

    Ok(json)
}

fn parse_ffmpeg_time(line: &str) -> Option<f64> {
    // Looks for: time=00:01:23.45
    if let Some(pos) = line.find("time=") {
        let rest = &line[pos + 5..];
        let time_str = rest.split_whitespace().next()?;
        let parts: Vec<&str> = time_str.split(':').collect();
        if parts.len() == 3 {
            let h: f64 = parts[0].parse().ok()?;
            let m: f64 = parts[1].parse().ok()?;
            let s: f64 = parts[2].parse().ok()?;
            return Some(h * 3600.0 + m * 60.0 + s);
        }
    }
    None
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![greet, remove_logo, cancel_processing, get_video_info])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
