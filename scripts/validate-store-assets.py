#!/usr/bin/env python3
"""Validate Chrome Web Store listing images."""

from __future__ import annotations

import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROMOTIONAL = ROOT / "store-assets" / "promotional"
SCREENSHOTS = ROOT / "store-assets" / "screenshots"


def png_dimensions(path: Path) -> tuple[int, int] | None:
    try:
        data = path.read_bytes()[:24]
    except OSError:
        return None
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return struct.unpack(">II", data[16:24])


def main() -> None:
    errors: list[str] = []
    required_images = {
        PROMOTIONAL / "small-promo-440x280.png": (440, 280),
    }
    optional_images = {
        PROMOTIONAL / "marquee-promo-1400x560.png": (1400, 560),
    }

    for path, expected in required_images.items():
        actual = png_dimensions(path)
        if actual is None:
            errors.append(f"Missing or invalid PNG: {path.relative_to(ROOT)}")
        elif actual != expected:
            errors.append(f"{path.relative_to(ROOT)} is {actual}; expected {expected}")

    for path, expected in optional_images.items():
        if path.exists():
            actual = png_dimensions(path)
            if actual != expected:
                errors.append(f"{path.relative_to(ROOT)} is {actual}; expected {expected}")

    screenshot_paths = sorted(SCREENSHOTS.glob("*.png"))
    if not screenshot_paths:
        errors.append("Add at least one PNG screenshot to store-assets/screenshots/")
    else:
        valid_sizes = {(1280, 800), (640, 400)}
        for path in screenshot_paths:
            actual = png_dimensions(path)
            if actual not in valid_sizes:
                errors.append(
                    f"{path.relative_to(ROOT)} is {actual}; expected 1280x800 or 640x400"
                )

    if errors:
        for error in errors:
            print(f"Store asset error: {error}", file=sys.stderr)
        raise SystemExit(1)

    print(f"Validated {len(screenshot_paths)} screenshot(s) and the promotional images.")


if __name__ == "__main__":
    main()
