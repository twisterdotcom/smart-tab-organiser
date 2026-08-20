#!/bin/sh
set -eu

node --check background.js
node --check ai-models.js
node --check options.js
node --test tests/*.test.js
python3 scripts/validate-store-assets.py
python3 scripts/build-release.py
printf '%s\n' "Release validation passed."
