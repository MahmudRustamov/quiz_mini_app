"""Initial examination schema.

Revision ID: 0001
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # This migration owns a frozen metadata snapshot, independent of future models.
    from pathlib import Path
    import json
    snapshot = json.loads((Path(__file__).parent / '0001_schema.json').read_text())
    metadata = sa.MetaData()
    for table in snapshot:
        columns = []
        for column in table['columns']:
            types = {'string': lambda: sa.String(column.get('length')), 'text': sa.Text,
                     'integer': sa.Integer, 'bigint': sa.BigInteger, 'float': sa.Float,
                     'boolean': sa.Boolean, 'datetime': lambda: sa.DateTime(timezone=True),
                     'json': lambda: sa.JSON().with_variant(JSONB(), 'postgresql')}
            args = [sa.ForeignKey(column['foreign_key'])] if column.get('foreign_key') else []
            columns.append(sa.Column(column['name'], types[column['type']](), *args,
                                     primary_key=column['primary_key'], nullable=column['nullable']))
        constraints = [sa.UniqueConstraint(*u) for u in table['unique']]
        constraints += [sa.CheckConstraint(c) for c in table['checks']]
        sa.Table(table['name'], metadata, *columns, *constraints)
    metadata.create_all(op.get_bind())
    for table in snapshot:
        for index in table['indexes']:
            op.create_index(index['name'], table['name'], index['columns'], unique=index['unique'])
    op.bulk_insert(metadata.tables['roles'], [{'name': x} for x in ['student', 'teacher', 'admin']])


def downgrade():
    raise RuntimeError('Destructive downgrade requires a reviewed backup and explicit migration')
