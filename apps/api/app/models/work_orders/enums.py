"""WO V2.0 enums — stored as VARCHAR per CLAUDE.md rule #2.

Each enum lives here (instead of next to its primary table) so several
models can reference the same enum without circular imports. The DB-side
CHECK constraint is the source of truth; the Python enum is for type
safety + autocomplete.

Length-of-VARCHAR sizing is documented in each enum class — keep these
in sync with the column length declared in the migration
(`20260511_1900_wo_v2_rebuild.py`).
"""
from enum import Enum


class RepairType(str, Enum):
    """work_orders.repair_type — VARCHAR(20).

    Option 2 dropped `amr` and `cmr` (those were billing categories, not
    work categories). `mechanical` covers both AMR-billed and CMR-billed
    mechanical work; the `line_items.billing_type` field carries the
    AMR vs CMR distinction.
    """

    MECHANICAL = "mechanical"
    BODY = "body"
    TIRES = "tires"
    PM = "pm"
    CNMR = "cnmr"
    DETAILING = "detailing"
    NETRADYNE = "netradyne"


class StatusTrackingMode(str, Enum):
    """How the WO's progress is tracked — VARCHAR(20).

    `external` vendors (e.g., Midas) drive status from their own RO Writer;
    we must have at least one RO# before acceptance (enforced by trigger).
    `internal` vendors are inside Nova Fora's UI.
    """

    EXTERNAL = "external"
    INTERNAL = "internal"


class RepairRequestStatus(str, Enum):
    """repair_requests.status — VARCHAR(30).

    Option 2 removed `quoted` (no formal quote workflow anymore).
    """

    OPEN = "open"
    ACCEPTED = "accepted"
    CANCELLED = "cancelled"
    FULFILLED = "fulfilled"
    STALE = "stale"


class WorkOrderStatus(str, Enum):
    """work_orders.status — VARCHAR(30).

    Lifecycle: pending_acceptance → accepted → in_progress → completed.
    Branches: cancelled (any time) / declined (from pending_acceptance only).
    """

    PENDING_ACCEPTANCE = "pending_acceptance"
    ACCEPTED = "accepted"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    DECLINED = "declined"


class LineItemCategory(str, Enum):
    """work_order_line_items.category — VARCHAR(30).

    Drives initial status + scope-approval requirements.
    `defect_repair`        — tied to a defect via line_item_defect_resolutions.
    `customer_request`     — customer asked for it.
    `vendor_addition`      — vendor proposed during the visit.
    `recall`               — manufacturer-funded.
    `overhead`             — shop supplies, env fees.
    `uncategorized`        — unclassified (rare; data hygiene).
    """

    DEFECT_REPAIR = "defect_repair"
    CUSTOMER_REQUEST = "customer_request"
    VENDOR_ADDITION = "vendor_addition"
    RECALL = "recall"
    OVERHEAD = "overhead"
    UNCATEGORIZED = "uncategorized"


class LineItemBillingType(str, Enum):
    """work_order_line_items.billing_type — VARCHAR(10).

    AMR = Amazon Maintenance Repair (Amazon-paid at fixed rates).
    CMR = Customer Maintenance Repair (customer-paid).

    In v2.0 the customer doesn't see this split in the UI — kept for v2.x
    when the billing layer lights up.
    """

    AMR = "amr"
    CMR = "cmr"


class LineItemStatus(str, Enum):
    """work_order_line_items.status — VARCHAR(40).

    State machine names "what is being waited on, by whom."

    In v2.0 the cost-approval and variance-reapproval flows are dormant
    — `pending_cost_approval` and `pending_variance_reapproval` exist in
    the schema but the app never sets them. Variance breaches are written
    to wo_activity_log instead.
    """

    PENDING_SCOPE_APPROVAL = "pending_scope_approval"        # customer (scope)
    PENDING_COST_APPROVAL = "pending_cost_approval"          # customer (cost) — DORMANT
    PENDING = "pending"                                      # tech ready to work
    PENDING_VARIANCE_REAPPROVAL = "pending_variance_reapproval"  # customer (variance) — DORMANT
    DONE = "done"
    DEFERRED = "deferred"
    DECLINED = "declined"


class NoteAuthorRole(str, Enum):
    """work_order_notes.author_role — VARCHAR(30)."""

    CUSTOMER = "customer"
    VENDOR_SERVICE_WRITER = "vendor_service_writer"
    TECHNICIAN = "technician"
    ADMIN = "admin"
    SYSTEM = "system"


class RepairBucket(str, Enum):
    """work_orders.repair_bucket — VARCHAR(20).

    Vendor's classification when scheduling: overnight (van returns before
    dispatch) vs shop (held longer than one dispatch cycle). Drives the
    DSP-side "Scheduled Repairs" card grouping.
    """

    OVERNIGHT = "overnight"
    SHOP = "shop"


class DspWoResponse(str, Enum):
    """work_orders.dsp_response — VARCHAR(20).

    DSP's response to a scheduled WO. NULL = no decision yet. Confirmed
    means the van will be at the agreed location at scheduled_at;
    not_available flags a scheduling conflict the vendor needs to handle.
    """

    CONFIRMED = "confirmed"
    NOT_AVAILABLE = "not_available"
