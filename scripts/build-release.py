#!/usr/bin/env python3
"""Build and validate the Chrome Web Store upload package."""

from __future__ import annotations

import json
import re
import struct
import sys
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from typing import NoReturn, cast, final

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"

PACKAGE_FILES = (
    "manifest.json",
    "background.js",
    "ai-models.js",
    "options.html",
    "options.css",
    "options.js",
    "PRIVACY_POLICY.md",
    "LICENSE",
    "icons/icon16.png",
    "icons/icon48.png",
    "icons/icon128.png",
)

ICON_SIZES = {
    "icons/icon16.png": (16, 16),
    "icons/icon48.png": (48, 48),
    "icons/icon128.png": (128, 128),
}

REMOTE_EXECUTABLE_PATTERNS = (
    re.compile(r"<script[^>]+src=[\"']https?://", re.IGNORECASE),
    re.compile(r"<link[^>]+rel=[\"']stylesheet[\"'][^>]+href=[\"']https?://", re.IGNORECASE),
    re.compile(r"<link[^>]+href=[\"']https?://[^>]+rel=[\"']stylesheet[\"']", re.IGNORECASE),
)

REMOTE_JAVASCRIPT_PATTERNS = (
    re.compile(r"\beval\s*\("),
    re.compile(r"\bnew\s+Function\s*\("),
    re.compile(r"\bimportScripts\s*\(\s*[\"']https?://", re.IGNORECASE),
    re.compile(r"\bimport\s*\(\s*[\"']https?://", re.IGNORECASE),
    re.compile(r"\bWebAssembly\b"),
)

VOID_HTML_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
}


@final
class StrictHTMLValidator(HTMLParser):
    def __init__(self, filename: str) -> None:
        super().__init__(convert_charrefs=True)
        self.filename: str = filename
        self.stack: list[str] = []
        self.ids: set[str] = set()

    def handle_starttag(  # pyright: ignore[reportImplicitOverride]
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        raw = self.get_starttag_text() or ""
        if raw.count('"') % 2 or raw.count("'") % 2:
            fail(f"unbalanced attribute quote in {self.filename}: {raw[:100]}")

        for name, value in attrs:
            if name == "id" and value:
                if value in self.ids:
                    fail(f"duplicate id in {self.filename}: {value}")
                self.ids.add(value)

        if tag not in VOID_HTML_TAGS:
            self.stack.append(tag)

    def handle_endtag(self, tag: str) -> None:  # pyright: ignore[reportImplicitOverride]
        if tag in VOID_HTML_TAGS:
            fail(f"unexpected closing tag in {self.filename}: </{tag}>")
        if not self.stack:
            fail(f"orphan closing tag in {self.filename}: </{tag}>")
        expected = self.stack.pop()
        if expected != tag:
            fail(f"mismatched tag in {self.filename}: expected </{expected}>, found </{tag}>")

    def finish(self) -> None:
        if self.stack:
            fail(f"unclosed tag in {self.filename}: <{self.stack[-1]}>")


def fail(message: str) -> NoReturn:
    print(f"Release validation failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def png_dimensions(path: Path) -> tuple[int, int]:
    data = path.read_bytes()[:24]
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
        fail(f"{path.relative_to(ROOT)} is not a valid PNG file")
    return struct.unpack(">II", data[16:24])


def validate_manifest() -> str:
    manifest_path = ROOT / "manifest.json"
    parsed: object
    try:
        parsed = cast(object, json.loads(manifest_path.read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError) as error:
        fail(f"manifest.json is invalid: {error}")

    if not isinstance(parsed, dict):
        fail("manifest.json must contain a JSON object")
    manifest = cast(dict[str, object], parsed)
    if manifest.get("manifest_version") != 3:
        fail("manifest_version must be 3")

    version = manifest.get("version")
    if not isinstance(version, str) or not re.fullmatch(r"\d+(?:\.\d+){0,3}", version):
        fail(f"manifest version is invalid: {version!r}")

    return version


def validate_files() -> None:
    for relative_path in PACKAGE_FILES:
        path = ROOT / relative_path
        if not path.is_file():
            fail(f"required file is missing: {relative_path}")
        if path.is_symlink():
            fail(f"package files must not be symbolic links: {relative_path}")

    for relative_path, expected in ICON_SIZES.items():
        actual = png_dimensions(ROOT / relative_path)
        if actual != expected:
            fail(f"{relative_path} is {actual[0]}x{actual[1]}; expected {expected[0]}x{expected[1]}")


def validate_html() -> None:
    for relative_path in ("options.html",):
        text = (ROOT / relative_path).read_text(encoding="utf-8")
        validator = StrictHTMLValidator(relative_path)
        validator.feed(text)
        validator.close()
        validator.finish()


def validate_remote_code() -> None:
    for relative_path in ("options.html",):
        text = (ROOT / relative_path).read_text(encoding="utf-8")
        for pattern in REMOTE_EXECUTABLE_PATTERNS:
            if pattern.search(text):
                fail(f"remote script or stylesheet found in {relative_path}")

    css = (ROOT / "options.css").read_text(encoding="utf-8")
    if re.search(r"@import\s+(?:url\()?\s*[\"']?https?://", css, re.IGNORECASE):
        fail("remote CSS import found in options.css")

    for relative_path in ("background.js", "ai-models.js", "options.js"):
        text = (ROOT / relative_path).read_text(encoding="utf-8")
        for pattern in REMOTE_JAVASCRIPT_PATTERNS:
            if pattern.search(text):
                fail(f"disallowed remote-code pattern found in {relative_path}: {pattern.pattern}")


def build_zip(version: str) -> Path:
    DIST.mkdir(exist_ok=True)
    output = DIST / f"smart-tab-organiser-v{version}.zip"

    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for relative_path in PACKAGE_FILES:
            archive.write(ROOT / relative_path, arcname=relative_path)

    with zipfile.ZipFile(output) as archive:
        names = tuple(archive.namelist())
        if names != PACKAGE_FILES:
            fail("the package contains an unexpected file list")
        if names[0] != "manifest.json":
            fail("manifest.json must be at the package root")
        bad = archive.testzip()
        if bad:
            fail(f"the ZIP contains a corrupt file: {bad}")

    return output


def main() -> None:
    version = validate_manifest()
    validate_files()
    validate_html()
    validate_remote_code()
    output = build_zip(version)
    size_kib = output.stat().st_size / 1024
    print(f"Created {output.relative_to(ROOT)} ({size_kib:.1f} KiB)")
    print("Validated Manifest V3, HTML structure, icon sizes, package contents, and common remote-code patterns.")


if __name__ == "__main__":
    main()
