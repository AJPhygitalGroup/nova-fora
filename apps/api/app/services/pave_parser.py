"""PAVE vehicle condition report PDF parser.

Extracts structured data from PAVE-generated PDFs (reports.paveapi.com)
for the body-repair flow. v0.1 ships with PDF-only ingestion (no PAVE API
contract). Two source paths both feed this parser:
  - URL paste: fetch reports.paveapi.com/api/report/<id>?token=... → store PDF in S3 → parse
  - PDF upload: store file in S3 → parse

The parser uses `pdftotext -layout` (poppler-utils) to extract text from
wkhtmltopdf-generated PAVE reports. Each damage row is parsed by detecting
its own column boundaries from the 2+ space gaps on its first line (table
column widths shift across pages, so a single header-based position map
isn't reliable). Multi-line continuation rows are sliced by those same
boundaries and appended into the matching field.

On parse failure: returns parse_status='failed' (no exception) so callers
can store the PDF and flag for manual review.

Run standalone for quick testing:
    python3 app/core/nova/utils/pave_parser.py /path/to/report.pdf
"""

import json
import logging
import re
import subprocess
from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Optional


log = logging.getLogger('nova.pave_parser')


KNOWN_REPAIR_METHODS = ('Repair & Refinish', 'Replace', 'Refinish', 'Repair')
FOOTER_MARKER = 'POWERED BY'
HEADER_TOKENS = ('COMPONENT', 'DAMAGE TYPE', 'SEVERITY')
SECTION_NEW_DAMAGE = 'New Damage'
SECTION_REPAIRED_DAMAGE = 'Repaired Damage'
# Per-side detail sections — for damaged vehicles these tables contain the
# full current damage list, much richer than the top-level New/Repaired
# change summary. PAVE uses these exact labels.
SIDE_HEADINGS = {
    'LEFT SIDE': 'left',
    'RIGHT SIDE': 'right',
    'FRONT SIDE': 'front',
    'BACK SIDE': 'back',
    'WINDSHIELD': 'windshield',
}
# Hard terminators that end any damage table (gallery sections, etc.)
HARD_TERMINATORS = ('Vehicle Photos', 'Damages Details')
NO_DAMAGE_MARKERS = ('No damage', 'No photo')

# Component-name keywords that mark a Part/Trim component (everything else is a
# Body component). Used only to derive `component_group`; PAVE does not state it.
TRIM_KEYWORDS = (
    'molding', 'cladding', 'trim', 'antenna', 'emblem', 'badge', 'mirror',
    'handle', 'lamp', 'light', 'headlight', 'taillight', 'reflector',
    'applique', 'nameplate', 'valance', 'gas cap', 'fuel cap', 'rail',
)


@dataclass
class Damage:
    item_no: int
    component: str
    damage_type: str
    severity: str
    repair_method: str
    fleet_score: Optional[int]  # None when PAVE shows "Included" (bundled with another item)
    raw_score: Optional[str] = None  # the literal score cell: 'Included' or the integer as text
    is_priority: bool = False
    is_included: bool = False  # mirrors the "Included" repair-method modifier
    # 'body' | 'trim' | None — the FCA rubric's Component Group, derived from the
    # component name and (where present) the score. PAVE does not print this; it
    # is inferred for grouping/display, not read from the report.
    component_group: Optional[str] = None
    # Parsed measurement from `severity` when present, e.g. {'op': '>', 'min': 20,
    # 'max': None, 'unit': 'inches', 'raw': '> 20 inches'}. None when severity
    # carries no measurement (e.g. "Part is missing").
    size: Optional[dict] = None
    side: Optional[str] = None  # 'left' | 'right' | 'front' | 'back' | 'windshield' | None
    photo_index: Optional[int] = None  # 0-based index into pdfimages square-crop sequence


@dataclass
class PaveReport:
    vin: Optional[str] = None
    year: Optional[int] = None
    make: Optional[str] = None
    model: Optional[str] = None
    inspection_date_utc: Optional[str] = None
    scores: dict = field(default_factory=dict)
    damages: list = field(default_factory=list)
    previous_session_id: Optional[str] = None
    previous_inspection_date: Optional[str] = None
    new_damage: list = field(default_factory=list)
    repaired_damage: list = field(default_factory=list)
    parse_status: str = 'ok'
    parse_warnings: list = field(default_factory=list)


