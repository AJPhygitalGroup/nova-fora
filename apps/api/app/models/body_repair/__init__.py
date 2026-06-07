"""Body repair domain models — port of web-mbk-body-repair-demo.

Jorge 2026-06-03: full lifecycle port. The demo's STATUS_PROGRESSION
(see body_repair_demo.py line 239) defines the 10-state happy path:

  pending_quotes → quoted → quote_selected → pickup_proposed
  → pickup_confirmed → in_repair → repair_complete → pending_signoff
  → returned → paid

plus 3 exception states: cancelled / no_eligible_vendor / halted.

Iteration plan (Jorge confirmed):
  Phase 0 (this commit) — schema + text-mode submission
  Phase 1 — PAVE upload + parsing + 3 submission modes
  Phase 2 — Vendor queue + quotes + DFS markup
  Phase 3 — Quote selection + pickup proposal + logistics
  Phase 4 — Pickup → repair → completion + photo capture
  Phase 5 — Activity timeline + messaging + report send / release

All entities exported here for Alembic autogenerate visibility.
"""

from .body_repair_message import BodyRepairMessage
from .body_repair_pave_report import (
    BodyRepairPaveReport,
    PaveParseStatus,
    PavePhase,
)
from .body_repair_quote import (
    BodyRepairQuote,
    BodyRepairQuoteLineItem,
    BodyRepairQuoteRevision,
    BodyRepairQuoteRevisionLineItem,
    BodyRepairQuoteStatus,
    BodyRepairRevisionStatus,
)
from .body_repair_request import (
    BodyRepairRequest,
    BodyRepairRequestStatus,
    BodyRepairSubmissionMode,
)

__all__ = [
    "BodyRepairRequest",
    "BodyRepairRequestStatus",
    "BodyRepairSubmissionMode",
    "BodyRepairPaveReport",
    "PavePhase",
    "PaveParseStatus",
    "BodyRepairQuote",
    "BodyRepairQuoteLineItem",
    "BodyRepairQuoteRevision",
    "BodyRepairQuoteRevisionLineItem",
    "BodyRepairQuoteStatus",
    "BodyRepairRevisionStatus",
    "BodyRepairMessage",
]
