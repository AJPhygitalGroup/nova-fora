"""RepairRequestDefect — M:N junction between RepairRequest and Defect.

Composite PK (repair_request_id, defect_id). When the bundler decides to
group a defect into an RR, it inserts one row here. The same defect can
NEVER be on two open RRs (the bundler enforces this app-side; not a DB
constraint because deferred defects need re-bundling under follow-up RRs).
"""
import sqlalchemy as sa
from sqlalchemy import Column
from sqlmodel import Field, SQLModel


class RepairRequestDefect(SQLModel, table=True):
    __tablename__ = "repair_request_defects"

    repair_request_id: int = Field(
        sa_column=Column(
            "repair_request_id",
            sa.Integer,
            sa.ForeignKey("repair_requests.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    defect_id: int = Field(
        sa_column=Column(
            "defect_id",
            sa.Integer,
            sa.ForeignKey("defects.id", ondelete="CASCADE"),
            primary_key=True,
            index=True,
        ),
    )
