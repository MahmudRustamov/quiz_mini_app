from datetime import timedelta
import pytest
from sqlalchemy import select,func
from app.models import Attempt,RawGrade,User,AuthSession,now
from app.core.auth import create_session
from conftest import login,create_exam,start


async def test_create_save_resume_submit_and_no_key_leak(client,db_session):
    teacher=await login(client,'teacher');student=await login(client)
    exam=await create_exam(client,teacher)
    attempt=await start(client,student,exam);aid=attempt['id'];questions=attempt['exam']['questions']
    assert 'accepted' not in str(attempt)
    assert 'manual_review' not in str(attempt)
    for q,answers in zip(questions,[{'main':'A'},{'main':"O'QUVCHI"},{'A':'bir','B':'xato'}]):
        response=await client.put(f'/api/attempts/{aid}/responses/{q["id"]}',headers=student,json={'answers':answers,'marked':True,'revision':0})
        assert response.status_code==200,response.text
    resumed=(await client.get(f'/api/attempts/{aid}',headers=student)).json()
    assert len(resumed['responses'])==3
    assert resumed['deadline']==attempt['deadline']
    assert all(r['revision']==1 for r in resumed['responses'])
    repeated=(await client.post(f'/api/exams/{exam["id"]}/attempts',headers=student)).json()
    assert repeated['id']==aid
    stale=await client.put(f'/api/attempts/{aid}/responses/{questions[0]["id"]}',headers=student,json={'answers':{},'revision':0})
    assert stale.status_code==409
    for _ in range(2):
        assert (await client.post(f'/api/attempts/{aid}/submit',headers=student)).status_code==200
    result=(await client.get(f'/api/attempts/{aid}/result',headers=student)).json()
    assert result['raw_score']==4 and result['maximum']==7
    assert result['correct']==3 and result['incorrect']==1
    assert result['t'] is None and result['grade'] is None
    assert 'accepted' not in str(result)
    async with db_session() as db:
        assert await db.scalar(select(func.count()).select_from(RawGrade))==4
    assert (await client.put(f'/api/attempts/{aid}/responses/{questions[0]["id"]}',headers=student,json={'answers':{},'revision':1})).status_code==409
    assert (await client.put(f'/api/teacher/exams/{exam["id"]}/questions/{questions[0]["id"]}',headers=teacher,json={'position':1,'kind':'short','text':'Changed'})).status_code==409


async def test_expired_saves_commit_finalization(client,db_session):
    teacher=await login(client,'teacher');student=await login(client);exam=await create_exam(client,teacher);a=await start(client,student,exam)
    async with db_session.begin() as db:
        attempt=await db.get(Attempt,a['id']);attempt.deadline=now()-timedelta(seconds=1)
    response=await client.put(f'/api/attempts/{a["id"]}/responses/{a["exam"]["questions"][0]["id"]}',headers=student,json={'answers':{'main':'A'},'revision':0})
    assert response.status_code==409 and response.json()['submitted']
    async with db_session() as db:
        assert (await db.get(Attempt,a['id'])).status=='submitted'
        assert await db.scalar(select(func.count()).select_from(RawGrade))==4
    result=(await client.get(f'/api/attempts/{a["id"]}/result',headers=student)).json()
    assert result['unanswered']==4 and result['raw_score']==0


async def test_expired_read_auto_submits(client,db_session):
    teacher=await login(client,'teacher');student=await login(client);exam=await create_exam(client,teacher);a=await start(client,student,exam)
    async with db_session.begin() as db:
        attempt=await db.get(Attempt,a['id']);attempt.deadline=now()-timedelta(seconds=1)
    assert (await client.get(f'/api/attempts/{a["id"]}',headers=student)).json()['status']=='submitted'


async def test_other_student_cannot_access_or_modify(client,db_session):
    teacher=await login(client,'teacher');student=await login(client);exam=await create_exam(client,teacher);a=await start(client,student,exam)
    async with db_session.begin() as db:
        other=User(telegram_id=989,name='Other',role='student');db.add(other);await db.flush();session=await create_session(db,other)
    headers={'Authorization':f'Bearer {session["access_token"]}'}
    for route in [f'/attempts/{a["id"]}',f'/attempts/{a["id"]}/result']:
        assert (await client.get('/api'+route,headers=headers)).status_code==404
    assert (await client.post(f'/api/attempts/{a["id"]}/submit',headers=headers)).status_code==404


