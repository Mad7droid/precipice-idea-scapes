//! Speech model files: which one this Mac uses, where it lives, and installing it from the
//! Precipice model host. The host is fixed at build time and every file is pinned by size and
//! SHA-256, so a compromised or misconfigured host can at worst fail the install.

use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

pub struct ModelSpec {
    pub file: &'static str,
    pub bytes: u64,
    pub sha256: &'static str,
}

/// Whisper large-v3-turbo, 5-bit. Good English and usable Hindi at several times real time on
/// Apple Silicon with Metal.
pub const TURBO: ModelSpec = ModelSpec {
    file: "ggml-large-v3-turbo-q5_0.bin",
    bytes: 574_041_195,
    sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
};

/// Whisper small, 5-bit. For Intel Macs, where turbo is too slow to feel like typing.
pub const SMALL: ModelSpec = ModelSpec {
    file: "ggml-small-q5_1.bin",
    bytes: 190_085_487,
    sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb",
};

pub fn current() -> &'static ModelSpec {
    if cfg!(target_arch = "aarch64") {
        &TURBO
    } else {
        &SMALL
    }
}

/// Set by the release build. Unset means this build cannot install a model, and says so.
pub fn host() -> Option<&'static str> {
    option_env!("PRECIPICE_MODELS_URL").filter(|url| valid_host(url))
}

fn valid_host(url: &str) -> bool {
    let Ok(parsed) = tauri::Url::parse(url) else { return false };
    parsed.scheme() == "https"
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && parsed.query().is_none()
        && parsed.fragment().is_none()
}

fn url_for(host: &str, spec: &ModelSpec) -> String {
    format!("{}/{}", host.trim_end_matches('/'), spec.file)
}

fn marker(path: &Path) -> PathBuf {
    path.with_extension("verified")
}

/// The model's path once its bytes are known good. A file placed by hand is hashed once, then
/// trusted through a marker so later launches do not re-read half a gigabyte.
pub fn installed(dir: &Path, spec: &ModelSpec) -> Option<PathBuf> {
    let path = dir.join(spec.file);
    if fs::metadata(&path).ok()?.len() != spec.bytes {
        return None;
    }
    if fs::read_to_string(marker(&path)).ok().as_deref() == Some(spec.sha256) {
        return Some(path);
    }
    let mut hasher = Sha256::new();
    let mut reader = BufReader::with_capacity(1 << 20, File::open(&path).ok()?);
    std::io::copy(&mut reader, &mut hasher).ok()?;
    if hex(&hasher.finalize()) != spec.sha256 {
        return None;
    }
    fs::write(marker(&path), spec.sha256).ok()?;
    Some(path)
}

pub fn install(
    dir: &Path,
    host: &str,
    spec: &ModelSpec,
    cancel: &AtomicBool,
    mut progress: impl FnMut(u64, u64),
) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|_| "Could not create the model folder")?;
    let final_path = dir.join(spec.file);
    let part = dir.join(format!("{}.part", spec.file));

    // Resume: the bytes already on disk feed the hash first, then the rest is appended.
    let mut hasher = Sha256::new();
    let mut have = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    if have > spec.bytes {
        let _ = fs::remove_file(&part);
        have = 0;
    }
    if have > 0 {
        let mut reader = BufReader::new(File::open(&part).map_err(|_| "Could not resume")?);
        std::io::copy(&mut reader, &mut hasher).map_err(|_| "Could not resume")?;
    }

    let agent: ureq::Agent = ureq::Agent::config_builder()
        .https_only(true)
        .max_redirects(0)
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_recv_body(None)
        .build()
        .into();
    let mut request = agent.get(url_for(host, spec));
    if have > 0 {
        request = request.header("Range", format!("bytes={have}-"));
    }
    let response = request.call().map_err(|_| "Could not reach the model host")?;
    if response.status().as_u16() == 200 && have > 0 {
        // The host ignored the range; start over.
        hasher = Sha256::new();
        have = 0;
    } else if response.status().as_u16() != 206 && response.status().as_u16() != 200 {
        return Err("The model host refused the download".into());
    }

    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .append(have > 0)
        .truncate(have == 0)
        .open(&part)
        .map_err(|_| "Could not write the model")?;
    let mut writer = BufWriter::with_capacity(1 << 20, file);
    let mut reader = response.into_body().into_reader();
    let mut buffer = vec![0u8; 1 << 16];
    let mut received = have;
    let mut reported = 0u64;
    loop {
        if cancel.load(Ordering::Relaxed) {
            writer.flush().ok();
            return Err("cancelled".into());
        }
        let n = reader.read(&mut buffer).map_err(|_| "The download was interrupted")?;
        if n == 0 {
            break;
        }
        received += n as u64;
        if received > spec.bytes {
            drop(writer);
            let _ = fs::remove_file(&part);
            return Err("The model host sent an unexpected file".into());
        }
        hasher.update(&buffer[..n]);
        writer.write_all(&buffer[..n]).map_err(|_| "Could not write the model")?;
        if received - reported >= spec.bytes / 200 {
            reported = received;
            progress(received, spec.bytes);
        }
    }
    writer.flush().map_err(|_| "Could not write the model")?;
    drop(writer);

    if received != spec.bytes {
        return Err("The download was interrupted".into());
    }
    if hex(&hasher.finalize()) != spec.sha256 {
        let _ = fs::remove_file(&part);
        return Err("The downloaded model failed its integrity check".into());
    }
    fs::rename(&part, &final_path).map_err(|_| "Could not install the model")?;
    fs::write(marker(&final_path), spec.sha256).map_err(|_| "Could not install the model")?;
    progress(spec.bytes, spec.bytes);
    Ok(final_path)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("precipice-models-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn accepts_only_plain_https_hosts() {
        assert!(valid_host("https://models.example.com"));
        assert!(valid_host("https://models.example.com/whisper/"));
        assert!(!valid_host("http://models.example.com"));
        assert!(!valid_host("https://user:pw@models.example.com"));
        assert!(!valid_host("https://models.example.com/?redirect=x"));
        assert!(!valid_host("file:///tmp/models"));
        assert_eq!(
            url_for("https://m.example.com/w/", &SMALL),
            "https://m.example.com/w/ggml-small-q5_1.bin"
        );
    }

    #[test]
    fn verifies_by_hash_and_remembers() {
        let dir = temp_dir("verify");
        let spec = ModelSpec {
            file: "m.bin",
            bytes: 5,
            sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        };
        assert!(installed(&dir, &spec).is_none());
        fs::write(dir.join("m.bin"), b"hello").unwrap();
        assert!(installed(&dir, &spec).is_some());
        assert!(marker(&dir.join("m.bin")).exists());

        fs::remove_file(marker(&dir.join("m.bin"))).unwrap();
        fs::write(dir.join("m.bin"), b"jello").unwrap();
        assert!(installed(&dir, &spec).is_none());
        let _ = fs::remove_dir_all(&dir);
    }
}
