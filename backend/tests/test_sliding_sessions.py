import hashlib
from datetime import timedelta
import pytest
from sqlalchemy import select
from app.core import auth
from app.core.config import get_settings
from app.models import AuthSession, User, now
from conftest import login,create_exam,start

@pytest.fixture
def clock(monkeypatch):
    from app.api import routes
    from app.services import attempts
    monkeypatch.setattr(get_settings(),'bot_token','123:sliding-test-token')
    value={'now':now()}
    for module in (auth,routes,attempts):monkeypatch.setattr(module,'now',lambda:value['now'])
    return value

def token_hash(headers):
    return hashlib.sha256(headers['Authorization'].split(' ',1)[1].encode()).hexdigest()

async def session_row(db_session,headers):
    async with db_session() as db:
        return await db.get(AuthSession,token_hash(headers))

async def test_active_session_slides_only_below_half_idle_window(client,db_session,clock):
    headers=await login(client);issued=clock['now'];initial=auth.aware((await session_row(db_session,headers)).expires_at)
    for minutes in [14,15]:
        clock['now']=issued+timedelta(minutes=minutes)
        assert (await client.get('/api/me',headers=headers)).status_code==200
        assert auth.aware((await session_row(db_session,headers)).expires_at)==initial
    for minutes in [16,32,48,64,80,96]:
        clock['now']=issued+timedelta(minutes=minutes)
        response=await client.get('/api/me',headers=headers)
        assert response.status_code==200,response.text
        record=await session_row(db_session,headers)
        assert auth.aware(record.expires_at)==clock['now']+timedelta(minutes=30)
        assert auth.aware(record.issued_at)==issued

async def test_sliding_session_still_expires_after_idle_window(client,db_session,clock):
    headers=await login(client);issued=clock['now']
    for minutes in [20,40]:
        clock['now']=issued+timedelta(minutes=minutes)
        response=await client.get('/api/me',headers=headers)
        assert response.status_code==200,response.text
    assert auth.aware((await session_row(db_session,headers)).expires_at)==issued+timedelta(minutes=70)
    clock['now']=issued+timedelta(minutes=70)
    assert (await client.get('/api/me',headers=headers)).status_code==401

async def test_absolute_cap_clamps_renewal_and_rejects_continuous_use(client,db_session,clock,monkeypatch):
    monkeypatch.setattr(get_settings(),'session_absolute_hours',1,raising=False)
    headers=await login(client);issued=clock['now']
    for minutes in [20,40,59]:
        clock['now']=issued+timedelta(minutes=minutes)
        assert (await client.get('/api/me',headers=headers)).status_code==200
    assert auth.aware((await session_row(db_session,headers)).expires_at)==issued+timedelta(hours=1)
    clock['now']=issued+timedelta(hours=1)
    assert (await client.get('/api/me',headers=headers)).status_code==401

async def test_absolute_cap_rejects_a_session_even_with_future_idle_expiry(client,db_session,clock):
    headers=await login(client)
    async with db_session.begin() as db:
        record=await db.get(AuthSession,token_hash(headers));record.issued_at=clock['now']-timedelta(hours=12)
        record.expires_at=clock['now']+timedelta(minutes=30)
    assert (await client.get('/api/me',headers=headers)).status_code==401

async def test_create_session_records_issuance_caps_initial_expiry_and_keeps_purge(client,db_session,clock,monkeypatch):
    old=await login(client);issued=clock['now']
    async with db_session.begin() as db:
        record=await db.get(AuthSession,token_hash(old));record.expires_at=issued-timedelta(seconds=1)
    monkeypatch.setattr(get_settings(),'session_absolute_hours',1,raising=False)
    monkeypatch.setattr(get_settings(),'session_minutes',120)
    headers=await login(client)
    record=await session_row(db_session,headers)
    assert auth.aware(record.expires_at)==issued+timedelta(hours=1)
    assert auth.aware(record.issued_at)==issued
    assert await session_row(db_session,old) is None

async def test_inactive_user_cannot_renew_session(client,db_session,clock):
    headers=await login(client);issued=clock['now'];clock['now']=issued+timedelta(minutes=20)
    assert (await client.get('/api/me',headers=headers)).status_code==200
    expires=auth.aware((await session_row(db_session,headers)).expires_at)
    async with db_session.begin() as db:
        user=await db.scalar(select(User).where(User.telegram_id==-1001));user.active=False
    clock['now']=issued+timedelta(minutes=40)
    assert (await client.get('/api/me',headers=headers)).status_code==403
    assert auth.aware((await session_row(db_session,headers)).expires_at)==expires

async def test_exam_saves_and_submits_after_more_than_one_idle_window(client,db_session,clock):
    teacher=await login(client,'teacher');student=await login(client)
    exam=await create_exam(client,teacher);attempt=await start(client,student,exam);issued=clock['now']
    for minutes,question,answers in zip([20,40,60],attempt['exam']['questions'],[{'main':'A'},{'main':"o‘quvchi"},{'A':'bir','B':'ikki'}]):
        clock['now']=issued+timedelta(minutes=minutes)
        response=await client.put(f'/api/attempts/{attempt["id"]}/responses/{question["id"]}',headers=student,json={'answers':answers,'revision':0})
        assert response.status_code==200,response.text
    clock['now']=issued+timedelta(minutes=80)
    submitted=await client.post(f'/api/attempts/{attempt["id"]}/submit',headers=student)
    assert submitted.status_code==200 and submitted.json()['status']=='submitted'
    result=await client.get(f'/api/attempts/{attempt["id"]}/result',headers=student)
    assert result.status_code==200 and result.json()['raw_score']==7