async def test_draft_verification_and_answer_release(client):
    teacher=await login(client,'teacher');admin=await login(client,'admin');student=await login(client)
    draft=(await client.post('/api/teacher/exams',headers=teacher,json={'title':'Empty draft'})).json()
    assert (await client.post(f'/api/teacher/exams/{draft["id"]}/publish',headers=teacher,json={'verified':True})).status_code==422
    assert (await client.post(f'/api/exams/{draft["id"]}/attempts',headers=student)).status_code==404
    exam=await create_exam(client,teacher);a=await start(client,student,exam)
    assert (await client.post(f'/api/admin/exams/{exam["id"]}/release',headers=admin,json={'results_published':True,'answer_released':True})).status_code==409
    await client.post(f'/api/attempts/{a["id"]}/submit',headers=student)
    assert (await client.post(f'/api/admin/exams/{exam["id"]}/release',headers=admin,json={'results_published':True,'answer_released':True})).status_code==200
    result=(await client.get(f'/api/attempts/{a["id"]}/result',headers=student)).json()
    assert result['review'][0]['parts'][0]['accepted']==['A']
    assert (await client.post(f'/api/exams/{exam["id"]}/attempts',headers=student)).status_code==404


async def test_44_questions_and_independent_ab_parts(client):
    teacher=await login(client,'teacher');student=await login(client)
    questions=[{'position':i,'kind':'short' if i<40 else 'two_part','text':f'Test fixture {i}',
                'parts':[{'label':'main','accepted':['yes']}] if i<40 else [{'label':'A','accepted':['a']},{'label':'B','accepted':['b']}]} for i in range(1,45)]
    exam=await create_exam(client,teacher,questions=questions);a=await start(client,student,exam)
    assert len(a['exam']['questions'])==44
    await client.post(f'/api/attempts/{a["id"]}/submit',headers=student)
    result=(await client.get(f'/api/attempts/{a["id"]}/result',headers=student)).json()
    assert result['maximum']==49 and result['unanswered']==49


async def test_postgres_concurrent_start_and_submit_are_idempotent(client,db_session):
    import os,asyncio
    if not os.getenv('TEST_DATABASE_URL','').startswith('postgresql'):
        pytest.skip('Requires real PostgreSQL row locks')
    teacher=await login(client,'teacher');student=await login(client);exam=await create_exam(client,teacher)
    starts=await asyncio.gather(*[client.post(f'/api/exams/{exam["id"]}/attempts',headers=student) for _ in range(4)])
    assert all(r.status_code==200 for r in starts)
    assert len({r.json()['id'] for r in starts})==1
    aid=starts[0].json()['id']
    submits=await asyncio.gather(*[client.post(f'/api/attempts/{aid}/submit',headers=student) for _ in range(4)])
    assert all(r.status_code==200 for r in submits)
    async with db_session() as db:
        assert await db.scalar(select(func.count()).select_from(RawGrade))==4


async def test_listing_endpoints_expire_due_attempts_without_locking_the_cohort(client,db_session):
    teacher=await login(client,'teacher');student=await login(client);exam=await create_exam(client,teacher);a=await start(client,student,exam)
    async with db_session.begin() as db:
        attempt=await db.get(Attempt,a['id']);attempt.deadline=now()-timedelta(seconds=1)
    mine=(await client.get('/api/attempts',headers=student)).json()
    assert [row['status'] for row in mine]==['submitted']
    listed=(await client.get('/api/teacher/attempts',headers=teacher)).json()
    assert [row['status'] for row in listed]==['submitted']
    filtered=(await client.get(f'/api/teacher/attempts?exam_id={exam["id"]}',headers=teacher)).json()
    assert [row['status'] for row in filtered]==['submitted']
    async with db_session() as db:
        assert await db.scalar(select(func.count()).select_from(RawGrade))==4


async def test_rankings_tolerate_a_blank_display_name(client,db_session):
    teacher=await login(client,'teacher');admin=await login(client,'admin');student=await login(client)
    exam=await create_exam(client,teacher);a=await start(client,student,exam)
    assert (await client.post(f'/api/attempts/{a["id"]}/submit',headers=student)).status_code==200
    async with db_session.begin() as db:
        (await db.scalar(select(User).where(User.telegram_id==-1001))).name='   '
    assert (await client.post(f'/api/admin/exams/{exam["id"]}/release',headers=admin,json={'results_published':True})).status_code==200
    response=await client.get(f'/api/rankings?exam_id={exam["id"]}',headers=student)
    assert response.status_code==200,response.text
    assert [row['name'] for row in response.json()['rows']]==['Talaba']
