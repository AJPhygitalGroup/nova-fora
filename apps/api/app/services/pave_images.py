"""PAVE PDF image extraction via `pdfimages` (poppler-utils).

Port of NOVABODY/web@mbk/body-repair-demo's _extract_pave_images
(app/body_repair_demo.py line 874). Categorizes images by aspect
ratio (verified across multiple sample PAVE reports):

  square crops (~1.0 ratio)   → 'damage' — one per damage row, in
                                 document order (matches parsed
                                 damages' photo_index)
  wide rectangles (>1.4 ratio) → 'panel'  — vehicle wide shots
                                 (front/back/left/right)

Returns a dict of in-memory bytes; the caller uploads to MinIO and
discards the raw bytes. Kept synchronous since pdfimages is fast
(~1-2s for a typical 2MB PAVE) and called from a single endpoint.
"""
from __future__ import annotations

import logging
import os
import re
import subprocess
import tempfile

log = logging.getLogger("nova.pave_images")

# Don't let pdfimages eat the full request budget — leaves headroom
# under uvicorn / nginx timeout.
PDFIMAGES_TIMEOUT_S = 18
# Filter threshold for "this is a real photo" vs "this is a UI icon".
IMAGE_MIN_PIXELS = 100


def extract_pave_images(pdf_path: str) -> dict[str, list[dict]]:
    """Run `pdfimages -all`, categorize by aspect ratio, return
    { 'damage': [bytes...], 'panel': [bytes...] }.

    Each entry: { 'mime', 'data', 'width', 'height' }.
    Empty dict if pdfimages isn't installed or the PDF has no images.
    """
    categorized: dict[str, list[dict]] = {"damage": [], "panel": []}
    try:
        list_result = subprocess.run(
            ["pdfimages", "-list", pdf_path],
            check=True,
            capture_output=True,
            text=True,
            timeout=PDFIMAGES_TIMEOUT_S,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError) as e:
        log.warning("pdfimages -list failed: %s", e)
        return categorized

    # Parse `pdfimages -list` output:
    #   page num type width height color comp bpc enc interp obj id x-ppi y-ppi size ratio
    dims: dict[int, tuple[int, int, str]] = {}
    for line in list_result.stdout.splitlines()[2:]:
        parts = line.split()
        if len(parts) < 9:
            continue
        try:
            num = int(parts[1])
            width = int(parts[3])
            height = int(parts[4])
            enc = parts[8]
            dims[num] = (width, height, enc)
        except (ValueError, IndexError):
            continue

    with tempfile.TemporaryDirectory() as tmpdir:
        prefix = os.path.join(tmpdir, "img")
        try:
            subprocess.run(
                ["pdfimages", "-all", pdf_path, prefix],
                check=True,
                capture_output=True,
                timeout=PDFIMAGES_TIMEOUT_S,
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
            log.warning("pdfimages -all failed: %s", e)
            return categorized

        for fname in sorted(os.listdir(tmpdir)):
            m = re.match(r"img-(\d+)\.(\w+)$", fname)
            if not m:
                continue
            idx = int(m.group(1))
            dim = dims.get(idx)
            if not dim:
                continue
            width, height, enc = dim
            if "jpeg" not in enc.lower():
                continue
            if width < IMAGE_MIN_PIXELS or height < IMAGE_MIN_PIXELS:
                continue
            ratio = width / float(height) if height else 0
            if 0.85 <= ratio <= 1.15:
                bucket = "damage"
            elif ratio >= 1.4:
                bucket = "panel"
            else:
                continue  # ambiguous, skip
            with open(os.path.join(tmpdir, fname), "rb") as f:
                categorized[bucket].append({
                    "mime": "image/jpeg",
                    "data": f.read(),
                    "width": width,
                    "height": height,
                })
    return categorized


def image_key_for(storage_key_pdf: str, category: str, idx: int) -> str:
    """Build the deterministic MinIO key for a categorized PAVE image.

    Given a PDF storage_key like:
      photos/body_repair_previews/0/2026-06-05/abc123.pdf

    Returns:
      photos/body_repair_previews/0/2026-06-05/abc123/img/<category>/<idx>.jpg
    """
    base = storage_key_pdf
    if base.endswith(".pdf"):
        base = base[:-4]
    return f"{base}/img/{category}/{idx}.jpg"
