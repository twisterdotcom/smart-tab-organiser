# Chrome Web Store assets

This directory contains source files and listing images. The release ZIP does not include this directory.

## Included assets

- `source/icon-1024.png`: High-resolution source for the extension icon.
- `promotional/small-promo-440x280.png`: Required small promotional image.
- `promotional/marquee-promo-1400x560.png`: Optional marquee promotional image.
- `screenshots/`: Screenshots of the installed extension.

## Generate assets

Generate the manifest icons:

```sh
./scripts/generate-icons.sh
```

Generate the promotional images on macOS:

```sh
swift scripts/generate-store-assets.swift
```

Validate all listing images:

```sh
python3 scripts/validate-store-assets.py
```

This command fails until `screenshots/` contains at least one valid PNG screenshot.

## Screenshot requirements

Chrome accepts screenshots at `1280x800` or `640x400`. Use `1280x800` for this extension.

Before upload, make sure that each screenshot:

- Shows the installed extension or its options page.
- Contains no API key, GitHub token, private URL, or personal account data.
- Has square corners and no added border.
- Matches the current extension version.

The store requires at least one screenshot. It accepts up to five screenshots.
