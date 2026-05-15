#!/usr/bin/env bash
set -euo pipefail

app_path="${1:-src-tauri/target/release/bundle/macos/MiWarp.app}"

if [[ ! -d "$app_path" ]]; then
  echo "App bundle not found: $app_path" >&2
  exit 1
fi

echo "Inspecting signature: $app_path"
codesign -dv --verbose=4 "$app_path"

echo
echo "Verifying bundle signature"
codesign --verify --deep --strict --verbose=4 "$app_path"

echo
echo "Checking Gatekeeper assessment"
spctl -a -t exec -vvv "$app_path"
