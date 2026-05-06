"""App-layer validation for writes to the V2.2 `defects` table.

V2.2 §6 defines this as DB triggers; we keep it in the service layer per
CLAUDE.md (testable from Python, no `pg_jsonschema` dependency).

Validation order — fails fast on the first problem:
  1. Enum membership — `part`, `position`, `defect_type` must be known values.
  2. Source ↔ inspection_id invariant (mirrors the DB CHECK; we surface a
     better error message before hitting the DB).
  3. (rule, vehicle_class) applicability lookup — the presence of a row
     in `defect_applicability` for the (part, defect_type, vehicle_class)
     tuple IS the allow-list. Missing row → reject.
  4. Position validity per `defect_applicability.valid_positions[]`.
  5. `details` JSON validates against `defect_applicability.details_schema`.

Returns the matched DefectApplicability row so callers (routes) can derive
classification + group for the response without re-querying.
"""
import jsonschema
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models.defect import DefectSource
from app.models.defect_catalog import (
    DefectApplicability,
    DefectPart,
    DefectPosition,
    DefectRule,
    DefectType,
    VehicleClass,
)


class DefectValidationError(ValueError):
    """Raised when a write to /defects violates spec rules.

    Routes catch this and translate to HTTP 400 with the message intact.
    """


async def validate_defect_write(
    session: AsyncSession,
    *,
    part: str,
    position: str | None,
    defect_type: str,
    details: dict,
    source: DefectSource,
    inspection_id: int | None,
    vehicle_class: VehicleClass,
) -> tuple[DefectRule, DefectApplicability]:
    """Validate a write against the V2.2 catalog.

    Returns the matched (rule, applicability) so callers can pull
    classification + group + threshold without an extra query.
    Raises DefectValidationError on any failure.
    """
    # 1. Enum membership
    try:
        DefectPart(part)
    except ValueError as e:
        raise DefectValidationError(f"invalid part: {part!r}") from e
    if position is not None:
        try:
            DefectPosition(position)
        except ValueError as e:
            raise DefectValidationError(f"invalid position: {position!r}") from e
    try:
        DefectType(defect_type)
    except ValueError as e:
        raise DefectValidationError(f"invalid defect_type: {defect_type!r}") from e

    # 2. source ↔ inspection_id invariant
    if source == DefectSource.INSPECTION and inspection_id is None:
        raise DefectValidationError(
            "source='inspection' requires inspection_id to be set"
        )
    if source != DefectSource.INSPECTION and inspection_id is not None:
        raise DefectValidationError(
            f"source={source.value!r} requires inspection_id to be NULL"
        )

    # 3. Applicability lookup — joined with rule on (part, defect_type)
    row = (
        await session.execute(
            select(DefectRule, DefectApplicability)
            .join(DefectApplicability, DefectApplicability.rule_id == DefectRule.id)
            .where(DefectRule.part == part)
            .where(DefectRule.defect_type == defect_type)
            .where(DefectApplicability.vehicle_class == vehicle_class.value)
            .where(DefectRule.is_active == True)  # noqa: E712
            .where(DefectApplicability.is_active == True)  # noqa: E712
        )
    ).first()

    if row is None:
        raise DefectValidationError(
            f"(part={part!r}, defect_type={defect_type!r}, "
            f"vehicle_class={vehicle_class.value!r}) is not in defect_applicability. "
            f"Add an applicability row first."
        )

    rule, applicability = row

    # 4. Position validity
    if position is None:
        if not applicability.allow_null_position:
            raise DefectValidationError(
                f"position is required for part {part!r} on "
                f"vehicle_class {vehicle_class.value!r}"
            )
    else:
        valid = set(applicability.valid_positions or [])
        if valid and position not in valid:
            raise DefectValidationError(
                f"position {position!r} invalid for part {part!r} on "
                f"vehicle_class {vehicle_class.value!r}; allowed: {sorted(valid)}"
            )

    # 5. details JSON Schema validation (skip when schema is empty `{}`)
    schema = applicability.details_schema or {}
    if schema:
        try:
            jsonschema.validate(instance=details or {}, schema=schema)
        except jsonschema.ValidationError as e:
            raise DefectValidationError(
                f"details validation failed: {e.message}"
            ) from e

    return rule, applicability
