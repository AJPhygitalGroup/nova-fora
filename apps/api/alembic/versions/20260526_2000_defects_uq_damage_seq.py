"""defects: allow multiple body-damage instances via details.damage_seq

Body damage (scratches/dents) needs to support N instances per
(vehicle, inspection, part, position, defect_type) so an inspector can
log 3 different scratches on the driver side without colliding on the
existing unique index. We add `details->>'damage_seq'` to the COALESCE
chain — non-body parts continue to write damage_seq=NULL and the index
stays effectively unchanged for them.

Forward: drop the existing unique index, recreate with damage_seq
appended. Backward: same shape minus damage_seq.

Revision: 20260526_2000
"""
from alembic import op


revision = "20260526_2000"
down_revision = "20260525_2500"
branch_labels = None
depends_on = None


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
        "  COALESCE(details->>'wheel_position', ''), "
        "  COALESCE(details->>'damage_seq', '')"
        ")"
    )


def downgrade() -> None:
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
