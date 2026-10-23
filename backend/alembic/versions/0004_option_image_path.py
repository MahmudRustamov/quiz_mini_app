"""Allow a protected PNG image on an answer option.
Revision ID: 0004
"""
from alembic import op
import sqlalchemy as sa

revision='0004'
down_revision='0003'
branch_labels=None
depends_on=None


def upgrade():
    op.add_column('options',sa.Column('image_path',sa.Text(),nullable=True))


def downgrade():
    raise RuntimeError('Destructive downgrade requires explicit review')
