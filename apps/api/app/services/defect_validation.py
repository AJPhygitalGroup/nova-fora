"""App-layer validation for writes to the v2 `defects` table.

Mirrors the rules the spec wants enforced via DB triggers (Notion §8). The
triggers are tracked as a follow-up PR; for now this module is the only line
of defense (plus the CHECK constraint on `source`/`inspection_id`).

Validation order — fails fast on the first problem so users see one clean
error at a time:

  1. Enum membership — `part`, `position`, `defect_type` must be known values.
  2. Source ↔ inspection_id invariant (matches the DB CHECK; we surface a
     better error message before hitting the DB).
  3. Position validity per `defect_part_validity` (§8.2).
  4. (part, defect_type) is on the allow-list — presence of a row in
     `defect_details_schema` is the allow-list (§8.3).
  5. `details` JSON validates against the schema for that (part, defect_type).
"""
import jsonschema
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models.defect import DefectSource
from app.models.defect_catalog import (
    DefectDetailsSchema,
    DefectPart,
    DefectPartValidity,
    DefectPosition,
    DefectType,
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
) -> None:
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

    # 3. Position validity
    pv = (
        await session.execute(
            select(DefectPartValidity).where(DefectPartValidity.part == part)
        )
    ).scalar_one_or_none()
    if pv is not None:
        if position is None:
            if not pv.allow_null_position:
                raise DefectValidationError(
                    f"position is required for part {part!r}"
                )
        else:
            valid = {
                p.strip() for p in pv.valid_positions_csv.split(",") if p.strip()
            }
            if valid and position not in valid:
                raise DefectValidationError(
                    f"position {position!r} invalid for part {part!r}; "
                    f"allowed: {sorted(valid)}"
                )
    # If pv is None → no validity row seeded for this part. Per spec the
    # presence of a row defines the constraint; absence means "anything goes."
    # In practice every part SHOULD have a row — log as a seeding gap rather
    # than rejecting the write.

    # 4. (part, defect_type) allow-list
    schema_row = (
        await session.execute(
            select(DefectDetailsSchema)
            .where(DefectDetailsSchema.part == part)
            .where(DefectDetailsSchema.defect_type == defect_type)
        )
    ).scalar_one_or_none()
    if schema_row is None:
        raise DefectValidationError(
            f"(part, defect_type) = ({part!r}, {defect_type!r}) is not on the "
            f"allow-list. Add a row to defect_details_schema first."
        )

    # 5. details JSON Schema validation (only when the schema is non-empty)
    schema = schema_row.json_schema or {}
    if schema:
        try:
            jsonschema.validate(instance=details or {}, schema=schema)
        except jsonschema.ValidationError as e:
            raise DefectValidationError(
                f"details validation failed: {e.message}"
            ) from e
