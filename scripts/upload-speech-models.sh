#!/usr/bin/env bash
# Publishes the dictation models pinned in src-tauri/src/dictation/models.rs to the Precipice
# R2 model bucket. Files are verified against the pinned SHA-256 before upload, so the bucket
# can only ever hold the exact bytes the app accepts.
#
# Requires the AWS CLI (R2 speaks S3; wrangler cannot upload files this large) and an R2 API
# token scoped to the model bucket only:
#   R2_ACCOUNT_ID=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
#   R2_MODEL_BUCKET=precipice-models scripts/upload-speech-models.sh ./models-dir
#
# Get the source files once from https://huggingface.co/ggerganov/whisper.cpp (same names).
# The app build then needs PRECIPICE_MODELS_URL set to the bucket's custom domain, e.g.
# https://models.example.com — not the rate-limited r2.dev URL.
set -euo pipefail

dir="${1:?usage: upload-speech-models.sh <dir with the .bin files>}"
: "${R2_ACCOUNT_ID:?set R2_ACCOUNT_ID}" "${R2_MODEL_BUCKET:?set R2_MODEL_BUCKET}"
endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
pins="$(dirname "$0")/../src-tauri/src/dictation/models.rs"

# file, sha256 pairs, read from the Rust source so there is one list of pins.
pairs=$(awk -F'"' '/#\[cfg\(test\)\]/ {exit} /file:/ {f=$2} /sha256:/ && f {print f, $2; f=""}' "$pins")
[ -n "$pairs" ] || { echo "no pins found in $pins" >&2; exit 1; }

while read -r file sha; do
  path="$dir/$file"
  [ -f "$path" ] || { echo "missing $path" >&2; exit 1; }
  actual=$(shasum -a 256 "$path" | cut -d' ' -f1)
  [ "$actual" = "$sha" ] || { echo "hash mismatch for $file" >&2; exit 1; }
  echo "uploading $file"
  aws s3 cp "$path" "s3://${R2_MODEL_BUCKET}/${file}" \
    --endpoint-url "$endpoint" \
    --content-type application/octet-stream \
    --cache-control "public, max-age=31536000, immutable"
done <<<"$pairs"
echo "done"
