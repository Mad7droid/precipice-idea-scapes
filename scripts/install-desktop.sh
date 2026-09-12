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

if pgrep -f "Precipice.app/Contents/MacOS/precipice-desktop" >/dev/null 2>&1; then
  echo "Precipice is running. Quit it first; replacing a running app loses unsaved work." >&2
  exit 1
fi

pnpm tauri build --bundles app

if [ ! -d "$STAGED" ]; then
  echo "Build produced no app bundle at $STAGED" >&2
  exit 1
fi

# Never delete something that is not our app.
if [ -e "$INSTALLED" ]; then
  existing="$(/usr/libexec/PlistBuddy -c Print:CFBundleIdentifier "$INSTALLED/Contents/Info.plist" 2>/dev/null || true)"
  if [ "$existing" != "$IDENTIFIER" ]; then
    echo "$INSTALLED is not $IDENTIFIER (found: ${existing:-none}). Refusing to replace it." >&2
    exit 1
  fi
  rm -rf "$INSTALLED"
fi

cp -R "$STAGED" "$INSTALLED"

# Drop the staged copy so only the installed app is indexed and launchable.
rm -rf "$STAGED"

version="$(/usr/libexec/PlistBuddy -c Print:CFBundleShortVersionString "$INSTALLED/Contents/Info.plist")"
echo "Installed Precipice $version to $INSTALLED"
echo "The ad-hoc signature changes on every build, so macOS asks for Keychain access again."
