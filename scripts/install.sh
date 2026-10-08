#!/usr/bin/env bash
# Builds the plugin and copies it into a vault: scripts/install.sh ~/path/to/vault
set -euo pipefail
vault="${1:?usage: scripts/install.sh <vault folder>}"
cd "$(dirname "$0")/.."
npm run build
target="$vault/.obsidian/plugins/topos-bible"
mkdir -p "$target"
cp dist/main.js dist/manifest.json dist/styles.css "$target/"
echo "Installed to $target; enable \"Topos Bible\" under Settings → Community plugins"