def parse_pave_report(pdf_path: str) -> dict:
    """Parse a PAVE PDF into a JSON-serializable dict. Never raises."""
    report = PaveReport()
    try:
        text = _extract_text(pdf_path)
    except Exception as e:
        log.exception('pdftotext failed for %s', pdf_path)
        report.parse_status = 'failed'
        report.parse_warnings.append('pdftotext error: {}'.format(e))
        return asdict(report)

    text = _strip_footers(text)

    try:
        _parse_header(text, report)
        _parse_scores(text, report)
        _parse_change_summary(text, report)
        _parse_damage_sections(text, report)
    except Exception as e:
        log.exception('PAVE parser internal error')
        report.parse_warnings.append('parser error: {}'.format(e))
        report.parse_status = 'failed'
        return asdict(report)

    if not report.damages and not report.new_damage and not report.repaired_damage and not report.vin:
        report.parse_status = 'failed'
    elif report.parse_warnings:
        report.parse_status = 'partial'

    return asdict(report)


def _extract_text(pdf_path: str) -> str:
    result = subprocess.run(
        ['pdftotext', '-layout', pdf_path, '-'],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout


def _strip_footers(text: str) -> str:
    return '\n'.join(ln for ln in text.splitlines() if FOOTER_MARKER not in ln)


def _strip_pua(text: str) -> str:
    """Strip Private-Use-Area Unicode glyphs (PAVE uses these for icons)."""
    return ''.join(c for c in text if not (0xE000 <= ord(c) <= 0xF8FF))


def _normalize_whitespace(text: str) -> str:
    return re.sub(r'\s+', ' ', text).strip()


def _parse_header(text: str, report: PaveReport) -> None:
    m = re.search(r'\b(20\d{2})\s+([A-Z][a-zA-Z]+)\s+([A-Z][A-Za-z0-9 ]+?)(?=\s{2,}|\s*VIN|\n)', text)
    if m:
        report.year = int(m.group(1))
        report.make = m.group(2).strip()
        report.model = m.group(3).strip()

    m = re.search(r'VIN\s*#\s*([A-Z0-9*]{10,20})', text)
    if m:
        report.vin = m.group(1)

    m = re.search(
        r'INSPECTION DATE:\s*\n?\s*([A-Z][a-z]+ \d{1,2},\s*\d{4})\s*@\s*(\d{1,2}:\d{2})\s*UTC',
        text,
    )
    if m:
        try:
            dt = datetime.strptime('{} {}'.format(m.group(1), m.group(2)), '%B %d, %Y %H:%M')
            report.inspection_date_utc = dt.isoformat() + 'Z'
        except ValueError as e:
            report.parse_warnings.append('inspection date: {}'.format(e))


def _parse_scores(text: str, report: PaveReport) -> None:
    # Overall grade: a 0-5 score paired with one of PAVE's qualitative labels.
    # PAVE shows it as a big circular indicator at the top-left of the report.
    grade_re = re.compile(
        r'\b([0-5])\b\s*\n?\s*(VERY\s+POOR|POOR|FAIR|GOOD|GREAT)\b',
        re.IGNORECASE,
    )
    m = grade_re.search(text)
    if m:
        report.scores['total'] = int(m.group(1))
        report.scores['total_label'] = _normalize_whitespace(m.group(2)).upper()

    # Per-side damage counts. PAVE lays them out as 5 numeric values appearing
    # between the grade label and the scale legend ("Very Poor ... Great"):
    #   [front, back, all_damages_total, left, right]
    # Some lines have trailing prose (e.g. "12   15   is at risk of grounding"),
    # so extract every standalone integer token in document order from the
    # block, then take the first 5. The scale-legend digits (0-5) follow in
    # the same block but always come after these counts.
    block_re = re.compile(
        r'(?:VERY\s+POOR|POOR|FAIR|GOOD|GREAT)\b(.+?)Very\s+Poor',
        re.DOTALL | re.IGNORECASE,
    )
    bm = block_re.search(text)
    if bm:
        # Strip the scale legend before extracting numbers (the 0..5 row)
        block = bm.group(1)
        scale_match = re.search(r'\b0\b\s+\b1\b\s+\b2\b\s+\b3\b\s+\b4\b\s+\b5\b', block)
        if scale_match:
            block = block[: scale_match.start()]
        nums = [int(n) for n in re.findall(r'(?<!\w)(\d+)(?!\w)', block)]
        if len(nums) >= 5:
            report.scores['front_damage_count'] = nums[0]
            report.scores['back_damage_count'] = nums[1]
            report.scores['all_damages_count'] = nums[2]
            report.scores['left_damage_count'] = nums[3]
            report.scores['right_damage_count'] = nums[4]
        elif nums:
            report.scores['raw_damage_counts'] = nums
            report.parse_warnings.append('partial side-damage counts: got {}, expected 5'.format(len(nums)))

    # Exterior damage total — PAVE shows "Exterior (N)" as a section label.
    m = re.search(r'Exterior\s*\((\d+)\)', text)
    if m:
        report.scores['exterior_damage_count'] = int(m.group(1))

    # Priority-damages-detected flag (PAVE shows this prominently near the grade).
    if re.search(r'Priority Damages\s+Detected', text, re.IGNORECASE):
        report.scores['priority_detected'] = True

    # Classification + grounding-risk warning (e.g., "This vehicle is classified
    # as poor and is at risk of grounding.").
    m = re.search(r'classified\s+as\s+(\w+)', text, re.IGNORECASE)
    if m:
        report.scores['classification'] = m.group(1).lower()
    if re.search(r'risk\s+of\s+grounding', text, re.IGNORECASE):
        report.scores['at_risk_of_grounding'] = True


def _parse_change_summary(text: str, report: PaveReport) -> None:
    # PAVE renders these in two side-by-side columns, so the date and the
    # label aren't strictly adjacent — allow some intervening text but cap
    # the window so we don't pull a date from elsewhere in the document.
    m = re.search(
        r'PREVIOUS INSPECTION DATE:[\s\S]{0,300}?([A-Z][a-z]+ \d{1,2},\s*\d{4})\s*@\s*(\d{1,2}:\d{2})',
        text,
    )
    if m:
        try:
            dt = datetime.strptime('{} {}'.format(m.group(1), m.group(2)), '%B %d, %Y %H:%M')
            report.previous_inspection_date = dt.isoformat()
        except ValueError as e:
            report.parse_warnings.append('previous inspection date: {}'.format(e))

    m = re.search(r'PREVIOUS SESSION ID:[\s\S]{0,300}?([A-Z]{4}-[A-Z0-9]{8,20})', text)
    if m:
        report.previous_session_id = m.group(1)


def _parse_damage_sections(text: str, report: PaveReport) -> None:
    """Walk the text and dispatch damage rows into the right bucket.

    Buckets:
      - `new_damage`: rows under "New Damage" section
      - `repaired_damage`: rows under "Repaired Damage" section
      - `damages`: rows under per-side detail sections (LEFT/RIGHT/FRONT/BACK)
        — these are the actual CURRENT damages and form the main list the
        body-repair UI uses for pick-parts / target-grade modes.
    """
    lines = text.splitlines()
    bucket = 'damages'
    current_side: Optional[str] = None
    block: list = []
    in_table = False
    # Global per-document damage counter so photo_index matches the
    # document-order of square crops extracted by pdfimages.
    photo_counter = [0]

    def emit():
        nonlocal block
        if block:
            damage = _row_block_to_damage(block, side=current_side)
            if damage:
                damage.photo_index = photo_counter[0]
                photo_counter[0] += 1
                getattr(report, bucket).append(asdict(damage))
        block = []

    for raw_line in lines:
        line = _strip_pua(raw_line)
        stripped = line.strip()

        # Top-level change-summary sections
        if stripped == SECTION_NEW_DAMAGE:
            emit()
            bucket = 'new_damage'
            current_side = None
            in_table = False
            continue
        if stripped == SECTION_REPAIRED_DAMAGE:
            emit()
            bucket = 'repaired_damage'
            current_side = None
            in_table = False
            continue

        # Per-side detail sections — switch bucket to `damages` and tag side
        if stripped in SIDE_HEADINGS:
            emit()
            bucket = 'damages'
            current_side = SIDE_HEADINGS[stripped]
            in_table = False
            continue

        # Table header — marks the start of a damage table.
        if all(tok in line for tok in HEADER_TOKENS):
            emit()
            in_table = True
            continue

        # Hard terminators (photo galleries, etc.) — close any open block
        if any(stripped.startswith(t) for t in HARD_TERMINATORS):
            emit()
            in_table = False
            continue

        if stripped in NO_DAMAGE_MARKERS:
            emit()
            continue

        if not in_table:
            continue

        # Row start: leading whitespace then item_no then component
        m = re.match(r'^\s{2,}(\d{1,3})\s+\S', line)
        if m:
            emit()
            block = [line]
            continue

        # Continuation line — append while a block is open
        if block and stripped:
            block.append(line)

    emit()


def _row_block_to_damage(block: list, side: Optional[str] = None) -> Optional[Damage]:
    """Convert a multi-line row block into a Damage record.

    Detects column positions from 2+ space gaps on the FIRST line of the
    block (column widths shift between pages, so per-block detection is
    more reliable than a document-wide header map). Continuation lines
    are sliced by those same positions and appended to the matching field.
    """
    if not block:
        return None

    first = block[0]
    col_positions = _detect_columns(first)
    if len(col_positions) < 4:
        return None

    cells_first = _slice_by_columns(first, col_positions)

    # Expected layout: [item_no+component, damage_type, severity, repair_method, fleet_score]
    # but a missing severity (rare) or split repair_method can shift things,
    # so identify fields by content rather than fixed index.
    # The last cell is either a digit (fleet_score) or the literal "Included"
    # (PAVE's notation for damages bundled with another item — no separate score).
    trailing_cell = cells_first[-1]
    fleet_score: Optional[int] = None
    is_included = False
    raw_score: Optional[str] = None
    if trailing_cell == 'Included':
        is_included = True
        raw_score = 'Included'
    else:
        fleet_score = _try_int(trailing_cell)
        if fleet_score is None:
            return None
        raw_score = str(fleet_score)

    trailing_method = cells_first[-2]
    if trailing_method in KNOWN_REPAIR_METHODS:
        repair_method = trailing_method
    elif trailing_method == 'Repair &':
        # Split across lines (continuation will hold 'Refinish'); resolve now
        # since 'Repair & Refinish' is the only multi-token method PAVE uses.
        repair_method = 'Repair & Refinish'
    else:
        return None

    item_no_component = cells_first[0]
    middle = cells_first[1:-2]
    if len(middle) >= 2:
        damage_type = middle[0]
        severity = ' '.join(middle[1:])
    elif len(middle) == 1:
        damage_type = middle[0]
        severity = ''
    else:
        damage_type = ''
        severity = ''

    m = re.match(r'^(\d{1,3})\s+(.+)$', item_no_component)
    if not m:
        return None
    item_no = int(m.group(1))
    component = m.group(2).strip()

    is_priority = False
    damage_type_col = col_positions[1] if len(col_positions) > 1 else None
    for cont in block[1:]:
        # Treat everything from line start up to the damage_type column as the
        # component zone (PAVE often indents continuations 1-2 chars left of
        # the item_no, and word fragments straddle the column boundary).
        if damage_type_col is not None:
            component_zone = cont[:damage_type_col].strip()
            if component_zone:
                if 'Priority' in component_zone or 'Damages' in component_zone:
                    is_priority = True
                else:
                    component = (component + ' ' + component_zone).strip()

        cells_cont = _slice_by_columns(cont, col_positions)
        for i, cell in enumerate(cells_cont):
            if not cell or i == 0:
                continue  # component handled by the zone slice above
            if i == 1:
                damage_type = (damage_type + ' ' + cell).strip()
            elif i == 2:
                severity = (severity + ' ' + cell).strip()
            elif i == 3:
                # Method continuation (e.g., 'Refinish' completing 'Repair &')
                if cell in KNOWN_REPAIR_METHODS and not repair_method.endswith(cell):
                    repair_method = (repair_method + ' ' + cell).strip()
            # Trailing score column should never reappear; if it does, ignore.

    component = _normalize_whitespace(component)
    damage_type = _normalize_whitespace(damage_type)
    severity = _normalize_whitespace(severity)
    repair_method = _normalize_whitespace(repair_method)

    return Damage(
        item_no=item_no,
        component=component,
        damage_type=damage_type,
        severity=severity,
        repair_method=repair_method,
        fleet_score=fleet_score,
        raw_score=raw_score,
        is_priority=is_priority,
        is_included=is_included,
        component_group=_classify_component_group(component, repair_method, fleet_score),
        size=_parse_size(severity),
        side=side,
    )


def _detect_columns(line: str) -> list:
    """Find column-start character positions on a line by anchoring on 2+ space gaps."""
    positions = []
    i = 0
    n = len(line)
    while i < n:
        # Skip leading whitespace for this column
        while i < n and line[i] == ' ':
            i += 1
        if i >= n:
            break
        positions.append(i)
        # Advance to next 2+ space gap
        gap = line.find('  ', i)
        if gap < 0:
            break
        i = gap
    return positions


def _slice_by_columns(line: str, col_positions: list) -> list:
    cells = []
    for idx, start in enumerate(col_positions):
        end = col_positions[idx + 1] if idx + 1 < len(col_positions) else len(line)
        if start >= len(line):
            cells.append('')
            continue
        cells.append(line[start:min(end, len(line))].strip())
    return cells


def _try_int(s: str) -> Optional[int]:
    try:
        return int(s.strip())
    except (ValueError, AttributeError):
        return None


def _classify_component_group(component: str, repair_method: str,
                              fleet_score: Optional[int]) -> Optional[str]:
    """Derive the FCA rubric Component Group ('body' | 'trim').

    Starts from component-name keywords, then corrects with the score where one
    exists: under the rubric a Body component never scores below 2, and a Trim
    component never scores above 2 — so a high score forces 'body' and a score of
    1 forces 'trim' regardless of the name (catches small parts like
    "Gas Cap Cover" that the keyword list would otherwise miss). Included rows
    have no score, so they fall back to the keyword guess.
    """
    if not component:
        return None
    name = component.lower()
    group = 'trim' if any(k in name for k in TRIM_KEYWORDS) else 'body'
    if fleet_score is not None:
        if fleet_score >= 3:
            group = 'body'
        elif fleet_score <= 1:
            group = 'trim'
    return group


_SIZE_RANGE_RE = re.compile(r'(\d+)\s*(?:-|to)\s*(\d+)\s*(?:inch|")', re.IGNORECASE)
_SIZE_GT_RE = re.compile(r'(>=?|over|greater than)\s*(\d+)\s*(?:inch|")', re.IGNORECASE)
_SIZE_SINGLE_RE = re.compile(r'(\d+)\s*(?:inch|")', re.IGNORECASE)


def _parse_size(severity: str) -> Optional[dict]:
    """Extract a measurement (in inches) embedded in the severity text.

    PAVE writes sizes inline, e.g. "> 20 inches", "Major dent 9 - 10 inches",
    "5 to 6 inches", '12" or longer'. Returns a structured dict or None. The full
    original text is always preserved in `Damage.severity`; this is convenience.
    """
    if not severity:
        return None
    m = _SIZE_RANGE_RE.search(severity)
    if m:
        return {'op': 'range', 'min': int(m.group(1)), 'max': int(m.group(2)),
                'unit': 'inches', 'raw': severity}
    m = _SIZE_GT_RE.search(severity)
    if m:
        return {'op': '>', 'min': int(m.group(2)), 'max': None,
                'unit': 'inches', 'raw': severity}
    m = _SIZE_SINGLE_RE.search(severity)
    if m:
        n = int(m.group(1))
        return {'op': '=', 'min': n, 'max': n, 'unit': 'inches', 'raw': severity}
    return None


if __name__ == '__main__':
    import sys
    pdf = sys.argv[1] if len(sys.argv) > 1 else '/tmp/pave_report.pdf'
    print(json.dumps(parse_pave_report(pdf), indent=2, default=str))
