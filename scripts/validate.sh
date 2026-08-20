#!/bin/sh
set -eu

node --check background.js
node --check ai-models.js
node --check options.js
node --test tests/background.test.js
python3 scripts/build-release.py
printf '%s\n' "Package validation passed. Run scripts/validate-store-assets.py before store submission."
