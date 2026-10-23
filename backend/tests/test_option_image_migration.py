import importlib.util
from pathlib import Path
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from conftest import login, create_exam


async def test_option_image_migration_preserves_existing_options_and_constraints(client, db_session):
    teacher = await login(client, 'teacher'); await create_exam(client, teacher)
    def migrate(connection):
        old = sa.Table('options', sa.MetaData(), autoload_with=connection)
        rows = [dict(row) for row in connection.execute(sa.select(old.c.id, old.c.question_id, old.c.label, old.c.text)).mappings()]
        assert rows
        old.drop(connection)
        metadata = sa.MetaData(); sa.Table('questions', metadata, autoload_with=connection)
        legacy = sa.Table('options', metadata, sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('question_id', sa.String(36), sa.ForeignKey('questions.id'), nullable=False),
            sa.Column('label', sa.String(30), nullable=False), sa.Column('text', sa.Text(), nullable=False),
            sa.UniqueConstraint('question_id', 'label'))
        sa.Index('ix_options_question_id', legacy.c.question_id); legacy.create(connection)
        connection.execute(legacy.insert(), rows)
        path = Path(__file__).parents[1] / 'alembic/versions/0004_option_image_path.py'
        spec = importlib.util.spec_from_file_location('option_image_migration', path); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        with Operations.context(MigrationContext.configure(connection)): module.upgrade()
        migrated = sa.Table('options', sa.MetaData(), autoload_with=connection)
        output = connection.execute(sa.select(migrated)).mappings().all()
        assert sorted((r['id'], r['question_id'], r['label'], r['text']) for r in output) == sorted((r['id'], r['question_id'], r['label'], r['text']) for r in rows)
        assert all(r['image_path'] is None for r in output) and migrated.c.image_path.nullable
        assert migrated.c.image_path.server_default is None
        assert any(i.name == 'ix_options_question_id' for i in migrated.indexes)
        assert any(isinstance(c, sa.UniqueConstraint) and {col.name for col in c.columns} == {'question_id', 'label'} for c in migrated.constraints)
        assert any(fk.target_fullname == 'questions.id' for fk in migrated.foreign_keys)
    async with db_session.kw['bind'].begin() as connection: await connection.run_sync(migrate)
