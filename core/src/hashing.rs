//! Content hashing for duplicate detection ("VideoAsset.hash for duplicate
//! detection" / "warn when the same file was already posted").
//!
//! Streams the file in fixed-size chunks rather than reading it fully into
//! memory — the spec explicitly requires the app "avoid loading full
//! videos into memory," and source recordings can be hundreds of MB.

use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{self, Read};
use std::path::Path;

const CHUNK_SIZE: usize = 1024 * 1024; // 1 MB

pub fn hash_file(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; CHUNK_SIZE];

    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }

    Ok(format!("sha256:{:x}", hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_temp(name: &str, contents: &[u8]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("nzy_hash_test_{}", crate::ids::generate_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        let mut f = File::create(&path).unwrap();
        f.write_all(contents).unwrap();
        path
    }

    #[test]
    fn identical_content_hashes_the_same() {
        let a = write_temp("a.mp4", b"identical bytes here, pretend this is video data");
        let b = write_temp("b.mp4", b"identical bytes here, pretend this is video data");
        assert_eq!(hash_file(&a).unwrap(), hash_file(&b).unwrap());
    }

    #[test]
    fn different_content_hashes_differently() {
        let a = write_temp("a.mp4", b"video one");
        let b = write_temp("b.mp4", b"video two, definitely not the same");
        assert_ne!(hash_file(&a).unwrap(), hash_file(&b).unwrap());
    }

    #[test]
    fn hash_is_prefixed_with_the_algorithm_name() {
        let a = write_temp("a.mp4", b"some content");
        assert!(hash_file(&a).unwrap().starts_with("sha256:"));
    }

    #[test]
    fn handles_a_file_larger_than_one_chunk() {
        // 3 MB of repeating data, larger than CHUNK_SIZE, to exercise the
        // multi-read loop rather than the single-read fast path.
        let data = vec![0x42u8; 3 * 1024 * 1024];
        let a = write_temp("big.mp4", &data);
        let hash = hash_file(&a).unwrap();
        assert!(hash.starts_with("sha256:"));
        assert_eq!(hash.len(), "sha256:".len() + 64);
    }
}
