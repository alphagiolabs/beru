use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use tauri::{Emitter};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

#[derive(Serialize, Deserialize, Clone, PartialEq, Default, Debug)]
#[serde(rename_all = "lowercase")]
pub enum OperationMode {
    #[default]
    Blur,
    Crop,
    Text,
    Image,
    Delogo,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Region {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct VideoOperation {
    pub mode: OperationMode,
    pub region: Option<Region>,
    pub blur_strength: Option<u32>,
    pub start_time: Option<f64>,
    pub end_time: Option<f64>,
    pub text: Option<String>,
    pub font_size: Option<u32>,
    pub font_color: Option<String>,
    /// Font family name (e.g. "Arial", "Times New Roman").
    #[serde(default)]
    pub font_family: Option<String>,
    #[serde(default)]
    pub bold: Option<bool>,
    #[serde(default)]
    pub italic: Option<bool>,
    /// Whether to render a solid background box behind the text.
    #[serde(default)]
    pub bg_enabled: Option<bool>,
    #[serde(default)]
    pub bg_color: Option<String>,
    /// 0..1 background alpha.
    #[serde(default)]
    pub bg_opacity: Option<f64>,
    /// Outline / stroke width around glyphs in pixels (0 = none).
    #[serde(default)]
    pub border_width: Option<u32>,
    #[serde(default)]
    pub border_color: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "lowercase")]
pub enum SpeedPreset {
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

/// Builds the filter_complex string and returns it along with the final
/// output label (without brackets) so callers can `-map` it explicitly.
/// Returns an empty string + None when there are no operations.
fn build_filter_graph(operations: &[VideoOperation]) -> Result<(String, Option<String>), String> {
    // Skip blank text ops — drawtext with text='' makes ffmpeg exit -22 (EINVAL).
    let operations: Vec<&VideoOperation> = operations
        .iter()
        .filter(|op| {
            if op.mode == OperationMode::Text {
                op.text
                    .as_ref()
                    .map(|t| !t.trim().is_empty())
                    .unwrap_or(false)
            } else {
                true
            }
        })
        .collect();

    let mut filter_parts: Vec<String> = vec![];
    let mut current_input = "[0:v]".to_string();
    let mut last_label: Option<String> = None;
    let mut next_image_input = 1usize;

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
                let color = escape_filter_option_value(op.font_color.as_deref().unwrap_or("white"));
                let escaped = escape_drawtext(txt);

                let family = op.font_family.as_deref().unwrap_or("Arial");
                let bold = op.bold.unwrap_or(false);
                let italic = op.italic.unwrap_or(false);

                let mut opts: Vec<String> = Vec::new();
                if let Some(font_path) = resolve_font_file(family, bold, italic) {
                    opts.push(format!("fontfile={}", escape_drawtext_path(font_path)));
                }
                opts.push(format!("text='{}'", escaped));
                opts.push(format!("x={}", r.x as u32));
                opts.push(format!("y={}", r.y as u32));
                opts.push(format!("fontsize={}", size));
                opts.push(format!("fontcolor={}", color));

                // Background box (default: enabled with black @ 0.65 to preserve old look).
                let bg_enabled = op.bg_enabled.unwrap_or(true);
                if bg_enabled {
                    let bg_color = escape_filter_option_value(op.bg_color.as_deref().unwrap_or("black"));
                    let bg_opacity = op.bg_opacity.unwrap_or(0.65).clamp(0.0, 1.0);
                    opts.push("box=1".into());
                    opts.push(format!("boxcolor={}@{:.3}", bg_color, bg_opacity));
                    opts.push("boxborderw=8".into());
                }

                // Glyph stroke / outline.
                let border_w = op.border_width.unwrap_or(0);
                if border_w > 0 {
                    let border_c = escape_filter_option_value(op.border_color.as_deref().unwrap_or("black"));
                    opts.push(format!("borderw={}", border_w));
                    opts.push(format!("bordercolor={}", border_c));
                }

                filter_parts.push(format!(
                    "{}drawtext={}{}[{}]",
                    current_input, opts.join(":"), enable, label
                ));
                current_input = format!("[{}]", label);
            }
            OperationMode::Image => {
                let r = op.region.as_ref().ok_or("Image overlay requires region")?;
                let input_idx = next_image_input;
                next_image_input += 1;
                filter_parts.push(format!(
                    "[{idx}:v]scale={w}:{h}[s{i}];{base}[s{i}]overlay={x}:{y}[{lbl}]",
                    idx = input_idx, base = current_input, w = ensure_even(r.w), h = ensure_even(r.h), i = i, x = r.x as u32, y = r.y as u32, lbl = label
                ));
                current_input = format!("[{}]", label);
            }
            OperationMode::Delogo => {
                let r = op.region.as_ref().ok_or("Delogo requires region")?;
                let x = r.x as u32;
                let y = r.y as u32;
                let w = ensure_even(r.w);
                let h = ensure_even(r.h);
                filter_parts.push(format!(
                    "{}delogo=x={}:y={}:w={}:h={}:show=0{}[{}]",
                    current_input, x, y, w, h, enable, label
                ));
                current_input = format!("[{}]", label);
            }
        }
        last_label = Some(label);
    }

    Ok((filter_parts.join(";"), last_label))
}

/// Escape a string for use inside a `drawtext` `text='...'` argument.
/// FFmpeg's filtergraph parser treats `:`, `,`, `;`, `[`, `]`, `\\`, `'`, `=`,
/// and `%` specially. We escape conservatively so user input never breaks
/// the filter graph or triggers `expansion`-style substitution.
fn escape_drawtext(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            ':' => out.push_str("\\:"),
            ',' => out.push_str("\\,"),
            ';' => out.push_str("\\;"),
            '[' => out.push_str("\\["),
            ']' => out.push_str("\\]"),
            '=' => out.push_str("\\="),
            '%' => out.push_str("\\%"),
            '\'' => out.push_str("'\\''"),
            _ => out.push(ch),
        }
    }
    out
}

