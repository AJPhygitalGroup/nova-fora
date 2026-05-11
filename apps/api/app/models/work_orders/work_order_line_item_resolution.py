"""WorkOrderLineItemResolution — M:N junction line_item ↔ defect_resolution.

In v2.0, app does **bulk auto-linkage** at line item creation: when a
`defect_repair` line item is created, the app links it to EVERY defect_
resolution on the WO. Per-defect cost attribution becomes precise in
v2.x; for v2.0 this satisfies the completion trigger without forcing the
vendor to pick per-defect labor splits.

Composite PK (line_item_id, defect_resolution_id).
"""
import sqlalchemy as sa
from sqlalchemy import Column
from sqlmodel import Field, SQLModel


class WorkOrderLineItemResolution(SQLModel, table=True):
    __tablename__ = "work_order_line_item_resolutions"

    line_item_id: int = Field(
        sa_column=Column(
            "line_item_id",
            sa.Integer,
            sa.ForeignKey("work_order_line_items.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    defect_resolution_id: int = Field(
        sa_column=Column(
            "defect_resolution_id",
            sa.Integer,
            sa.ForeignKey("defect_resolutions.id", ondelete="CASCADE"),
            primary_key=True,
            index=True,
        ),
    )
