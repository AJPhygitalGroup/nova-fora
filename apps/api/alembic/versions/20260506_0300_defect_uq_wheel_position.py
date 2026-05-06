"""defects unique index — include details->>'wheel_position'

Revision ID: 20260506_0300
Revises: 20260506_0200
Create Date: 2026-05-06 03:00:00.000000

Dual-rear-axle vehicles (CDV / Step Van / Box Truck) carry inner+outer tires
on each rear corner, so a single (vehicle, inspection, part, position,
defect_type) tuple can legitimately produce TWO defects — one for the inner
wheel and one for the outer. The current unique index treats them as
duplicates and rejects the second insert.

Fix: add COALESCE(details->>'wheel_position', '') as a sixth dimension to
the unique index. For vehicles without duals the field never appears in
details so the COALESCE collapses to '' and the index keeps its original
behavior.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260506_0300"
down_revision: Union[str, None] = "20260506_0200"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_defects_vehicle_insp_part_pos_type")
    op.execute(
        "CREATE UNIQUE INDEX uq_defects_vehicle_insp_part_pos_type "
        "ON defects ("
        "  vehicle_id, "
        "  COALESCE(inspection_id::text, ''), "
        "  part, "
        "  COALESCE(position, ''), "
        "  defect_type, "
        "  COALESCE(details->>'wheel_position', '')"
        ")"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_defects_vehicle_insp_part_pos_type")
    op.execute(
        "CREATE UNIQUE INDEX uq_defects_vehicle_insp_part_pos_type "
        "ON defects (vehicle_id, COALESCE(inspection_id::text, ''), "
        "part, COALESCE(position, ''), defect_type)"
    )
