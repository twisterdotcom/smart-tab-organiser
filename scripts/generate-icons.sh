#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SOURCE="$ROOT/store-assets/source/icon-1024.png"

if ! command -v sips >/dev/null 2>&1; then
  echo "This script requires the macOS sips command." >&2
  exit 1
fi

if [ ! -f "$SOURCE" ]; then
  echo "Missing icon source: $SOURCE" >&2
  exit 1
fi

sips -z 16 16 "$SOURCE" --out "$ROOT/icons/icon16.png" >/dev/null
sips -z 48 48 "$SOURCE" --out "$ROOT/icons/icon48.png" >/dev/null
sips -z 128 128 "$SOURCE" --out "$ROOT/icons/icon128.png" >/dev/null

printf '%s\n' "Generated icons/icon16.png, icons/icon48.png, and icons/icon128.png."
