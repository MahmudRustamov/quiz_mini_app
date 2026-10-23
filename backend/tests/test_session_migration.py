import importlib.util
from datetime import timedelta
from pathlib import Path
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from app.core.auth import aware
from app.models import now

async def test_session_migration_backfills_and_preserves_existing_expiry_and_index(db_session):
    engine=db_session.kw['bind'];expires=now()+timedelta(minutes=10)
    def migrate(connection):
        metadata=sa.MetaData()
        existing=sa.Table('auth_sessions',metadata,autoload_with=connection);existing.drop(connection)
        metadata=sa.MetaData()
        legacy=sa.Table('auth_sessions',metadata,sa.Column('token_hash',sa.String(64),primary_key=True),
                        sa.Column('user_id',sa.String(36),nullable=False),sa.Column('expires_at',sa.DateTime(timezone=True),nullable=False))
        sa.Index('ix_auth_sessions_expires_at',legacy.c.expires_at);metadata.create_all(connection)
        connection.execute(legacy.insert(),[{'token_hash':'legacy','user_id':'legacy-user','expires_at':expires}])
        path=Path(__file__).parents[1]/'alembic/versions/0003_session_issued_at.py'
        spec=importlib.util.spec_from_file_location('session_migration',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        with Operations.context(MigrationContext.configure(connection)):module.upgrade()
        migrated=sa.Table('auth_sessions',sa.MetaData(),autoload_with=connection)
        record=connection.execute(sa.select(migrated)).mappings().one()
        assert aware(record['issued_at'])==aware(expires)-timedelta(minutes=30)
        assert aware(record['expires_at'])==aware(expires)
        assert not migrated.c.issued_at.nullable
        assert migrated.c.issued_at.server_default is None
        assert any(index.name=='ix_auth_sessions_expires_at' for index in migrated.indexes)
        assert [column.name for column in migrated.primary_key]==['token_hash']
    async with engine.begin() as connection:await connection.run_sync(migrate)
