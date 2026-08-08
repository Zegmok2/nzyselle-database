//! Media inspection and validation.
//!
//! Every function here shells out to `ffprobe`/`ffmpeg` and never writes to
//! or modifies the source file — per spec ("Never alter the original
//! file"), the only files this module ever creates are new thumbnail/
//! optimized-copy outputs at caller-specified paths.

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum MediaError {
    #[error("ffprobe/ffmpeg was not found on PATH")]
    ToolNotFound,
    #[error("could not read this file as a video: {0}")]
    ProbeFailed(String),
    #[error("unexpected ffprobe output: {0}")]
    UnexpectedOutput(String),
    #[error("thumbnail generation failed: {0}")]
    ThumbnailFailed(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MediaInfo {
    pub duration_seconds: f64,
    pub width: u32,
    pub height: u32,
    pub codec: String,
    pub audio_codec: Option<String>,
    pub frame_rate: f64,
    pub file_size_bytes: u64,
    pub is_vertical: bool,
}

pub fn probe_video(path: &Path) -> Result<MediaInfo, MediaError> {
    let output = Command::new("ffprobe")
        .args([
            "-v", "error",
            "-print_format", "json",
            "-show_format", "-show_streams",
        ])
        .arg(path)
        .output()
        .map_err(|_| MediaError::ToolNotFound)?;

    if !output.status.success() {
        return Err(MediaError::ProbeFailed(String::from_utf8_lossy(&output.stderr).into_owned()));
    }

    let json: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| MediaError::UnexpectedOutput(e.to_string()))?;

    let streams = json["streams"]
        .as_array()
        .ok_or_else(|| MediaError::UnexpectedOutput("no streams array".to_string()))?;

    let video_stream = streams
        .iter()
        .find(|s| s["codec_type"] == "video")
        .ok_or_else(|| MediaError::UnexpectedOutput("no video stream found".to_string()))?;

    let audio_codec = streams
        .iter()
        .find(|s| s["codec_type"] == "audio")
        .and_then(|s| s["codec_name"].as_str())
        .map(|s| s.to_string());

    let width = video_stream["width"].as_u64().unwrap_or(0) as u32;
    let height = video_stream["height"].as_u64().unwrap_or(0) as u32;
    let codec = video_stream["codec_name"].as_str().unwrap_or("unknown").to_string();

    let duration_seconds = json["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .or_else(|| video_stream["duration"].as_str().and_then(|s| s.parse::<f64>().ok()))
        .unwrap_or(0.0);

    let frame_rate = video_stream["r_frame_rate"]
        .as_str()
        .and_then(parse_fraction)
        .unwrap_or(0.0);

    let file_size_bytes = json["format"]["size"]
        .as_str()
        .and_then(|s| s.parse::<u64>().ok())
        .or_else(|| std::fs::metadata(path).ok().map(|m| m.len()))
        .unwrap_or(0);

    Ok(MediaInfo {
        duration_seconds,
        width,
        height,
        codec,
        audio_codec,
        frame_rate,
        file_size_bytes,
        is_vertical: height > width,
    })
}

fn parse_fraction(s: &str) -> Option<f64> {
    let (num, den) = s.split_once('/')?;
    let num: f64 = num.parse().ok()?;
    let den: f64 = den.parse().ok()?;
    if den == 0.0 {
        None
    } else {
        Some(num / den)
    }
}

/// Generates a single JPEG thumbnail at `at_seconds` into the source video.
/// Writes only to `out_path`; the source is opened read-only by ffmpeg.
pub fn generate_thumbnail(path: &Path, out_path: &Path, at_seconds: f64) -> Result<(), MediaError> {
    let output = Command::new("ffmpeg")
        .args(["-y", "-ss"])
        .arg(format!("{at_seconds:.3}"))
        .arg("-i")
        .arg(path)
        .args(["-frames:v", "1", "-q:v", "4"])
        .arg(out_path)
        .output()
        .map_err(|_| MediaError::ToolNotFound)?;

    if !output.status.success() || !out_path.exists() {
        return Err(MediaError::ThumbnailFailed(String::from_utf8_lossy(&output.stderr).into_owned()));
    }
    Ok(())
}

/// Result of asking ffmpeg's `cropdetect` filter to suggest a crop. If the
/// suggested crop is smaller than the source frame, there are likely black
/// bars (letterboxing/pillarboxing) worth warning the user about.
#[derive(Debug, Clone, PartialEq)]
pub struct CropSuggestion {
    pub width: u32,
    pub height: u32,
    pub x: u32,
    pub y: u32,
}

pub fn detect_black_bars(path: &Path, source: &MediaInfo) -> Result<Option<CropSuggestion>, MediaError> {
    // Sample a handful of frames partway into the clip -- an opening/closing
    // fade-to-black would otherwise get misread as a permanent black bar.
    let sample_at = (source.duration_seconds / 3.0).max(0.1);
    let output = Command::new("ffmpeg")
        .args(["-hide_banner", "-ss"])
        .arg(format!("{sample_at:.3}"))
        .arg("-i")
        .arg(path)
        .args(["-vframes", "12", "-vf", "cropdetect=24:2:0", "-f", "null", "-"])
        .output()
        .map_err(|_| MediaError::ToolNotFound)?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    let last_crop = stderr
        .lines()
        .filter_map(|line| line.rsplit_once("crop="))
        .filter_map(|(_, rest)| parse_crop(rest))
        .next_back();

    match last_crop {
        Some(crop) if crop.width < source.width || crop.height < source.height => Ok(Some(crop)),
        _ => Ok(None),
    }
}

fn parse_crop(s: &str) -> Option<CropSuggestion> {
    let s = s.split_whitespace().next()?;
    let mut parts = s.split(':');
    Some(CropSuggestion {
        width: parts.next()?.parse().ok()?,
        height: parts.next()?.parse().ok()?,
        x: parts.next()?.parse().ok()?,
        y: parts.next()?.parse().ok()?,
    })
}

// ---------------------------------------------------------------------
// Platform-limit validation. Pure logic, no ffmpeg -- deliberately
// separate from probing so it can be unit tested against synthetic
// MediaInfo values without spawning a process for every case.
// ---------------------------------------------------------------------
#[derive(Debug, Clone, Default)]
pub struct PlatformLimits {
    pub max_duration_seconds: Option<f64>,
    pub max_file_size_bytes: Option<u64>,
    pub supported_codecs: Option<Vec<String>>,
    pub requires_vertical: bool,
}

pub fn validate_against_limits(info: &MediaInfo, limits: &PlatformLimits) -> Vec<String> {
    let mut issues = Vec::new();

    if let Some(max) = limits.max_duration_seconds {
        if info.duration_seconds > max {
            issues.push(format!(
                "Duration {:.1}s exceeds this platform's {:.0}s limit.",
                info.duration_seconds, max
            ));
        }
    }
    if let Some(max) = limits.max_file_size_bytes {
        if info.file_size_bytes > max {
            issues.push(format!(
                "File size {:.1} MB exceeds this platform's {:.0} MB limit.",
                info.file_size_bytes as f64 / 1_000_000.0,
                max as f64 / 1_000_000.0
            ));
        }
    }
    if let Some(codecs) = &limits.supported_codecs {
        if !codecs.iter().any(|c| c.eq_ignore_ascii_case(&info.codec)) {
            issues.push(format!(
                "Codec '{}' isn't in this platform's supported list ({}). An optimized copy will be needed.",
                info.codec,
                codecs.join(", ")
            ));
        }
    }
    if limits.requires_vertical && !info.is_vertical {
        issues.push("This platform expects a vertical (portrait) video.".to_string());
    }

    issues
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_video(dir: &Path, name: &str, w: u32, h: u32, duration: f64) -> std::path::PathBuf {
        let out = dir.join(name);
        let status = Command::new("ffmpeg")
            .args(["-y", "-f", "lavfi", "-i"])
            .arg(format!("testsrc2=size={w}x{h}:rate=30:duration={duration}"))
            .args(["-c:v", "libx264", "-pix_fmt", "yuv420p"])
            .arg(&out)
            .status()
            .expect("ffmpeg must be available for this test");
        assert!(status.success());
        out
    }

    fn make_letterboxed_video(dir: &Path, name: &str) -> std::path::PathBuf {
        // 640x480 content padded with black bars into a 640x800 canvas --
        // simulates a horizontally-shot clip dropped into a vertical frame.
        let out = dir.join(name);
        let status = Command::new("ffmpeg")
            .args(["-y", "-f", "lavfi", "-i", "testsrc2=size=640x480:rate=30:duration=3"])
            .args(["-vf", "pad=640:800:0:160:black"])
            .args(["-c:v", "libx264", "-pix_fmt", "yuv420p"])
            .arg(&out)
            .status()
            .expect("ffmpeg must be available for this test");
        assert!(status.success());
        out
    }

    #[test]
    fn probes_a_horizontal_video_correctly() {
        let dir = std::env::temp_dir().join(format!("nzy_media_test_{}", crate::ids::generate_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = make_test_video(&dir, "horizontal.mp4", 640, 360, 3.0);

        let info = probe_video(&path).unwrap();
        assert_eq!(info.width, 640);
        assert_eq!(info.height, 360);
        assert!(!info.is_vertical);
        assert!((info.duration_seconds - 3.0).abs() < 0.3);
        assert_eq!(info.codec, "h264");
        assert!(info.file_size_bytes > 0);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn probes_a_vertical_video_and_flags_it_as_vertical() {
        let dir = std::env::temp_dir().join(format!("nzy_media_test_{}", crate::ids::generate_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = make_test_video(&dir, "vertical.mp4", 1080, 1920, 2.0);

        let info = probe_video(&path).unwrap();
        assert!(info.is_vertical);
        assert_eq!(info.width, 1080);
        assert_eq!(info.height, 1920);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn generates_a_real_thumbnail_without_touching_the_source() {
        let dir = std::env::temp_dir().join(format!("nzy_media_test_{}", crate::ids::generate_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = make_test_video(&dir, "src.mp4", 640, 360, 2.0);
        let source_size_before = std::fs::metadata(&path).unwrap().len();

        let thumb_path = dir.join("thumb.jpg");
        generate_thumbnail(&path, &thumb_path, 0.5).unwrap();

        assert!(thumb_path.exists());
        assert!(std::fs::metadata(&thumb_path).unwrap().len() > 0);
        assert_eq!(
            std::fs::metadata(&path).unwrap().len(),
            source_size_before,
            "source file must be byte-for-byte unchanged"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn detects_letterboxing_on_a_padded_video() {
        let dir = std::env::temp_dir().join(format!("nzy_media_test_{}", crate::ids::generate_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = make_letterboxed_video(&dir, "letterboxed.mp4");
        let info = probe_video(&path).unwrap();

        let crop = detect_black_bars(&path, &info).unwrap();
        assert!(crop.is_some(), "expected cropdetect to notice the padded black bars");
        let crop = crop.unwrap();
        assert!(crop.height < info.height, "suggested crop height should be smaller than the padded frame");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn no_false_positive_black_bar_on_a_clean_full_frame_video() {
        let dir = std::env::temp_dir().join(format!("nzy_media_test_{}", crate::ids::generate_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = make_test_video(&dir, "clean.mp4", 640, 360, 2.0);
        let info = probe_video(&path).unwrap();

        let crop = detect_black_bars(&path, &info).unwrap();
        assert!(crop.is_none(), "a full-frame video with no padding shouldn't trigger a crop suggestion");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn validates_duration_and_size_limits() {
        let info = MediaInfo {
            duration_seconds: 200.0,
            width: 1080,
            height: 1920,
            codec: "h264".to_string(),
            audio_codec: Some("aac".to_string()),
            frame_rate: 30.0,
            file_size_bytes: 600_000_000,
            is_vertical: true,
        };
        let limits = PlatformLimits {
            max_duration_seconds: Some(180.0),
            max_file_size_bytes: Some(500_000_000),
            supported_codecs: Some(vec!["h264".to_string()]),
            requires_vertical: true,
        };
        let issues = validate_against_limits(&info, &limits);
        assert_eq!(issues.len(), 2, "expected exactly duration + size issues: {issues:?}");
        assert!(issues.iter().any(|i| i.contains("Duration")));
        assert!(issues.iter().any(|i| i.contains("File size")));
    }

    #[test]
    fn a_fully_compliant_video_has_no_issues() {
        let info = MediaInfo {
            duration_seconds: 15.0,
            width: 1080,
            height: 1920,
            codec: "h264".to_string(),
            audio_codec: Some("aac".to_string()),
            frame_rate: 30.0,
            file_size_bytes: 5_000_000,
            is_vertical: true,
        };
        let limits = PlatformLimits {
            max_duration_seconds: Some(180.0),
            max_file_size_bytes: Some(500_000_000),
            supported_codecs: Some(vec!["h264".to_string()]),
            requires_vertical: true,
        };
        assert!(validate_against_limits(&info, &limits).is_empty());
    }
}
