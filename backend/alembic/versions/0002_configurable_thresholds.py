"""Store reproducible certificate thresholds per exam.
Revision ID: 0002
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision='0002'
down_revision='0001'
branch_labels=None
depends_on=None


def upgrade():
    op.add_column('exams',sa.Column('certificate_thresholds',sa.JSON().with_variant(JSONB(),'postgresql'),nullable=False,
        server_default='{"A+":70,"A":65,"B+":60,"B":55,"C+":50,"C":46}'))
    op.alter_column('exams','certificate_thresholds',server_default=None)


def downgrade():
    raise RuntimeError('Destructive downgrade requires explicit review')
