"""Record issuance for idle session renewal with an absolute lifetime.
Revision ID: 0003
"""
from datetime import timedelta
from alembic import op
import sqlalchemy as sa

revision='0003'
down_revision='0002'
branch_labels=None
depends_on=None

def upgrade():
    op.add_column('auth_sessions',sa.Column('issued_at',sa.DateTime(timezone=True),nullable=True))
    # Historical sessions used a fixed 30-minute lifetime; infer their issuance.
    sessions=sa.table('auth_sessions',sa.column('token_hash',sa.String(64)),sa.column('expires_at',sa.DateTime(timezone=True)),sa.column('issued_at',sa.DateTime(timezone=True)))
    if op.get_bind().dialect.name=='sqlite':
        # SQLite datetime() truncates microseconds; preserve the stored precision.
        rows=op.get_bind().execute(sa.select(sessions.c.token_hash,sessions.c.expires_at)).all()
        for token_hash,expires in rows:
            op.execute(sessions.update().where(sessions.c.token_hash==token_hash).values(issued_at=expires-timedelta(minutes=30)))
    else:
        op.execute(sessions.update().values(issued_at=sessions.c.expires_at-sa.text("INTERVAL '30 minutes'")))
    with op.batch_alter_table('auth_sessions') as batch:
        batch.alter_column('issued_at',existing_type=sa.DateTime(timezone=True),nullable=False)

def downgrade():
    raise RuntimeError('Destructive downgrade requires explicit review')
