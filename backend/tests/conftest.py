import os
os.environ['ENVIRONMENT'] = 'development'
os.environ['DEV_AUTH'] = 'true'
os.environ['DATABASE_URL'] = os.getenv('TEST_DATABASE_URL', 'sqlite+aiosqlite://')
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import event
from app.main import app
from app.core.db import get_db
from app.models import Base, Role


@pytest_asyncio.fixture
async def db_session(tmp_path,monkeypatch):
    from app.core.config import get_settings
    monkeypatch.setattr(get_settings(), 'upload_dir', tmp_path / 'uploads')
    # TEST_DATABASE_URL must point to a disposable dedicated database.
    url = os.getenv('TEST_DATABASE_URL', f'sqlite+aiosqlite:///{tmp_path}/test.db')
    if url.startswith('postgresql'):
        from sqlalchemy.engine import make_url
        if not (make_url(url).database or '').endswith('_test'):
            raise RuntimeError('Refusing to recreate a PostgreSQL database without a _test suffix')
    engine = create_async_engine(url)
    if url.startswith('sqlite'):
        @event.listens_for(engine.sync_engine, 'connect')
        def foreign_keys(connection, _):
            connection.execute('PRAGMA foreign_keys=ON')
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)
    session = async_sessionmaker(engine, expire_on_commit=False)
    async with session.begin() as db:
        db.add_all([Role(name=r) for r in ['student','teacher','admin']])
    yield session
    await engine.dispose()


@pytest_asyncio.fixture
async def client(db_session):
    async def override():
        async with db_session() as db:
            async with db.begin():
                yield db
    app.dependency_overrides[get_db] = override
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test') as client:
        yield client
    app.dependency_overrides.clear()


async def login(client, account='student'):
    response = await client.post('/api/auth/dev',json={'account':account})
    assert response.status_code == 200, response.text
    return {'Authorization':f'Bearer {response.json()["access_token"]}'}


async def create_exam(client, teacher, essay=False, experts=1, questions=None):
    response = await client.post('/api/teacher/exams',headers=teacher,json={'title':'Sinov imtihoni','duration_minutes':90,'essay_required':essay,'expert_count':experts})
    assert response.status_code == 200, response.text
    exam=response.json()
    if questions is None:
        questions=[{'position':1,'kind':'single','text':'To‘g‘ri javobni tanlang','options':[{'label':'A','text':'Birinchi'},{'label':'B','text':'Ikkinchi'}],'parts':[{'label':'main','accepted':['A']}]},
                   {'position':2,'kind':'short','text':'So‘zni yozing','parts':[{'label':'main','accepted':["o‘quvchi"],'manual_review':True}]},
                   {'position':3,'kind':'two_part','text':'Ikki qismga javob bering','parts':[{'label':'A','accepted':['bir'],'weight':2},{'label':'B','accepted':['ikki'],'weight':3}]}]
    for q in questions:
        result=await client.post(f'/api/teacher/exams/{exam["id"]}/questions',headers=teacher,json=q)
        assert result.status_code==200,result.text
    response=await client.post(f'/api/teacher/exams/{exam["id"]}/publish',headers=teacher,json={'verified':True})
    assert response.status_code==200,response.text
    return exam


async def start(client, student, exam):
    response=await client.post(f'/api/exams/{exam["id"]}/attempts',headers=student)
    assert response.status_code==200,response.text
    attempt=response.json()
    response=await client.get(f'/api/attempts/{attempt["id"]}',headers=student)
    assert response.status_code==200,response.text
    return response.json()
