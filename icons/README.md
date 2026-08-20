# Extension icons

This directory contains the PNG icons that Chrome loads from `manifest.json`.

- `icon16.png`: Toolbar icon at `16x16` pixels.
- `icon48.png`: Extension-management icon at `48x48` pixels.
- `icon128.png`: Chrome Web Store icon at `128x128` pixels.

The high-resolution source is `store-assets/source/icon-1024.png`.

On macOS, regenerate all runtime icons from the repository root:

```sh
./scripts/generate-icons.sh
```

Then build the release ZIP. The release builder stops if an icon has an incorrect size.
