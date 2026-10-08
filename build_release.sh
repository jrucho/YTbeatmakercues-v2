#!/bin/bash
set -e
ver=$(grep -m 1 '"version"' manifest.json | cut -d '"' -f 4)
zip_name="ytbeatmakercues-$ver.zip"
# exclude git files and previous zips
zip -r "$zip_name" . -x '*.git*' 'ytbeatmakercues-*.zip' 'build_release.sh' 'tests/*' '.DS_Store' '*/.DS_Store' 'node_modules/.package-lock.json' 'node_modules/signalsmith-stretch/SignalsmithStretch.js'
