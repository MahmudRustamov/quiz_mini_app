from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.core.config import get_settings

engine = create_async_engine(get_settings().database_url, pool_pre_ping=True)
Session = async_sessionmaker(engine, expire_on_commit=False)


async def get_db():
    async with Session() as db:
        async with db.begin():
            yield db
