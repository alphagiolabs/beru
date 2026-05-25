use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

#[derive(Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
enum OperationMode {
    Blur,
    Crop,
    Text,
    Image,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Region {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct VideoOperation {
    pub mode: OperationMode,
    pub region: Option<Region>,
    pub blur_strength: Option<u32>,
    pub start_time: Option<f64>,
    pub end_time: Option<f64>,
    pub text: Option<String>,
    pub font_size: Option<u32>,
    pub font_color: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
enum SpeedPreset {
    Ultrafast,
    Superfast,
    Veryfast,
    Fast,
    Medium,
}

impl SpeedPreset {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Ultrafast => "ultrafast",
            Self::Superfast => "superfast",
            Self::Veryfast => "veryfast",
            Self::Fast => "fast",
            Self::Medium => "medium",
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct VideoJob {
    pub input_path: String,
    pub output_path: String,
    pub operations: Vec<VideoOperation>,
    pub video_duration: Option<f64>,
    pub speed_preset: Option<SpeedPreset>,
    pub original_index: Option<usize>,
}

struct JobRegistry {
    jobs: HashMap<usize, CommandChild>,
}

impl JobRegistry {
    fn new() -> Self {
        Self { jobs: HashMap::new() }
    }
    fn register(&mut self, index: usize, child: CommandChild) {
        self.jobs.insert(index, child);
    }
    fn remove(&mut self, index: usize) -> Option<CommandChild> {
        self.jobs.remove(&index)
    }
    fn kill_all(&mut self) {
        for (_, child) in self.jobs.drain() {
            let _ = child.kill();
        }
    }
}

static ACTIVE_JOBS: Mutex<Option<JobRegistry>> = Mutex::new(None);

fn ensure_even(v: f64) -> u32 {
    (v as u32) & !1
}

fn crop_filter_arg(r: &Region) -> String {
    format!("{}:{}:{}:{}", ensure_even(r.w), ensure_even(r.h), ensure_even(r.x), ensure_even(r.y))
}

fn parse_hhmmss(s: &str) -> Option<f64> {
    let parts: Vec<&str> = s.trim().split(':').collect();
    if parts.len() == 3 {
        let h: f64 = parts[0].parse().ok()?;
        let m: f64 = parts[1].parse().ok()?;
        let s: f64 = parts[2].parse().ok()?;
        return Some(h * 3600.0 + m * 60.0 + s);
    }
    None
}

fn build_filter_graph(operations: &[VideoOperation]) -> Result<String, String> {
    let mut filter_parts: Vec<String> = vec![];
    let mut current_input = "[0:v]".to_string();

    for (i, op) in operations.iter().enumerate() {
        let label = format!("op{}", i);
        let enable = match (op.start_time, op.end_time) {
            (Some(s), Some(e)) => format!(":enable='between(t,{},{})'", s, e),
            (Some(s), None) => format!(":enable='gte(t,{})'", s),
            (None, Some(e)) => format!(":enable='lte(t,{})'", e),
            _ => String::new(),
        };

        match &op.mode {
            OperationMode::Blur => {
                let r = op.region.as_ref().ok_or("Blur requires region")?;
                let blur = op.blur_strength.unwrap_or(20);
                let crop = crop_filter_arg(r);
                let x = r.x as u32;
                let y = r.y as u32;
                filter_parts.push(format!(
                    "{inp}split[m{i}][lg{i}];[lg{i}]crop={crop}{en},boxblur={blur}:1[b{i}];[m{i}][b{i}]overlay={x}:{y}[{out}]",
                    inp = current_input, i = i, crop = crop, en = enable, blur = blur, x = x, y = y, out = label
                ));
                current_input = format!("[{}]", label);
            }
            OperationMode::Crop => {
                let r = op.region.as_ref().ok_or("Crop requires region")?;
                let crop = crop_filter_arg(r);
                filter_parts.push(format!("{}crop={}{en}[{lbl}]",
                    current_input, crop, en = enable, lbl = label
                ));
                current_input = format!("[{}]", label);
            }
            OperationMode::Text => {
                let r = op.region.as_ref().ok_or("Text requires region")?;
                let txt = op.text.as_deref().unwrap_or("Text");
                let size = op.font_size.unwrap_or(24);
                let color = op.font_color.as_deref().unwrap_or("white");
                let escaped = txt
                    .replace('\\', "\\\\")
                    .replace(':', "\\:")
                    .replace('\'', "'\\''");
                filter_parts.push(format!(
                    "{}drawtext=text='{}':x={}:y={}:fontsize={}:fontcolor={}:box=1:boxcolor=black@0.65:boxborderw=8{}[{}]",
                    current_input, escaped, r.x as u32, r.y as u32, size, color, enable, label
                ));
                current_input = format!("[{}]", label);
            }
            OperationMode::Image => {
                let r = op.region.as_ref().ok_or("Image overlay requires region")?;
                filter_parts.push(format!(
                    "[{idx}]scale={w}:{h}[s{i}];[s{i}]overlay={x}:{y}[{lbl}]",
                    idx = i + 1, w = ensure_even(r.w), h = ensure_even(r.h), i = i, x = r.x as u32, y = r.y as u32, lbl = label
                ));
                current_input = format!("[{}]", label);
            }
        }
    }

    Ok(filter_parts.join(";"))
}

fn parse_ffmpeg_time(line: &str) -> Option<f64> {
    let pos = line.find("time=")?;
    let rest = &line[pos + 5..];
    let time_str = rest.split_whitespace().next()?;
    parse_hhmmss(time_str)
}

fn parse_ffmpeg_speed(line: &str) -> Option<f64> {
    let pos = line.find("speed=")?;
    let rest = &line[pos + 6..];
    let speed_str = rest.split('x').next()?;
    speed_str.trim().parse().ok()
}

async fn process_single_job(
    app: tauri::AppHandle,
    job: VideoJob,
    job_index: usize,
) -> Result<String, String> {
    let shell = app.shell();
    let ffmpeg = shell
        .sidecar("ffmpeg")
        .map_err(|e| format!("ffmpeg sidecar not found: {}", e))?;

    let preset = job.speed_preset.as_ref().map(|p| p.as_str()).unwrap_or("ultrafast");
    let filter_complex = build_filter_graph(&job.operations)?;

    let mut cmd = ffmpeg.args(["-y", "-i", &job.input_path]);

    // Single-crop shortcut: use -vf instead of -filter_complex
    if job.operations.len() == 1 && job.operations[0].mode == OperationMode::Crop {
        if let Some(r) = &job.operations[0].region {
            cmd = cmd.args(["-vf", &format!("crop={}", crop_filter_arg(r))]);
        }
    } else {
        cmd = cmd.args(["-filter_complex", &filter_complex]);
    }

    let (mut rx, child) = cmd
        .args([
            "-c:a", "copy",
            "-c:v", "libx264",
            "-preset", preset,
            "-crf", "23",
            "-movflags", "+faststart",
            "-threads", "0",
            &job.output_path,
        ])
        .spawn()
        .map_err(|e| e.to_string())?;

    {
        let mut guard = ACTIVE_JOBS.lock().unwrap();
        guard.get_or_insert_with(JobRegistry::new).register(job_index, child);
    }

    let mut last_speed: Option<f64> = None;
    let total_duration = job.video_duration.unwrap_or(0.0);

    while let Some(event) = rx.recv().await {
        if let tauri_plugin_shell::process::CommandEvent::Stderr(line) = event {
            let line = String::from_utf8_lossy(&line);

            if let Some(time) = parse_ffmpeg_time(&line) {
                if let Some(sp) = parse_ffmpeg_speed(&line) {
                    last_speed = Some(sp);
                }

                let eta = if let (Some(speed), true) = (last_speed, total_duration > 0.0) {
                    Some((total_duration - time) / speed.max(0.1))
                } else {
                    None
                };

                let _ = app.emit("queue-progress", serde_json::json!({
                    "index": job_index,
                    "current": time,
                    "total": total_duration,
                    "percent": if total_duration > 0.0 { (time / total_duration * 100.0).min(99.9) } else { 0.0 },
                    "speed": last_speed,
                    "eta": eta
                }));
            }
        }
    }

    {
        let mut guard = ACTIVE_JOBS.lock().unwrap();
        if let Some(registry) = guard.as_mut() {
            registry.remove(job_index);
        }
    }

    Ok(job.output_path)
}

const MAX_CONCURRENT_JOBS: usize = 5;

#[tauri::command]
async fn process_queue(app: tauri::AppHandle, jobs: Vec<VideoJob>) -> Result<Vec<String>, String> {
    if jobs.is_empty() {
        return Err("No jobs provided".into());
    }

    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(MAX_CONCURRENT_JOBS));
    let mut handles = Vec::with_capacity(jobs.len());

    for (i, job) in jobs.into_iter().enumerate() {
        let app_clone = app.clone();
        let sem = semaphore.clone();
        let display_index = job.original_index.unwrap_or(i);
        let handle = tokio::spawn(async move {
            let _permit = sem.acquire().await.unwrap();

            let _ = app_clone.emit("queue-status", serde_json::json!({
                "index": display_index, "status": "processing"
            }));

            let result = process_single_job(app_clone.clone(), job, display_index).await;

            let status = match &result {
                Ok(_) => serde_json::json!({ "index": display_index, "status": "done" }),
                Err(e) => serde_json::json!({ "index": display_index, "status": "error", "error": e }),
            };
            let _ = app_clone.emit("queue-status", status);

            result
        });
        handles.push(handle);
    }

    let mut results = Vec::with_capacity(handles.len());
    for handle in handles {
        match handle.await {
            Ok(Ok(path)) => results.push(path),
            Ok(Err(e)) => results.push(format!("ERROR: {}", e)),
            Err(e) => results.push(format!("ERROR: task panicked: {}", e)),
        }
    }

    Ok(results)
}

#[tauri::command]
async fn cancel_job(job_index: usize) -> Result<(), String> {
    let mut guard = ACTIVE_JOBS.lock().unwrap();
    if let Some(registry) = guard.as_mut() {
        if let Some(child) = registry.remove(job_index) {
            let _ = child.kill();
            return Ok(());
        }
    }
    Err("Job not found".into())
}

#[tauri::command]
async fn cancel_all_jobs() -> Result<(), String> {
    let mut guard = ACTIVE_JOBS.lock().unwrap();
    if let Some(registry) = guard.take() {
        registry.kill_all();
    }
    Ok(())
}

#[tauri::command]
async fn get_video_info(app: tauri::AppHandle, path: String) -> Result<serde_json::Value, String> {
    let shell = app.shell();
    let ffmpeg = shell
        .sidecar("ffmpeg")
        .map_err(|e| format!("ffmpeg sidecar not found: {}", e))?;

    let output = ffmpeg
        .args(["-i", &path, "-hide_banner"])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let info = String::from_utf8_lossy(&output.stderr).to_string();

    let duration = info
        .lines()
        .find(|l| l.contains("Duration:"))
        .and_then(|l| {
            let pos = l.find("Duration:")? + 10;
            let time_str = l[pos..].split(',').next()?.trim();
            parse_hhmmss(time_str)
        });

    Ok(serde_json::json!({
        "duration": duration,
        "raw_info": info
    }))
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))
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
        .invoke_handler(tauri::generate_handler![
            greet,
            process_queue,
            cancel_job,
            cancel_all_jobs,
            get_video_info,
            read_file_bytes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ensure_even() {
        assert_eq!(ensure_even(0.0), 0);
        assert_eq!(ensure_even(1.0), 0);
        assert_eq!(ensure_even(2.0), 2);
        assert_eq!(ensure_even(3.0), 2);
        assert_eq!(ensure_even(4.0), 4);
        assert_eq!(ensure_even(100.7), 100);
        assert_eq!(ensure_even(101.9), 100);
    }

    #[test]
    fn test_crop_filter_arg() {
        let r = Region { x: 10.0, y: 20.0, w: 100.0, h: 50.0 };
        assert_eq!(crop_filter_arg(&r), "100:50:10:20");

        let r2 = Region { x: 0.0, y: 0.0, w: 1920.0, h: 1080.0 };
        assert_eq!(crop_filter_arg(&r2), "1920:1080:0:0");

        // Odd values get rounded down to even
        let r3 = Region { x: 1.0, y: 1.0, w: 101.0, h: 51.0 };
        assert_eq!(crop_filter_arg(&r3), "100:50:0:0");
    }

    #[test]
    fn test_parse_hhmmss() {
        assert_eq!(parse_hhmmss("00:01:30.50"), Some(90.5));
        assert_eq!(parse_hhmmss("01:00:00.00"), Some(3600.0));
        assert_eq!(parse_hhmmss("00:00:00.00"), Some(0.0));
        assert_eq!(parse_hhmmss("10:30:45.12"), Some(10.0 * 3600.0 + 30.0 * 60.0 + 45.12));
        assert_eq!(parse_hhmmss("invalid"), None);
        assert_eq!(parse_hhmmss("00:00"), None);
    }

    #[test]
    fn test_parse_ffmpeg_time() {
        assert_eq!(
            parse_ffmpeg_time("frame=  100 fps=30 time=00:00:03.33 bitrate=1000kbits/s"),
            Some(3.33)
        );
        assert_eq!(
            parse_ffmpeg_time("size=  1024kB time=00:01:30.00 speed=2.0x"),
            Some(90.0)
        );
        assert_eq!(parse_ffmpeg_time("no time info here"), None);
        assert_eq!(parse_ffmpeg_time(""), None);
    }

    #[test]
    fn test_parse_ffmpeg_speed() {
        assert_eq!(
            parse_ffmpeg_speed("frame=  100 fps=30 time=00:00:03.33 speed=2.5x"),
            Some(2.5)
        );
        assert_eq!(
            parse_ffmpeg_speed("size=  1024kB time=00:01:30.00 speed=1.00x"),
            Some(1.0)
        );
        assert_eq!(parse_ffmpeg_speed("no speed info"), None);
    }

    #[test]
    fn test_build_filter_graph_empty() {
        let result = build_filter_graph(&[]);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "");
    }

    #[test]
    fn test_build_filter_graph_single_blur() {
        let ops = vec![VideoOperation {
            mode: OperationMode::Blur,
            region: Some(Region { x: 10.0, y: 20.0, w: 100.0, h: 50.0 }),
            blur_strength: Some(15),
            start_time: None,
            end_time: None,
            text: None,
            font_size: None,
            font_color: None,
        }];
        let result = build_filter_graph(&ops).unwrap();
        assert!(result.contains("split"));
        assert!(result.contains("crop=100:50:10:20"));
        assert!(result.contains("boxblur=15:1"));
        assert!(result.contains("overlay=10:20"));
    }

    #[test]
    fn test_build_filter_graph_single_crop() {
        let ops = vec![VideoOperation {
            mode: OperationMode::Crop,
            region: Some(Region { x: 0.0, y: 0.0, w: 640.0, h: 480.0 }),
            blur_strength: None,
            start_time: None,
            end_time: None,
            text: None,
            font_size: None,
            font_color: None,
        }];
        let result = build_filter_graph(&ops).unwrap();
        assert!(result.contains("crop=640:480:0:0"));
    }

    #[test]
    fn test_build_filter_graph_text() {
        let ops = vec![VideoOperation {
            mode: OperationMode::Text,
            region: Some(Region { x: 50.0, y: 50.0, w: 200.0, h: 100.0 }),
            blur_strength: None,
            start_time: None,
            end_time: None,
            text: Some("Hello World".to_string()),
            font_size: Some(32),
            font_color: Some("white".to_string()),
        }];
        let result = build_filter_graph(&ops).unwrap();
        assert!(result.contains("drawtext=text='Hello World'"));
        assert!(result.contains("fontsize=32"));
        assert!(result.contains("fontcolor=white"));
    }

    #[test]
    fn test_build_filter_graph_blur_without_region_fails() {
        let ops = vec![VideoOperation {
            mode: OperationMode::Blur,
            region: None,
            blur_strength: Some(20),
            start_time: None,
            end_time: None,
            text: None,
            font_size: None,
            font_color: None,
        }];
        assert!(build_filter_graph(&ops).is_err());
    }

    #[test]
    fn test_build_filter_graph_with_time_range() {
        let ops = vec![VideoOperation {
            mode: OperationMode::Blur,
            region: Some(Region { x: 10.0, y: 10.0, w: 50.0, h: 50.0 }),
            blur_strength: Some(20),
            start_time: Some(5.0),
            end_time: Some(15.0),
            text: None,
            font_size: None,
            font_color: None,
        }];
        let result = build_filter_graph(&ops).unwrap();
        assert!(result.contains("enable='between(t,5,15)'"));
    }

    #[test]
    fn test_build_filter_graph_multiple_operations() {
        let ops = vec![
            VideoOperation {
                mode: OperationMode::Blur,
                region: Some(Region { x: 10.0, y: 10.0, w: 50.0, h: 50.0 }),
                blur_strength: Some(20),
                start_time: None,
                end_time: None,
                text: None,
                font_size: None,
                font_color: None,
            },
            VideoOperation {
                mode: OperationMode::Crop,
                region: Some(Region { x: 0.0, y: 0.0, w: 640.0, h: 480.0 }),
                blur_strength: None,
                start_time: None,
                end_time: None,
                text: None,
                font_size: None,
                font_color: None,
            },
        ];
        let result = build_filter_graph(&ops).unwrap();
        assert!(result.contains("[op0]"));
        assert!(result.contains("[op1]"));
    }
}
