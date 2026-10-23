import hashlib
import hmac
import json
import time
from datetime import timedelta
from urllib.parse import urlencode
import pytest
from pydantic import ValidationError
from app.core.auth import aware, validate_init_data
from app.core.config import Settings, get_settings
from app.models import AuthSession, now
from sqlalchemy import select
from conftest import login


def signed_data(token='123:abc', date=None):
    values={'auth_date':str(int(time.time()) if date is None else date),'query_id':'test','user':json.dumps({'id':1234,'first_name':'Talaba'})}
    check='\n'.join(f'{k}={v}' for k,v in sorted(values.items()))
    secret=hmac.digest(b'WebAppData',token.encode(),'sha256')
    values['hash']=hmac.digest(secret,check.encode(),'sha256').hex()
    return urlencode(values)


def test_telegram_hmac_and_expiry():
    assert validate_init_data(signed_data(),'123:abc')['id']==1234
    for data in [signed_data().replace('test','changed'),signed_data(date=1),signed_data(date=int(time.time())+300),signed_data()+'&auth_date=1']:
        with pytest.raises(ValueError):validate_init_data(data,'123:abc')
    with pytest.raises(ValueError):validate_init_data(signed_data(),'wrong')


def test_production_disallows_development_auth():
    with pytest.raises(ValidationError):Settings(environment='production',dev_auth=True,bot_token='x',mini_app_url='https://example.com')
    with pytest.raises(ValidationError):Settings(environment='production',dev_auth=False,bot_token='x',mini_app_url='http://localhost')


async def test_authentication_session_expiry_and_logout(client,db_session):
    assert (await client.get('/api/me')).status_code==401
    headers=await login(client)
    assert (await client.get('/api/me',headers=headers)).json()['role']=='student'
    async with db_session.begin() as db:
        session=await db.scalar(select(AuthSession))
        session.expires_at=now()-timedelta(seconds=1)
    assert (await client.get('/api/me',headers=headers)).status_code==401
    headers=await login(client)
    assert (await client.post('/api/auth/logout',headers=headers)).status_code==200
    assert (await client.get('/api/me',headers=headers)).status_code==401


async def test_secure_telegram_endpoint_and_dev_disabled(client,monkeypatch):
    settings=get_settings()
    monkeypatch.setattr(settings,'bot_token','123:abc')
    response=await client.post('/api/auth/telegram',json={'init_data':signed_data()})
    assert response.status_code==200,response.text
    headers={'Authorization':f'Bearer {response.json()["access_token"]}'}
    assert (await client.get('/api/me',headers=headers)).json()['telegram_id']==1234
    assert (await client.post('/api/auth/telegram',json={'init_data':'hash=bad'})).status_code==401
    monkeypatch.setattr(settings,'dev_auth',False)
    assert (await client.post('/api/auth/dev',json={'account':'admin'})).status_code==404


async def test_roles_are_enforced_on_backend(client):
    student=await login(client)
    for route in ['/teacher/exams','/teacher/students','/teacher/attempts','/teacher/rubrics','/admin/audit']:
        assert (await client.get('/api'+route,headers=student)).status_code==403
    assert (await client.post('/api/teacher/exams',headers=student,json={'title':'Forbidden'})).status_code==403
    teacher=await login(client,'teacher')
    assert (await client.get('/api/admin/audit',headers=teacher)).status_code==403
    assert (await client.post('/api/auth/dev',json={'account':'superuser'})).status_code==422


async def test_local_cors_origins_are_explicit(client):
    for origin in ['http://localhost:5173','http://127.0.0.1:5173']:
        response=await client.options('/api/auth/dev',headers={'Origin':origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'})
        assert response.status_code==200
        assert response.headers['access-control-allow-origin']==origin
    response=await client.options('/api/auth/dev',headers={'Origin':'https://untrusted.example','Access-Control-Request-Method':'POST'})
    assert response.status_code==400


async def test_ngrok_header_preflight_preserves_authorization_and_content_type(client):
    response = await client.options('/api/auth/telegram', headers={
        'Origin': 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type,ngrok-skip-browser-warning',
    })
    assert response.status_code == 200
    assert response.headers['access-control-allow-origin'] == 'http://localhost:5173'
    allowed = response.headers['access-control-allow-headers'].lower()
    assert all(header in allowed for header in ['authorization', 'content-type', 'ngrok-skip-browser-warning'])
    rejected = await client.options('/api/me', headers={
        'Origin': 'https://untrusted.example',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,ngrok-skip-browser-warning',
    })
    assert rejected.status_code == 400
    assert 'access-control-allow-origin' not in rejected.headers


async def test_telegram_login_then_me_with_dev_auth_disabled(client, monkeypatch, caplog):
    import logging
    settings = get_settings()
    monkeypatch.setattr(settings, 'bot_token', '123:production-auth-test')
    monkeypatch.setattr(settings, 'dev_auth', False)
    monkeypatch.setattr(settings, 'environment', 'production')
    headers = {'Origin': 'http://localhost:5173', 'ngrok-skip-browser-warning': 'true'}
    with caplog.at_level(logging.INFO, logger='uvicorn.error'):
        assert (await client.get('/api/config', headers=headers)).json() == {'dev_auth': False}
        response = await client.post('/api/auth/telegram', headers=headers,
                                     json={'init_data': signed_data(token=settings.bot_token)})
        assert response.status_code == 200
        token = response.json()['access_token']
        me = await client.get('/api/me', headers={**headers, 'Authorization': f'Bearer {token}'})
        assert me.status_code == 200 and me.json()['telegram_id'] == 1234
        assert (await client.post('/api/auth/dev', json={'account': 'admin'})).status_code == 404
        invalid = await client.post('/api/auth/telegram', json={'init_data': 'PRIVATE_INITDATA_SENTINEL'})
        assert invalid.status_code == 401
    logs = caplog.text
    assert 'path=/api/me status=200 authorization_present=True' in logs
    assert token not in logs and settings.bot_token not in logs
    assert 'PRIVATE_INITDATA_SENTINEL' not in logs
    assert signed_data(token=settings.bot_token) not in logs


async def test_expired_sessions_are_purged_and_responses_refuse_framing(client,db_session):
    headers=await login(client)
    async with db_session.begin() as db:
        (await db.scalar(select(AuthSession))).expires_at=now()-timedelta(seconds=1)
    await login(client)
    async with db_session() as db:
        remaining=(await db.scalars(select(AuthSession))).all()
    assert len(remaining)==1 and aware(remaining[0].expires_at)>now()
    response=await client.get('/api/me',headers=headers)
    assert response.status_code==401
    assert response.headers['x-frame-options']=='DENY'
    assert response.headers['content-security-policy']=="frame-ancestors 'none'"
    assert 'strict-transport-security' not in response.headers