fn escape_filter_option_value(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 4);
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            ':' => out.push_str("\\:"),
            ',' => out.push_str("\\,"),
            ';' => out.push_str("\\;"),
            '[' => out.push_str("\\["),
            ']' => out.push_str("\\]"),
            '=' => out.push_str("\\="),
            '%' => out.push_str("\\%"),
            '\'' => out.push_str("\\'"),
            _ => out.push(ch),
        }
    }
    out
}

/// Escape a value used as a drawtext option (e.g. `fontfile=`). Inside a
/// filter graph, `\`, `:`, `,` and `'` would otherwise terminate the option
/// or the filter. Backslashes are normalized to forward slashes so Windows
/// paths like `C:\Windows\Fonts\arial.ttf` round-trip correctly.
fn escape_drawtext_path(s: &str) -> String {
    let normalized = s.replace('\\', "/");
    let mut out = String::with_capacity(normalized.len() + 4);
    for ch in normalized.chars() {
        match ch {
            ':' => out.push_str("\\:"),
            ',' => out.push_str("\\,"),
            '\'' => out.push_str("\\'"),
            _ => out.push(ch),
        }
    }
    out
}

/// Map a (family, bold, italic) tuple to an absolute Windows font file path.
/// Returns the regular variant if the requested style isn't shipped with
/// Windows. Returns `None` for unknown families so FFmpeg falls back to its
/// built-in default.
fn resolve_font_file(family: &str, bold: bool, italic: bool) -> Option<&'static str> {
    let regular_only = |reg: &'static str| Some(reg);
    let pick = |reg: &'static str, b: Option<&'static str>, i: Option<&'static str>, bi: Option<&'static str>| -> Option<&'static str> {
        match (bold, italic) {
            (true, true) => bi.or(b).or(i).or(Some(reg)),
            (true, false) => b.or(Some(reg)),
            (false, true) => i.or(Some(reg)),
            (false, false) => Some(reg),
        }
    };

    match family {
        "Arial" => pick(
            "C:/Windows/Fonts/arial.ttf",
            Some("C:/Windows/Fonts/arialbd.ttf"),
            Some("C:/Windows/Fonts/ariali.ttf"),
            Some("C:/Windows/Fonts/arialbi.ttf"),
        ),
        "Arial Black" => regular_only("C:/Windows/Fonts/ariblk.ttf"),
        "Bahnschrift" => regular_only("C:/Windows/Fonts/bahnschrift.ttf"),
        "Cambria" => pick(
            "C:/Windows/Fonts/cambria.ttc",
            Some("C:/Windows/Fonts/cambriab.ttf"),
            Some("C:/Windows/Fonts/cambriai.ttf"),
            Some("C:/Windows/Fonts/cambriaz.ttf"),
        ),
        "Candara" => pick(
            "C:/Windows/Fonts/candara.ttf",
            Some("C:/Windows/Fonts/candarab.ttf"),
            Some("C:/Windows/Fonts/candarai.ttf"),
            Some("C:/Windows/Fonts/candaraz.ttf"),
        ),
        "Times New Roman" => pick(
            "C:/Windows/Fonts/times.ttf",
            Some("C:/Windows/Fonts/timesbd.ttf"),
            Some("C:/Windows/Fonts/timesi.ttf"),
            Some("C:/Windows/Fonts/timesbi.ttf"),
        ),
        "Courier New" => pick(
            "C:/Windows/Fonts/cour.ttf",
            Some("C:/Windows/Fonts/courbd.ttf"),
            Some("C:/Windows/Fonts/couri.ttf"),
            Some("C:/Windows/Fonts/courbi.ttf"),
        ),
        "Consolas" => pick(
            "C:/Windows/Fonts/consola.ttf",
            Some("C:/Windows/Fonts/consolab.ttf"),
            Some("C:/Windows/Fonts/consolai.ttf"),
            Some("C:/Windows/Fonts/consolaz.ttf"),
        ),
        "Franklin Gothic Medium" => pick(
            "C:/Windows/Fonts/framd.ttf",
            None,
            Some("C:/Windows/Fonts/framdit.ttf"),
            None,
        ),
        "Verdana" => pick(
            "C:/Windows/Fonts/verdana.ttf",
            Some("C:/Windows/Fonts/verdanab.ttf"),
            Some("C:/Windows/Fonts/verdanai.ttf"),
            Some("C:/Windows/Fonts/verdanaz.ttf"),
        ),
        "Segoe UI" => pick(
            "C:/Windows/Fonts/segoeui.ttf",
            Some("C:/Windows/Fonts/segoeuib.ttf"),
            Some("C:/Windows/Fonts/segoeuii.ttf"),
            Some("C:/Windows/Fonts/segoeuiz.ttf"),
        ),
        "Tahoma" => pick(
            "C:/Windows/Fonts/tahoma.ttf",
            Some("C:/Windows/Fonts/tahomabd.ttf"),
            None,
            None,
        ),
        "Georgia" => pick(
            "C:/Windows/Fonts/georgia.ttf",
            Some("C:/Windows/Fonts/georgiab.ttf"),
            Some("C:/Windows/Fonts/georgiai.ttf"),
            Some("C:/Windows/Fonts/georgiaz.ttf"),
        ),
        "Calibri" => pick(
            "C:/Windows/Fonts/calibri.ttf",
            Some("C:/Windows/Fonts/calibrib.ttf"),
            Some("C:/Windows/Fonts/calibrii.ttf"),
            Some("C:/Windows/Fonts/calibriz.ttf"),
        ),
        "Trebuchet MS" => pick(
            "C:/Windows/Fonts/trebuc.ttf",
            Some("C:/Windows/Fonts/trebucbd.ttf"),
            Some("C:/Windows/Fonts/trebucit.ttf"),
            Some("C:/Windows/Fonts/trebucbi.ttf"),
        ),
        "Comic Sans MS" => pick(
            "C:/Windows/Fonts/comic.ttf",
            Some("C:/Windows/Fonts/comicbd.ttf"),
            None,
            None,
        ),
        "Impact" => regular_only("C:/Windows/Fonts/impact.ttf"),
        _ => None,
    }
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
    // ── Pre-flight validation ────────────────────────────────────────────
    if !Path::new(&job.input_path).is_file() {
        return Err(format!("input file not found: {}", job.input_path));
    }
    for image_path in job
        .operations
        .iter()
        .filter(|op| op.mode == OperationMode::Image)
        .filter_map(|op| op.text.as_deref())
    {
        if !Path::new(image_path).is_file() {
            return Err(format!("image overlay file not found: {}", image_path));
        }
    }

    let shell = app.shell();
    let ffmpeg = shell
        .sidecar("ffmpeg")
        .map_err(|e| format!("ffmpeg sidecar not found: {}", e))?;

    let preset = job.speed_preset.as_ref().map(|p| p.as_str()).unwrap_or("ultrafast");
    let (filter_complex, last_label) = build_filter_graph(&job.operations)?;

    let threads = default_threads_per_job();

    let mut cmd = ffmpeg.args(["-y", "-i", &job.input_path]);
    for image_path in job
        .operations
        .iter()
        .filter(|op| op.mode == OperationMode::Image)
        .filter_map(|op| op.text.as_deref())
    {
        cmd = cmd.args(["-i", image_path]);
    }

    // Single-crop shortcut: use -vf instead of -filter_complex.
    // -vf preserves ffmpeg's automatic stream selection, so audio is kept.
    let single_crop = job.operations.len() == 1 && job.operations[0].mode == OperationMode::Crop;
    if single_crop {
        if let Some(r) = &job.operations[0].region {
            cmd = cmd.args(["-vf", &format!("crop={}", crop_filter_arg(r))]);
        }
    } else {
        cmd = cmd.args(["-filter_complex", &filter_complex]);
        // With -filter_complex ffmpeg disables automatic stream selection.
        // Map the final video label and optionally the input audio so we don't
        // silently drop the audio track.
        if let Some(lbl) = &last_label {
            cmd = cmd.args(["-map", &format!("[{}]", lbl), "-map", "0:a?"]);
        }
    }

    let (mut rx, child) = cmd
        .args([
            "-c:a", "copy",
            "-c:v", "libx264",
            "-preset", preset,
            "-crf", "23",
            "-movflags", "+faststart",
            "-threads", threads,
            &job.output_path,
        ])
        .spawn()
        .map_err(|e| format!("failed to spawn ffmpeg: {}", e))?;

    if let Ok(mut guard) = ACTIVE_JOBS.lock() {
        guard.get_or_insert_with(JobRegistry::new).register(job_index, child);
    }

    let mut last_speed: Option<f64> = None;
    let total_duration = job.video_duration.unwrap_or(0.0);
    let mut last_stderr_line = String::new();

    // Timeout guard: if a job runs longer than JOB_TIMEOUT_SECS, kill it.
    let timeout = tokio::time::sleep(std::time::Duration::from_secs(JOB_TIMEOUT_SECS));
    tokio::pin!(timeout);
    let mut timed_out = false;

    loop {
        tokio::select! {
            biased;
            event = rx.recv() => {
                match event {
                    Some(tauri_plugin_shell::process::CommandEvent::Stderr(line)) => {
                        let line = String::from_utf8_lossy(&line);
                        // Keep last meaningful stderr line for error reporting.
                        if line.contains("Error") || line.contains("error") || line.contains("Invalid") {
                            last_stderr_line = line.to_string();
                        }

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
                    Some(tauri_plugin_shell::process::CommandEvent::Terminated(status)) => {
                        if status.code != Some(0) && !status.signal.is_some() {
                            // Non-zero exit without a kill signal = real error.
                            let detail = if !last_stderr_line.is_empty() {
                                format!("ffmpeg exited with code {}: {}", status.code.unwrap_or(-1), last_stderr_line.trim())
                            } else {
                                format!("ffmpeg exited with code {}", status.code.unwrap_or(-1))
                            };
                            // Clean up partial output.
                            let _ = std::fs::remove_file(&job.output_path);
                            // Remove from registry.
                            if let Ok(mut guard) = ACTIVE_JOBS.lock() {
                                if let Some(registry) = guard.as_mut() {
                                    registry.remove(job_index);
                                }
                            }
                            return Err(detail);
                        }
                    }
                    None => break, // Channel closed — process finished.
                    _ => {}
                }
            }
            _ = &mut timeout => {
                timed_out = true;
                // Kill the runaway process.
                if let Ok(mut guard) = ACTIVE_JOBS.lock() {
                    if let Some(registry) = guard.as_mut() {
                        if let Some(child) = registry.remove(job_index) {
                            let _ = child.kill();
                        }
                    }
                }
                break;
            }
        }
    }

    // Remove from registry (in case Terminated branch didn't run).
    if let Ok(mut guard) = ACTIVE_JOBS.lock() {
        if let Some(registry) = guard.as_mut() {
            registry.remove(job_index);
        }
    }

    if timed_out {
        let _ = std::fs::remove_file(&job.output_path);
        return Err(format!(
            "job timed out after {}s — possible stalled FFmpeg process",
            JOB_TIMEOUT_SECS
        ));
    }

    // Verify the output file was actually created and is non-empty.
    if !Path::new(&job.output_path).is_file() {
        return Err("ffmpeg finished but output file was not created".into());
    }
    match std::fs::metadata(&job.output_path) {
        Ok(m) if m.len() == 0 => {
            let _ = std::fs::remove_file(&job.output_path);
            return Err("ffmpeg produced an empty output file".into());
        }
        Err(e) => {
            return Err(format!("output file metadata error: {}", e));
        }
        _ => {}
    }

    Ok(job.output_path)
}

