#!/usr/bin/env python3
# Copyright (C) 2026 Brclio. GPL-2.0-only.
"""Rebuild the tutorial's local Noto Serif SC 700 WOFF2 subset.

Download the complete variable font from this pinned Google Fonts source:
https://raw.githubusercontent.com/google/fonts/8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf
Its SHA-256 is verified before use; no download or network access runs here.

Install optional build dependencies in a Python virtual environment:
    python -m pip install fonttools==4.65.0 brotli==1.2.0
Then run from any directory, passing the downloaded full font:
    python scripts/subset-tutorial-font.py --font 'NotoSerifSC[wght].ttf'

--output and --provenance can override the repository-relative defaults.
The script reads all four tutorial sources, retains printable Unicode from HTML,
CSS and JavaScript, checks every heading, and embeds the complete existing OFL.
It does not build tutorial.html or change project dependencies.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import html
from html.parser import HTMLParser
import importlib.metadata
import json
import os
from pathlib import Path
import re
import string
import sys

ROOT = Path(__file__).resolve().parent.parent
SOURCE_COMMIT = '8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5'
SOURCE_BASE = f'https://raw.githubusercontent.com/google/fonts/{SOURCE_COMMIT}/ofl/notoserifsc/'
SOURCE_URL = SOURCE_BASE + 'NotoSerifSC%5Bwght%5D.ttf'
SOURCE_SHA256 = '050080d9255a86808f2945bffac582b31ef32bc36411ce29563b4961670c66f9'
LICENSE_SHA256 = '5e0da210fb04058a8c0087985d2d456b931c2579811a49655721d3cf0c36b6d6'
SOURCE_FILES = (
    'docs/tutorial-src/index.html',
    'docs/tutorial-src/styles.css',
    'docs/tutorial-src/app.js',
    'scripts/build-tutorial.mjs',
)
SUPPLEMENTAL_TEXT = '0123456789 图 管理概览 管理员登录 备份与恢复主配置 下载当前部署程序 原始PNG'
WEIGHT = 700


def sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


class HeadingText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag, attrs) -> None:
        if tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            self.depth += 1

    def handle_endtag(self, tag) -> None:
        if tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            self.depth -= 1

    def handle_data(self, data) -> None:
        if self.depth:
            self.parts.append(data)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--font', required=True, type=Path, help='Pinned full NotoSerifSC[wght].ttf downloaded from Google Fonts')
    parser.add_argument('--output', type=Path, default=ROOT / 'docs/tutorial-assets/noto-serif-sc-tutorial.woff2')
    parser.add_argument('--provenance', type=Path, default=ROOT / 'docs/tutorial-assets/font-provenance.json')
    args = parser.parse_args()

    font_bytes = args.font.read_bytes()
    require(sha256(font_bytes) == SOURCE_SHA256, f'Font SHA-256 mismatch. Download the pinned full font: {SOURCE_URL}')
    license_path = ROOT / 'licenses/NotoSerifSC-OFL.txt'
    license_bytes = license_path.read_bytes()
    require(sha256(license_bytes) == LICENSE_SHA256, 'Repository OFL differs from the pinned official license; review the source before rebuilding.')
    license_text = license_bytes.decode('utf-8')

    try:
        import fontTools
        from fontTools import subset
        from fontTools.ttLib import TTFont
        from fontTools.varLib.instancer import instantiateVariableFont
        import brotli  # noqa: F401; explicitly check the WOFF2 dependency.
    except ImportError as error:
        raise RuntimeError('Install fonttools==4.65.0 and brotli==1.2.0 in a Python virtual environment.') from error

    text_sources = []
    source_texts = []
    for relative in SOURCE_FILES:
        content = (ROOT / relative).read_bytes()
        text_sources.append({'file': relative, 'bytes': len(content), 'sha256': sha256(content)})
        source_texts.append(content.decode('utf-8'))
    raw = '\n'.join([*source_texts, SUPPLEMENTAL_TEXT])
    # Include script-generated labels and CSS content, but not binary data URLs.
    without_data = re.sub(r'data:[^\s,;"\'<>]+(?:;[^\s,;"\'<>]+)*;base64,[A-Za-z0-9+/=]+', '', raw)
    text = html.unescape(without_data) + string.printable
    wanted = {ord(char) for char in text if char.isprintable()}
    headings = HeadingText()
    headings.feed(source_texts[0])
    heading_points = {ord(char) for char in ''.join(headings.parts) if char.isprintable()}

    font = TTFont(args.font, recalcTimestamp=False)
    try:
        require('fvar' in font and any(axis.axisTag == 'wght' for axis in font['fvar'].axes), 'Expected the full variable font with a wght axis.')
        source_coverage = set(font.getBestCmap())
        retained = wanted & source_coverage
        missing = sorted(wanted - source_coverage)
        require(not (heading_points - source_coverage), 'The official font is missing one or more heading characters.')
        font = instantiateVariableFont(font, {'wght': WEIGHT}, inplace=True, optimize=True)
        require(font['OS/2'].usWeightClass == WEIGHT and 'fvar' not in font, 'Expected a static weight-700 instance.')
        font['name'].setName(license_text, 13, 3, 1, 0x409)
        font['name'].setName('https://openfontlicense.org/', 14, 3, 1, 0x409)
        options = subset.Options()
        options.name_IDs = ['*']
        options.name_legacy = True
        options.name_languages = ['*']
        options.recalc_timestamp = False
        options.layout_features = ['*']
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(unicodes=retained)
        subsetter.subset(font)
        font.flavor = 'woff2'
        args.output.parent.mkdir(parents=True, exist_ok=True)
        font.save(args.output)
    finally:
        font.close()

    checked = TTFont(args.output)
    try:
        actual_coverage = set(checked.getBestCmap())
        require(checked.flavor == 'woff2', 'Output is not WOFF2.')
        require(checked['OS/2'].usWeightClass == WEIGHT and 'fvar' not in checked, 'Output is not static weight 700.')
        require(retained <= actual_coverage, 'WOFF2 subset lost requested glyphs.')
        require(heading_points <= actual_coverage, 'WOFF2 subset lost heading glyphs.')
        notice = checked['name'].getName(13, 3, 1, 0x409)
        require(notice is not None and notice.toUnicode() == license_text, 'Complete OFL notice is missing from output metadata.')
    finally:
        checked.close()

    # A concurrent prose edit would leave a misleading provenance record.
    for item in text_sources:
        require(sha256((ROOT / item['file']).read_bytes()) == item['sha256'], f"Source changed during font build; rerun: {item['file']}")
    output_bytes = args.output.read_bytes()
    provenance = {
        'family': 'Noto Serif SC', 'weight': WEIGHT, 'style': 'normal', 'format': 'woff2',
        'source': SOURCE_URL, 'sourceRepository': 'https://github.com/google/fonts',
        'sourceCommit': SOURCE_COMMIT, 'sourceBytes': len(font_bytes), 'sourceSha256': SOURCE_SHA256,
        'license': 'SIL Open Font License 1.1', 'licenseSource': SOURCE_BASE + 'OFL.txt',
        'licenseSha256': LICENSE_SHA256,
        'licenseFile': Path(os.path.relpath(license_path, args.provenance.resolve().parent)).as_posix(),
        'licenseEmbeddedInFont': True,
        'textSources': text_sources, 'supplementalText': SUPPLEMENTAL_TEXT,
        'textCorpusSha256': sha256(raw.encode('utf-8')),
        'subsetMethod': 'All printable Unicode from the four tutorial sources and supplemental labels; HTML entities decoded, embedded base64 removed, ASCII included; static wght=700 before subsetting.',
        'requestedCodepoints': len(wanted), 'includedCodepoints': len(retained),
        'codepoints': [f'U+{code:04X}' for code in sorted(retained)],
        'missingCharacters': [{'character': chr(code), 'codepoint': f'U+{code:04X}'} for code in missing],
        'missingCharacterHandling': 'Any listed symbols are absent from the official source font and need the system-font fallback. Every HTML heading character is verified present.',
        'file': args.output.name, 'bytes': len(output_bytes), 'sha256': sha256(output_bytes),
        'fontToolsVersion': fontTools.__version__, 'brotliVersion': importlib.metadata.version('brotli'),
        'rebuildScript': 'scripts/subset-tutorial-font.py',
        'rebuildCommand': 'python scripts/subset-tutorial-font.py --font "NotoSerifSC[wght].ttf"',
        'validation': {'woff2Reopened': True, 'staticWeight': WEIGHT, 'completeOFLNameRecord': True, 'allRequestedAvailableGlyphsPresent': True, 'allHeadingCharactersPresent': True, 'headingMissingCodepoints': []},
        'generatedAt': datetime.now(timezone.utc).isoformat(),
    }
    args.provenance.parent.mkdir(parents=True, exist_ok=True)
    args.provenance.write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: provenance[key] for key in ('file', 'bytes', 'sha256', 'requestedCodepoints', 'includedCodepoints', 'missingCharacters', 'validation')}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError) as error:
        print(f'Font build failed: {error}', file=sys.stderr)
        raise SystemExit(1)
