//! Watch-folder scanning and "finished writing" detection.
//!
//! A screen recorder can still be flushing a file to disk when the OS
//! first reports it existing. Per spec ("Wait until the file has finished
//! writing... Never post it automatically without an approved publishing
//! job"), this module only ever *detects and stabilizes* a candidate file
//! — it never triggers any posting action itself.

use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::time::sleep;

pub const SUPPORTED_EXTENSIONS: &[&str] = &["mp4", "mov", "m4v", "webm", "mkv", "avi"];

pub fn is_supported_video_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| SUPPORTED_EXTENSIONS.iter().any(|s| s.eq_ignore_ascii_case(e)))
        .unwrap_or(false)
}

pub fn scan_directory_for_videos(dir: &Path) -> std::io::Result<Vec<PathBuf>> {
    let mut found = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() && is_supported_video_extension(&path) {
            found.push(path);
        }
    }
    found.sort();
    Ok(found)
}

/// Polls the file's size every `poll_interval` and considers it "finished
/// writing" once the size hasn't changed for `required_stable_checks` polls
/// in a row. Returns an error if the file disappears while waiting (e.g.
/// the user deleted a partial/aborted recording).
pub async fn wait_until_stable(
    path: &Path,
    poll_interval: Duration,
    required_stable_checks: u32,
) -> std::io::Result<u64> {
    let mut last_size: Option<u64> = None;
    let mut stable_count = 0u32;

    loop {
        let size = std::fs::metadata(path)?.len();
        match last_size {
            Some(prev) if prev == size => {
                stable_count += 1;
                if stable_count >= required_stable_checks {
                    return Ok(size);
                }
            }
            _ => {
                stable_count = 0;
            }
        }
        last_size = Some(size);
        sleep(poll_interval).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::io::Write;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nzy_watch_test_{}", crate::ids::generate_id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn recognizes_all_spec_listed_extensions_case_insensitively() {
        for ext in ["mp4", "MP4", "Mov", "m4v", "WEBM", "mkv", "AvI"] {
            let p = PathBuf::from(format!("clip.{ext}"));
            assert!(is_supported_video_extension(&p), "expected {ext} to be recognized");
        }
    }

    #[test]
    fn rejects_non_video_extensions() {
        for ext in ["txt", "jpg", "srt", "exe"] {
            let p = PathBuf::from(format!("file.{ext}"));
            assert!(!is_supported_video_extension(&p), "expected {ext} to be rejected");
        }
    }

    #[test]
    fn scans_a_directory_and_returns_only_compatible_videos() {
        let dir = temp_dir();
        for name in ["a.mp4", "notes.txt", "b.MOV", "thumb.jpg", "c.webm"] {
            File::create(dir.join(name)).unwrap();
        }
        let found = scan_directory_for_videos(&dir).unwrap();
        let names: Vec<String> = found.iter().map(|p| p.file_name().unwrap().to_string_lossy().into_owned()).collect();
        assert_eq!(names, vec!["a.mp4", "b.MOV", "c.webm"]);
        fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn does_not_report_stable_while_a_file_is_still_growing() {
        let dir = temp_dir();
        let path = dir.join("recording.mp4");
        let mut f = File::create(&path).unwrap();
        f.write_all(b"partial").unwrap();

        let path_for_writer = path.clone();
        let writer = tokio::spawn(async move {
            // Simulate a recorder still appending data for a bit.
            for _ in 0..3 {
                sleep(Duration::from_millis(30)).await;
                let mut f = std::fs::OpenOptions::new().append(true).open(&path_for_writer).unwrap();
                f.write_all(b"more-data").unwrap();
            }
        });

        let final_size = wait_until_stable(&path, Duration::from_millis(15), 3).await.unwrap();
        writer.await.unwrap();

        // Must have waited past all three appends -- final size includes them.
        assert_eq!(final_size, "partial".len() as u64 + 3 * "more-data".len() as u64);
        fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn reports_ready_quickly_for_a_file_that_was_never_touched_again() {
        let dir = temp_dir();
        let path = dir.join("already-done.mp4");
        fs::write(&path, b"complete file, never modified again").unwrap();

        let size = wait_until_stable(&path, Duration::from_millis(10), 2).await.unwrap();
        assert_eq!(size, "complete file, never modified again".len() as u64);
        fs::remove_dir_all(&dir).ok();
    }
}
