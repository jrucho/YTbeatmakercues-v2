#!/bin/bash
set -euo pipefail
# Always create a fresh archive from runtime assets. Updating an old zip could
# retain a model even after adding exclusions. Reference imports never enter it.
python3 - "${1:-}" <<'PY'
import json
import pathlib
import sys
import zipfile

root = pathlib.Path(__file__).resolve().parent
version = json.loads((root / 'manifest.json').read_text())['version']
destination = sys.argv[1] or f'ytbeatmakercues-{version}.zip'
files = [root / name for name in (
    'manifest.json', 'background.js', 'content.js', 'ui-tooltips.js', 'vj-live.js', 'style.css',
    'popup.html', 'options.html', 'options.js', 'icon.png', 'README.md',
    'THIRD_PARTY_NOTICES.md', 'STEMS-2.4-EXPORT.md',
)]
for directory in ('sounds', 'worklets', 'addons/stems', 'node_modules/signalsmith-stretch'):
    files.extend(path for path in (root / directory).rglob('*') if path.is_file())
with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(set(files)):
        relative = path.relative_to(root)
        if path.name == '.DS_Store' or path.suffix == '.onnx' or 'model' in relative.parts:
            continue
        if relative.as_posix() == 'node_modules/signalsmith-stretch/SignalsmithStretch.js':
            continue
        archive.write(path, relative.as_posix())
with zipfile.ZipFile(destination) as archive:
    assert archive.testzip() is None
    assert not any(name.endswith('.onnx') or '/model/' in name for name in archive.namelist())
    print(f'{destination}: {len(archive.namelist())} files; no model included')
PY
