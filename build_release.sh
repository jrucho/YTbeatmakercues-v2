#!/bin/bash
set -euo pipefail

ver=$(grep -oP '"version"\s*:\s*"\K[^"]+' manifest.json)
zip_name="ytbeatmakercues-$ver.zip"

tmp_dir=$(mktemp -d)
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

# Copy repository contents to a temp directory for packaging
rsync -a \
  --exclude='.git' \
  --exclude='.gitignore' \
  --exclude='ytbeatmakercues-*.zip' \
  --exclude='build_release.sh' \
  ./ "$tmp_dir/"

# Generate PNG icons into the temp directory
python3 icons/generate_pad_icon.py --out "$tmp_dir/icons"

# Rewrite manifest icons to point at the generated PNG assets
python3 - <<'PY' "$tmp_dir/manifest.json"
from __future__ import annotations

import json
import sys
from pathlib import Path

manifest_path = Path(sys.argv[1])
manifest = json.loads(manifest_path.read_text())

png_icons = {
    "16": "icons/pad-16.png",
    "32": "icons/pad-32.png",
    "48": "icons/pad-48.png",
    "128": "icons/pad-128.png",
}

manifest.setdefault("action", {})
manifest["action"]["default_icon"] = {k: v for k, v in png_icons.items() if int(k) <= 48}
manifest["icons"] = png_icons

manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
PY

(cd "$tmp_dir" && zip -r "../$zip_name" .)

echo "Created $zip_name"