/// Adaptive concurrency for the processing queue.
/// Uses half the cores (rounded up) but allows higher throughput on modern
/// multi-core machines (up to 8 concurrent FFmpeg jobs). Combined with the
/// ultrafast preset this significantly improves wall-clock time for large batches
/// while the UI remains responsive.
fn default_max_concurrent_jobs() -> usize {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(2);
    cores.div_ceil(2).clamp(1, 8)
}

/// Per-job FFmpeg threads derived from total cores / concurrency.
/// x264 encoding does not scale linearly beyond ~2-3 threads per job on most content.
/// We bias toward 1-3 threads per job to leave headroom for the OS + Svelte UI.
fn default_threads_per_job() -> &'static str {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(2);
    let max_jobs = default_max_concurrent_jobs();
    // Prefer 1-3 threads per job for good encoding efficiency + UI responsiveness.
    let t = (cores / max_jobs).clamp(1, 3);
    // Leak a tiny string so we can return &'static. Runs once per process.
    Box::leak(t.to_string().into_boxed_str())
}

const JOB_TIMEOUT_SECS: u64 = 7200; // 2 hours per job (prevents runaway)

#[tauri::command]
async fn process_queue(
    app: tauri::AppHandle,
    jobs: Vec<VideoJob>,
    max_concurrent: Option<usize>,
) -> Result<Vec<String>, String> {
    if jobs.is_empty() {
        return Err("No jobs provided".into());
    }

    // Use caller-provided value if > 0, otherwise fall back to the smart heuristic.
    let max_concurrent = max_concurrent.filter(|&n| n > 0).unwrap_or_else(default_max_concurrent_jobs);
    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(max_concurrent));
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

    // Emit a batch summary so the frontend can display final stats.
    let succeeded = results.iter().filter(|r| !r.starts_with("ERROR")).count();
    let failed = results.len() - succeeded;
    let _ = app.emit("queue-summary", serde_json::json!({
        "total": results.len(),
        "succeeded": succeeded,
        "failed": failed,
    }));

    Ok(results)
}

