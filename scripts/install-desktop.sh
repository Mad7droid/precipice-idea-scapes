#!/usr/bin/env bash
# Build Precipice for macOS and replace the copy in /Applications.
#
# This keeps exactly one installed app: the staged bundle under src-tauri/target
# is removed afterwards so Spotlight cannot index a second "Precipice".
set -euo pipefail

cd "$(dirname "$0")/.."

IDENTIFIER="dev.precipice.desktop"
STAGED="src-tauri/target/release/bundle/macos/Precipice.app"
INSTALLED="/Applications/Precipice.app"

# Vite inlines these at build time. Without them the app calls its own origin
# (tauri://localhost) and publishing fails with an unreadable response.
# PRECIPICE_MODELS_URL is read by the native build (dictation model source).
for name in VITE_PUBLICATION_API_URL VITE_MCP_URL VITE_TURNSTILE_SITE_KEY PRECIPICE_MODELS_URL; do
  if [ -z "${!name:-}" ] && command -v gh >/dev/null 2>&1; then
    value="$(gh variable get "$name" 2>/dev/null || true)"
    [ -n "$value" ] && export "$name=$value"
  fi
done
if [ -z "${VITE_PUBLICATION_API_URL:-}" ] &&
  ! grep -qs '^VITE_PUBLICATION_API_URL=https://' .env .env.local .env.production .env.production.local; then
  echo "VITE_PUBLICATION_API_URL is not set and could not be read from the GitHub repo variables." >&2
  echo "Export it (see .env.example) and run again." >&2
  exit 1
fi

pnpm tauri build --bundles app

if [ ! -d "$STAGED" ]; then
  echo "Build produced no app bundle at $STAGED" >&2
  exit 1
fi

# Verify the full bundle seal before replacing the installed app.
codesign --verify --deep --strict "$STAGED"

# Checked right before replacement: the build takes minutes and the app may have been
# opened meanwhile.
# Stdio helpers may remain alive after the GUI quits. They have no unsaved document and
# reconnect after the user reopens the app, so they must not block an update.
refuse_if_running() {
while IFS= read -r process_id; do
  command_line="$(ps -p "$process_id" -o command= 2>/dev/null || true)"
  case "$command_line" in
    */Precipice.app/Contents/MacOS/precipice-desktop\ --mcp) ;;
    */Precipice.app/Contents/MacOS/precipice-desktop*)
      echo "Precipice is running. Quit it first; replacing a running app loses unsaved work." >&2
      exit 1
      ;;
  esac
done < <(pgrep -f "Precipice.app/Contents/MacOS/precipice-desktop" || true)
}

refuse_if_running

# Never delete something that is not our app.
if [ -e "$INSTALLED" ]; then
  existing="$(/usr/libexec/PlistBuddy -c Print:CFBundleIdentifier "$INSTALLED/Contents/Info.plist" 2>/dev/null || true)"
  if [ "$existing" != "$IDENTIFIER" ]; then
    echo "$INSTALLED is not $IDENTIFIER (found: ${existing:-none}). Refusing to replace it." >&2
    exit 1
  fi
fi

# Atomic replace: copy beside the target, then swap, so an interrupted copy never leaves a
# half-installed app at the stable path agent configs point to.
NEXT="/Applications/.Precipice.app.new"
OLD="/Applications/.Precipice.app.old"
rm -rf "$NEXT" "$OLD"
ditto "$STAGED" "$NEXT"
if [ -e "$INSTALLED" ]; then mv "$INSTALLED" "$OLD"; fi
mv "$NEXT" "$INSTALLED"
rm -rf "$OLD"

# Drop the staged copy so only the installed app is indexed and launchable.
rm -rf "$STAGED"

version="$(/usr/libexec/PlistBuddy -c Print:CFBundleShortVersionString "$INSTALLED/Contents/Info.plist")"
echo "Installed Precipice $version to $INSTALLED"
echo "The ad-hoc signature changes on every build, so macOS asks for Keychain access again."