#[tauri::command]
async fn cancel_job(job_index: usize) -> Result<(), String> {
    let mut guard = ACTIVE_JOBS
        .lock()
        .map_err(|_| "job registry mutex poisoned".to_string())?;
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
    let mut guard = ACTIVE_JOBS
        .lock()
        .map_err(|_| "job registry mutex poisoned".to_string())?;
    if let Some(mut registry) = guard.take() {
        registry.kill_all();
    }
    Ok(())
}

#[tauri::command]
async fn get_video_info(app: tauri::AppHandle, path: String) -> Result<serde_json::Value, String> {
    let shell = app.shell();

    // Try ffprobe first for structured JSON output (faster, more reliable).
    if let Ok(ffprobe) = shell.sidecar("ffprobe") {
        let output = ffprobe
            .args([
                "-v", "quiet",
                "-print_format", "json",
                "-show_format",
                "-show_streams",
                &path,
            ])
            .output()
            .await;

        if let Ok(output) = output {
            if output.status.success() {
                let json_str = String::from_utf8_lossy(&output.stdout).to_string();
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&json_str) {
                    // Extract duration from format or first video stream.
                    let duration = parsed
                        .get("format")
                        .and_then(|f| f.get("duration"))
                        .and_then(|d| d.as_str())
                        .and_then(|s| s.parse::<f64>().ok())
                        .or_else(|| {
                            let video_stream = parsed
                                .get("streams")
                                .and_then(|s| s.as_array())
                                .and_then(|arr| arr.iter().find(|s| s.get("codec_type").and_then(|t| t.as_str()) == Some("video")));
                            video_stream
                                .and_then(|vs| {
                                    vs.get("duration")
                                        .and_then(|d| d.as_str().and_then(|s| s.parse::<f64>().ok()))
                                        .or_else(|| vs.get("duration").and_then(|d| d.as_f64()))
                                })
                        });

                    let video_stream = parsed
                        .get("streams")
                        .and_then(|s| s.as_array())
                        .and_then(|arr| arr.iter().find(|s| s.get("codec_type").and_then(|t| t.as_str()) == Some("video")));

                    let width = video_stream
                        .and_then(|vs| vs.get("width"))
                        .and_then(|w| w.as_i64());

                    let height = video_stream
                        .and_then(|vs| vs.get("height"))
                        .and_then(|h| h.as_i64());

                    return Ok(serde_json::json!({
                        "duration": duration,
                        "width": width,
                        "height": height,
                        "raw_info": json_str,
                    }));
                }
            }
        }
    }

    // Fallback to ffmpeg -i (original approach).
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
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
        let (graph, last) = build_filter_graph(&[]).unwrap();
        assert_eq!(graph, "");
        assert_eq!(last, None);
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
            ..Default::default()
        }];
        let (graph, last) = build_filter_graph(&ops).unwrap();
        assert!(graph.contains("split"));
        assert!(graph.contains("crop=100:50:10:20"));
        assert!(graph.contains("boxblur=15:1"));
        assert!(graph.contains("overlay=10:20"));
        assert_eq!(last.as_deref(), Some("op0"));
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
            ..Default::default()
        }];
        let (graph, last) = build_filter_graph(&ops).unwrap();
        assert!(graph.contains("crop=640:480:0:0"));
        assert_eq!(last.as_deref(), Some("op0"));
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
            ..Default::default()
        }];
        let (graph, _last) = build_filter_graph(&ops).unwrap();
        assert!(graph.contains("text='Hello World'"));
        assert!(graph.contains("fontsize=32"));
        assert!(graph.contains("fontcolor=white"));
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
            ..Default::default()
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
            ..Default::default()
        }];
        let (graph, _last) = build_filter_graph(&ops).unwrap();
        assert!(graph.contains("enable='between(t,5,15)'"));
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
                ..Default::default()
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
                ..Default::default()
            },
        ];
        let (graph, last) = build_filter_graph(&ops).unwrap();
        assert!(graph.contains("[op0]"));
        assert!(graph.contains("[op1]"));
        // Last label must be the final op so callers can -map it.
        assert_eq!(last.as_deref(), Some("op1"));
    }

    #[test]
    fn test_escape_drawtext_specials() {
        // Plain text untouched.
        assert_eq!(escape_drawtext("hello"), "hello");
        // Filtergraph delimiters must be escaped or the filter graph breaks.
        assert_eq!(escape_drawtext("a:b"), "a\\:b");
        assert_eq!(escape_drawtext("a,b"), "a\\,b");
        assert_eq!(escape_drawtext("a;b"), "a\\;b");
        assert_eq!(escape_drawtext("a[b]c"), "a\\[b\\]c");
        // = and % would otherwise trigger drawtext expansion / param parsing.
        assert_eq!(escape_drawtext("x=1"), "x\\=1");
        assert_eq!(escape_drawtext("50%"), "50\\%");
        // Backslash doubled.
        assert_eq!(escape_drawtext("a\\b"), "a\\\\b");
        // Single quote uses shell-style escape to close/reopen the literal.
        assert_eq!(escape_drawtext("it's"), "it'\\''s");
    }

    #[test]
    fn test_escape_drawtext_in_filter_graph() {
        let ops = vec![VideoOperation {
            mode: OperationMode::Text,
            region: Some(Region { x: 0.0, y: 0.0, w: 100.0, h: 50.0 }),
            blur_strength: None,
            start_time: None,
            end_time: None,
            // This text used to break the filter graph: contains : , % =
            text: Some("Save 50%: a,b=c".to_string()),
            font_size: Some(24),
            font_color: Some("white".to_string()),
            ..Default::default()
        }];
        let (graph, _) = build_filter_graph(&ops).unwrap();
        // The user-supplied colon/comma/percent/equals must be escaped so
        // they cannot terminate the drawtext option or the filter.
        assert!(graph.contains("Save 50\\%\\: a\\,b\\=c"));
    }

    #[test]
    fn test_resolve_font_file_arial_variants() {
        assert_eq!(resolve_font_file("Arial", false, false), Some("C:/Windows/Fonts/arial.ttf"));
        assert_eq!(resolve_font_file("Arial", true, false), Some("C:/Windows/Fonts/arialbd.ttf"));
        assert_eq!(resolve_font_file("Arial", false, true), Some("C:/Windows/Fonts/ariali.ttf"));
        assert_eq!(resolve_font_file("Arial", true, true), Some("C:/Windows/Fonts/arialbi.ttf"));
    }

    #[test]
    fn test_resolve_font_file_falls_back_for_missing_variant() {
        // Tahoma has no italic variant on Windows → should fall back to regular.
        assert_eq!(resolve_font_file("Tahoma", false, true), Some("C:/Windows/Fonts/tahoma.ttf"));
        // Impact has only the regular variant.
        assert_eq!(resolve_font_file("Impact", true, true), Some("C:/Windows/Fonts/impact.ttf"));
        // Arial Black is a display face with a single Windows font file.
        assert_eq!(resolve_font_file("Arial Black", true, false), Some("C:/Windows/Fonts/ariblk.ttf"));
    }

    #[test]
    fn test_resolve_font_file_new_editor_families() {
        assert_eq!(resolve_font_file("Segoe UI", true, false), Some("C:/Windows/Fonts/segoeuib.ttf"));
        assert_eq!(resolve_font_file("Consolas", false, true), Some("C:/Windows/Fonts/consolai.ttf"));
        assert_eq!(resolve_font_file("Franklin Gothic Medium", false, true), Some("C:/Windows/Fonts/framdit.ttf"));
    }

    #[test]
    fn test_resolve_font_file_unknown_family() {
        assert_eq!(resolve_font_file("ImaginaryFont", false, false), None);
    }

    #[test]
    fn test_escape_drawtext_path_normalizes_and_escapes() {
        assert_eq!(
            escape_drawtext_path("C:\\Windows\\Fonts\\arial.ttf"),
            "C\\:/Windows/Fonts/arial.ttf"
        );
        assert_eq!(
            escape_drawtext_path("/usr/share/fonts/Arial,bold.ttf"),
            "/usr/share/fonts/Arial\\,bold.ttf"
        );
    }

    #[test]
    fn test_escape_filter_option_value_specials() {
        assert_eq!(escape_filter_option_value("white"), "white");
        assert_eq!(escape_filter_option_value("red:box=1"), "red\\:box\\=1");
        assert_eq!(escape_filter_option_value("a,b[c]"), "a\\,b\\[c\\]");
        assert_eq!(escape_filter_option_value("50%"), "50\\%");
    }

    #[test]
    fn test_build_filter_graph_text_style_options() {
        let ops = vec![VideoOperation {
            mode: OperationMode::Text,
            region: Some(Region { x: 10.0, y: 20.0, w: 100.0, h: 50.0 }),
            text: Some("Hi".into()),
            font_size: Some(40),
            font_color: Some("yellow".into()),
            font_family: Some("Arial".into()),
            bold: Some(true),
            italic: Some(true),
            bg_enabled: Some(false),
            border_width: Some(3),
            border_color: Some("red".into()),
            ..Default::default()
        }];
        let (graph, _) = build_filter_graph(&ops).unwrap();
        // Bold+italic Arial resolves to arialbi.ttf with the colon escaped.
        assert!(graph.contains("fontfile=C\\:/Windows/Fonts/arialbi.ttf"), "graph={}", graph);
        assert!(graph.contains("fontsize=40"));
        assert!(graph.contains("fontcolor=yellow"));
        // Background disabled → no `box=1` token.
        assert!(!graph.contains("box=1"), "graph should not enable box: {}", graph);
        // Stroke is honored.
        assert!(graph.contains("borderw=3"));
        assert!(graph.contains("bordercolor=red"));
    }

    #[test]
    fn test_build_filter_graph_escapes_text_color_options() {
        let ops = vec![VideoOperation {
            mode: OperationMode::Text,
            region: Some(Region { x: 10.0, y: 20.0, w: 100.0, h: 50.0 }),
            text: Some("Hi".into()),
            font_color: Some("white:box=1".into()),
            bg_color: Some("black,evil".into()),
            border_width: Some(1),
            border_color: Some("red%".into()),
            ..Default::default()
        }];
        let (graph, _) = build_filter_graph(&ops).unwrap();
        assert!(graph.contains("fontcolor=white\\:box\\=1"), "graph={}", graph);
        assert!(graph.contains("boxcolor=black\\,evil@0.650"), "graph={}", graph);
        assert!(graph.contains("bordercolor=red\\%"), "graph={}", graph);
    }

    #[test]
    fn test_build_filter_graph_image_overlay_uses_current_video_label() {
        let ops = vec![
            VideoOperation {
                mode: OperationMode::Blur,
                region: Some(Region { x: 10.0, y: 10.0, w: 50.0, h: 50.0 }),
                blur_strength: Some(20),
                ..Default::default()
            },
            VideoOperation {
                mode: OperationMode::Image,
                region: Some(Region { x: 5.0, y: 6.0, w: 100.0, h: 80.0 }),
                text: Some("C:/tmp/logo.png".into()),
                ..Default::default()
            },
        ];
        let (graph, last) = build_filter_graph(&ops).unwrap();
        assert!(graph.contains("[1:v]scale=100:80[s1];[op0][s1]overlay=5:6[op1]"), "graph={}", graph);
        assert_eq!(last.as_deref(), Some("op1"));
    }

    #[test]
    fn test_build_filter_graph_text_default_box_kept() {
        let ops = vec![VideoOperation {
            mode: OperationMode::Text,
            region: Some(Region { x: 0.0, y: 0.0, w: 100.0, h: 50.0 }),
            text: Some("X".into()),
            font_size: Some(24),
            font_color: Some("white".into()),
            ..Default::default()
        }];
        let (graph, _) = build_filter_graph(&ops).unwrap();
        // Backwards compat: when bg_enabled is unset, default behavior keeps
        // the dark box behind text (matches the pre-style-fields output).
        assert!(graph.contains("box=1"));
        assert!(graph.contains("boxcolor=black@0.650"));
    }

    // ── SpeedPreset ──────────────────────────────────────────────────────

    #[test]
    fn test_speed_preset_as_str() {
        assert_eq!(SpeedPreset::Ultrafast.as_str(), "ultrafast");
        assert_eq!(SpeedPreset::Superfast.as_str(), "superfast");
        assert_eq!(SpeedPreset::Veryfast.as_str(), "veryfast");
        assert_eq!(SpeedPreset::Fast.as_str(), "fast");
        assert_eq!(SpeedPreset::Medium.as_str(), "medium");
    }

    #[test]
    fn test_speed_preset_deserializes_from_lowercase() {
        let j: SpeedPreset = serde_json::from_str("\"fast\"").unwrap();
        assert_eq!(j.as_str(), "fast");
    }

    #[test]
    fn test_speed_preset_serializes_to_lowercase() {
        let s = serde_json::to_string(&SpeedPreset::Ultrafast).unwrap();
        assert_eq!(s, "\"ultrafast\"");
    }

    // ── OperationMode defaults ───────────────────────────────────────────

    #[test]
    fn test_operation_mode_default_is_blur() {
        assert_eq!(OperationMode::default(), OperationMode::Blur);
    }

    #[test]
    fn test_operation_mode_deserializes_variants() {
        assert_eq!(serde_json::from_str::<OperationMode>("\"blur\"").unwrap(), OperationMode::Blur);
        assert_eq!(serde_json::from_str::<OperationMode>("\"crop\"").unwrap(), OperationMode::Crop);
        assert_eq!(serde_json::from_str::<OperationMode>("\"text\"").unwrap(), OperationMode::Text);
        assert_eq!(serde_json::from_str::<OperationMode>("\"image\"").unwrap(), OperationMode::Image);
    }

    // ── VideoOperation defaults ──────────────────────────────────────────

    #[test]
    fn test_video_operation_default_has_no_optional_fields() {
        let op = VideoOperation::default();
        assert_eq!(op.mode, OperationMode::Blur);
        assert!(op.region.is_none());
        assert!(op.blur_strength.is_none());
        assert!(op.start_time.is_none());
        assert!(op.end_time.is_none());
        assert!(op.text.is_none());
        assert!(op.font_size.is_none());
        assert!(op.font_color.is_none());
        assert!(op.font_family.is_none());
        assert!(op.bold.is_none());
        assert!(op.italic.is_none());
        assert!(op.bg_enabled.is_none());
        assert!(op.bg_color.is_none());
        assert!(op.bg_opacity.is_none());
        assert!(op.border_width.is_none());
        assert!(op.border_color.is_none());
    }

    // ── JobRegistry ──────────────────────────────────────────────────────

    #[test]
    fn test_job_registry_register_and_remove() {
        let mut reg = JobRegistry::new();
        // Register a dummy — we can't easily create a real CommandChild,
        // but we can test the HashMap insert/remove logic through kill_all.
        // Since we can't construct CommandChild, test the empty-remove path.
        assert!(reg.remove(99).is_none());
    }

    // ── Concurrency helpers ──────────────────────────────────────────────

    #[test]
    fn test_default_max_concurrent_jobs_is_sane() {
        let n = default_max_concurrent_jobs();
        assert!(n >= 1, "must be at least 1");
        assert!(n <= 8, "must be capped at 8");
    }

    #[test]
    fn test_default_threads_per_job_is_sane() {
        let t = default_threads_per_job();
        let n: u32 = t.parse().unwrap();
        assert!(n >= 1);
        assert!(n <= 3);
    }

    // ── build_filter_graph edge cases ────────────────────────────────────

    #[test]
    fn test_build_filter_graph_crop_without_region_fails() {
        let ops = vec![VideoOperation {
            mode: OperationMode::Crop,
            region: None,
            ..Default::default()
        }];
        assert!(build_filter_graph(&ops).is_err());
    }

    #[test]
    fn test_build_filter_graph_text_without_region_fails() {
        let ops = vec![VideoOperation {
            mode: OperationMode::Text,
            region: None,
            text: Some("hello".into()),
            ..Default::default()
        }];
        assert!(build_filter_graph(&ops).is_err());
    }

    #[test]
    fn test_build_filter_graph_image_without_region_fails() {
        let ops = vec![VideoOperation {
            mode: OperationMode::Image,
            region: None,
            text: Some("/tmp/logo.png".into()),
            ..Default::default()
        }];
        assert!(build_filter_graph(&ops).is_err());
    }

    #[test]
    fn test_build_filter_graph_start_time_only() {
        let ops = vec![VideoOperation {
            mode: OperationMode::Crop,
            region: Some(Region { x: 0.0, y: 0.0, w: 640.0, h: 480.0 }),
            start_time: Some(10.0),
            end_time: None,
            ..Default::default()
        }];
        let (graph, _) = build_filter_graph(&ops).unwrap();
        assert!(graph.contains("enable='gte(t,10)'"), "graph={}", graph);
    }

    #[test]
    fn test_build_filter_graph_end_time_only() {
        let ops = vec![VideoOperation {
            mode: OperationMode::Crop,
            region: Some(Region { x: 0.0, y: 0.0, w: 640.0, h: 480.0 }),
            start_time: None,
            end_time: Some(30.0),
            ..Default::default()
        }];
        let (graph, _) = build_filter_graph(&ops).unwrap();
        assert!(graph.contains("enable='lte(t,30)'"), "graph={}", graph);
    }

    #[test]
    fn test_build_filter_graph_text_custom_bg_opacity() {
        let ops = vec![VideoOperation {
            mode: OperationMode::Text,
            region: Some(Region { x: 0.0, y: 0.0, w: 100.0, h: 50.0 }),
            text: Some("test".into()),
            bg_enabled: Some(true),
            bg_color: Some("red".into()),
            bg_opacity: Some(0.3),
            ..Default::default()
        }];
        let (graph, _) = build_filter_graph(&ops).unwrap();
        assert!(graph.contains("box=1"));
        assert!(graph.contains("boxcolor=red@0.300"), "graph={}", graph);
    }

    #[test]
    fn test_build_filter_graph_text_bg_opacity_clamped_above_1() {
        let ops = vec![VideoOperation {
            mode: OperationMode::Text,
            region: Some(Region { x: 0.0, y: 0.0, w: 100.0, h: 50.0 }),
            text: Some("test".into()),
            bg_enabled: Some(true),
            bg_opacity: Some(5.0),
            ..Default::default()
        }];
        let (graph, _) = build_filter_graph(&ops).unwrap();
        assert!(graph.contains("boxcolor=black@1.000"), "graph={}", graph);
    }

    #[test]
    fn test_build_filter_graph_text_bg_opacity_clamped_below_0() {
        let ops = vec![VideoOperation {
            mode: OperationMode::Text,
            region: Some(Region { x: 0.0, y: 0.0, w: 100.0, h: 50.0 }),
            text: Some("test".into()),
            bg_enabled: Some(true),
            bg_opacity: Some(-0.5),
            ..Default::default()
        }];
        let (graph, _) = build_filter_graph(&ops).unwrap();
        assert!(graph.contains("boxcolor=black@0.000"), "graph={}", graph);
    }

    #[test]
    fn test_build_filter_graph_chained_text_ops() {
        let ops = vec![
            VideoOperation {
                mode: OperationMode::Text,
                region: Some(Region { x: 10.0, y: 10.0, w: 200.0, h: 50.0 }),
                text: Some("First".into()),
                font_size: Some(24),
                font_color: Some("white".into()),
                ..Default::default()
            },
            VideoOperation {
                mode: OperationMode::Text,
                region: Some(Region { x: 10.0, y: 70.0, w: 200.0, h: 50.0 }),
                text: Some("Second".into()),
                font_size: Some(24),
                font_color: Some("yellow".into()),
                ..Default::default()
            },
        ];
        let (graph, last) = build_filter_graph(&ops).unwrap();
        assert!(graph.contains("text='First'"));
        assert!(graph.contains("text='Second'"));
        assert!(graph.contains("[op0]"));
        assert_eq!(last.as_deref(), Some("op1"));
    }

    #[test]
    fn test_build_filter_graph_multi_image_overlay_increments_input() {
        let ops = vec![
            VideoOperation {
                mode: OperationMode::Image,
                region: Some(Region { x: 0.0, y: 0.0, w: 100.0, h: 100.0 }),
                text: Some("/tmp/a.png".into()),
                ..Default::default()
            },
            VideoOperation {
                mode: OperationMode::Image,
                region: Some(Region { x: 50.0, y: 50.0, w: 80.0, h: 80.0 }),
                text: Some("/tmp/b.png".into()),
                ..Default::default()
            },
        ];
        let (graph, last) = build_filter_graph(&ops).unwrap();
        assert!(graph.contains("[1:v]"), "first image should use input 1");
        assert!(graph.contains("[2:v]"), "second image should use input 2");
        assert_eq!(last.as_deref(), Some("op1"));
    }

    #[test]
    fn test_build_filter_graph_blur_then_text() {
        let ops = vec![
            VideoOperation {
                mode: OperationMode::Blur,
                region: Some(Region { x: 10.0, y: 10.0, w: 50.0, h: 50.0 }),
                blur_strength: Some(10),
                ..Default::default()
            },
            VideoOperation {
                mode: OperationMode::Text,
                region: Some(Region { x: 0.0, y: 0.0, w: 200.0, h: 50.0 }),
                text: Some("Overlay".into()),
                font_size: Some(20),
                font_color: Some("red".into()),
                ..Default::default()
            },
        ];
        let (graph, last) = build_filter_graph(&ops).unwrap();
        assert!(graph.contains("boxblur=10:1"));
        assert!(graph.contains("text='Overlay'"));
        assert_eq!(last.as_deref(), Some("op1"));
    }

    #[test]
    fn test_build_filter_graph_skips_empty_text() {
        let ops = vec![VideoOperation {
            mode: OperationMode::Text,
            region: Some(Region { x: 0.0, y: 0.0, w: 100.0, h: 50.0 }),
            text: Some(String::new()),
            font_size: None,
            font_color: None,
            ..Default::default()
        }];
        let (graph, last) = build_filter_graph(&ops).unwrap();
        assert!(graph.is_empty());
        assert!(last.is_none());
    }

    // ── Delogo ──────────────────────────────────────────────────────────

    #[test]
    fn test_build_filter_graph_delogo() {
        let ops = vec![VideoOperation {
            mode: OperationMode::Delogo,
            region: Some(Region { x: 10.0, y: 20.0, w: 100.0, h: 40.0 }),
            ..Default::default()
        }];
        let (graph, last) = build_filter_graph(&ops).unwrap();
        assert!(graph.contains("delogo=x=10:y=20:w=100:h=40:show=0"), "graph={}", graph);
        assert_eq!(last.as_deref(), Some("op0"));
    }

    #[test]
    fn test_build_filter_graph_delogo_with_time_range() {
        let ops = vec![VideoOperation {
            mode: OperationMode::Delogo,
            region: Some(Region { x: 10.0, y: 20.0, w: 100.0, h: 40.0 }),
            start_time: Some(5.0),
            end_time: Some(15.0),
            ..Default::default()
        }];
        let (graph, _) = build_filter_graph(&ops).unwrap();
        assert!(graph.contains("delogo=x=10:y=20:w=100:h=40:show=0"), "graph={}", graph);
        assert!(graph.contains("enable='between(t,5,15)'"), "graph={}", graph);
    }

    #[test]
    fn test_build_filter_graph_delogo_without_region_fails() {
        let ops = vec![VideoOperation {
            mode: OperationMode::Delogo,
            region: None,
            ..Default::default()
        }];
        assert!(build_filter_graph(&ops).is_err());
    }

    #[test]
    fn test_build_filter_graph_delogo_then_text() {
        let ops = vec![
            VideoOperation {
                mode: OperationMode::Delogo,
                region: Some(Region { x: 0.0, y: 0.0, w: 120.0, h: 60.0 }),
                ..Default::default()
            },
            VideoOperation {
                mode: OperationMode::Text,
                region: Some(Region { x: 10.0, y: 10.0, w: 200.0, h: 50.0 }),
                text: Some("Cover".into()),
                font_size: Some(24),
                font_color: Some("white".into()),
                ..Default::default()
            },
        ];
        let (graph, last) = build_filter_graph(&ops).unwrap();
        assert!(graph.contains("delogo=x=0:y=0:w=120:h=60:show=0"), "graph={}", graph);
        assert!(graph.contains("text='Cover'"), "graph={}", graph);
        assert_eq!(last.as_deref(), Some("op1"));
    }

    #[test]
    fn test_build_filter_graph_delogo_multiple_regions() {
        let ops = vec![
            VideoOperation {
                mode: OperationMode::Delogo,
                region: Some(Region { x: 10.0, y: 10.0, w: 80.0, h: 40.0 }),
                ..Default::default()
            },
            VideoOperation {
                mode: OperationMode::Delogo,
                region: Some(Region { x: 500.0, y: 300.0, w: 60.0, h: 30.0 }),
                ..Default::default()
            },
        ];
        let (graph, last) = build_filter_graph(&ops).unwrap();
        assert!(graph.contains("delogo=x=10:y=10:w=80:h=40:show=0"), "graph={}", graph);
        assert!(graph.contains("delogo=x=500:y=300:w=60:h=30:show=0"), "graph={}", graph);
        assert_eq!(last.as_deref(), Some("op1"));
    }

    #[test]
    fn test_operation_mode_delogo_deserializes() {
        assert_eq!(serde_json::from_str::<OperationMode>("\"delogo\"").unwrap(), OperationMode::Delogo);
    }
}
