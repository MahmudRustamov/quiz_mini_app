import pytest
from sqlalchemy import select,func
from app.models import Exam,Question,QuestionPart,AnswerKey,Option,Passage,ImportDocument,AuditLog
from app.core.config import get_settings
from conftest import login,create_exam,start

async def draft(client,teacher,title='O‘chirish sinovi'):
    response=await client.post('/api/teacher/exams',headers=teacher,json={'title':title})
    assert response.status_code==200,response.text
    return response.json()

async def question(client,teacher,exam_id,position,passage_id=None):
    payload={'position':position,'kind':'single','text':f'{position}-savol','options':[{'label':'A','text':'Bir'},{'label':'B','text':'Ikki'}],
             'parts':[{'label':'main','accepted':['A']}],'passage_id':passage_id}
    response=await client.post(f'/api/teacher/exams/{exam_id}/questions',headers=teacher,json=payload)
    assert response.status_code==200,response.text
    return response.json()

async def passage(client,teacher,exam_id):
    response=await client.post(f'/api/teacher/exams/{exam_id}/passages',headers=teacher,json={'title':'Matn','text':'Umumiy matn.'})
    assert response.status_code==200,response.text
    return response.json()

async def test_delete_middle_question_renumbers_and_remains_publishable(client,db_session):
    teacher=await login(client,'teacher');exam=await draft(client,teacher);eid=exam['id']
    questions=[await question(client,teacher,eid,i) for i in range(1,4)]
    response=await client.delete(f'/api/teacher/exams/{eid}/questions/{questions[1]["id"]}',headers=teacher)
    assert response.status_code==200,response.text
    detail=(await client.get(f'/api/teacher/exams/{eid}',headers=teacher)).json()
    assert [(q['id'],q['position']) for q in detail['questions']]==[(questions[0]['id'],1),(questions[2]['id'],2)]
    async with db_session() as db:
        assert await db.get(Question,questions[1]['id']) is None
        assert await db.get(QuestionPart,questions[1]['parts'][0]['id']) is None
        assert await db.get(AnswerKey,questions[1]['parts'][0]['id']) is None
        assert await db.scalar(select(func.count()).select_from(Option).where(Option.question_id==questions[1]['id']))==0
        log=await db.scalar(select(AuditLog).where(AuditLog.action=='question.delete',AuditLog.entity_id==questions[1]['id']))
        assert log and log.before['position']==2
    published=await client.post(f'/api/teacher/exams/{eid}/publish',headers=teacher,json={'verified':True})
    assert published.status_code==200,published.text

async def test_delete_first_question_renumbers_multiple_rows_in_order(client):
    teacher=await login(client,'teacher');exam=await draft(client,teacher);eid=exam['id']
    questions=[await question(client,teacher,eid,i) for i in range(1,5)]
    response=await client.delete(f'/api/teacher/exams/{eid}/questions/{questions[0]["id"]}',headers=teacher)
    assert response.status_code==200,response.text
    rows=(await client.get(f'/api/teacher/exams/{eid}',headers=teacher)).json()['questions']
    assert [(q['id'],q['position']) for q in rows]==[(q['id'],i) for i,q in enumerate(questions[1:],1)]

@pytest.mark.parametrize('kind',['question','passage','exam'])
async def test_deletion_requires_teacher_and_is_scoped_to_exam(client,kind):
    teacher=await login(client,'teacher');student=await login(client)
    first=await draft(client,teacher);second=await draft(client,teacher)
    q=await question(client,teacher,first['id'],1);p=await passage(client,teacher,first['id'])
    suffix={'question':f'/questions/{q["id"]}','passage':f'/passages/{p["id"]}','exam':''}[kind]
    url=f'/api/teacher/exams/{first["id"]}{suffix}'
    assert (await client.delete(url,headers=student)).status_code==403
    assert (await client.delete(url)).status_code==401
    if kind!='exam':
        assert (await client.delete(f'/api/teacher/exams/{second["id"]}{suffix}',headers=teacher)).status_code==404
    assert (await client.delete(url,headers=teacher)).status_code==200
    assert (await client.delete(url,headers=teacher)).status_code==404

@pytest.mark.parametrize('kind',['question','passage','exam'])
async def test_published_exam_deletion_returns_conflict(client,kind):
    teacher=await login(client,'teacher');exam=await create_exam(client,teacher);eid=exam['id']
    detail=(await client.get(f'/api/teacher/exams/{eid}',headers=teacher)).json()
    suffix={'question':f'/questions/{detail["questions"][0]["id"]}','passage':'/passages/unknown','exam':''}[kind]
    assert (await client.delete(f'/api/teacher/exams/{eid}{suffix}',headers=teacher)).status_code==409

@pytest.mark.parametrize('kind',['question','passage','exam'])
async def test_draft_with_existing_attempt_cannot_be_deleted(client,db_session,kind):
    teacher=await login(client,'teacher');student=await login(client);exam=await create_exam(client,teacher);eid=exam['id']
    attempt=await start(client,student,exam)
    async with db_session.begin() as db:
        (await db.get(Exam,eid)).status='draft'
    suffix={'question':f'/questions/{attempt["exam"]["questions"][0]["id"]}','passage':'/passages/unknown','exam':''}[kind]
    assert (await client.delete(f'/api/teacher/exams/{eid}{suffix}',headers=teacher)).status_code==409

async def test_referenced_passage_is_refused_and_unreferenced_passage_is_audited(client,db_session):
    teacher=await login(client,'teacher');exam=await draft(client,teacher);eid=exam['id'];p=await passage(client,teacher,eid)
    q=await question(client,teacher,eid,1,p['id'])
    response=await client.delete(f'/api/teacher/exams/{eid}/passages/{p["id"]}',headers=teacher)
    assert response.status_code==409 and 'matn' in response.json()['detail'].lower()
    assert (await client.delete(f'/api/teacher/exams/{eid}/questions/{q["id"]}',headers=teacher)).status_code==200
    assert (await client.delete(f'/api/teacher/exams/{eid}/passages/{p["id"]}',headers=teacher)).status_code==200
    async with db_session() as db:
        assert await db.get(Passage,p['id']) is None
        log=await db.scalar(select(AuditLog).where(AuditLog.action=='passage.delete',AuditLog.entity_id==p['id']))
        assert log and log.before['text']=='Umumiy matn.'

@pytest.mark.parametrize('files',['present','missing','symlink'])
async def test_delete_draft_exam_removes_dependents_and_uploads_but_keeps_audit(client,db_session,tmp_path,files):
    teacher=await login(client,'teacher');exam=await draft(client,teacher);eid=exam['id'];p=await passage(client,teacher,eid)
    questions=[await question(client,teacher,eid,i,p['id']) for i in range(1,3)]
    upload_dir=get_settings().upload_dir;upload_dir.mkdir(parents=True,exist_ok=True);directory=upload_dir/eid
    outside=tmp_path/'outside';outside.mkdir();(outside/'keep.txt').write_text('Keep me')
    if files=='present':directory.mkdir();(directory/'page.png').write_bytes(b'fixture')
    if files=='symlink':directory.symlink_to(outside,target_is_directory=True)
    async with db_session.begin() as db:
        record=await db.get(Exam,eid)
        db.add(ImportDocument(exam_id=eid,source_name='fixture.pdf',source_sha256='0'*64,extracted={},created_by=record.created_by))
    response=await client.delete(f'/api/teacher/exams/{eid}',headers=teacher)
    assert response.status_code==200,response.text
    async with db_session() as db:
        for model in [Exam,Question,QuestionPart,AnswerKey,Option,Passage,ImportDocument]:
            assert await db.scalar(select(func.count()).select_from(model))==0
        logs=(await db.scalars(select(AuditLog).where(AuditLog.entity_id==eid))).all()
        assert {log.action for log in logs}>={'exam.create','exam.delete'}
        deleted=next(log for log in logs if log.action=='exam.delete')
        assert deleted.before['title']==exam['title'] and deleted.before['question_count']==2
        assert await db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.action=='question.create'))==2
    assert not directory.exists() and not directory.is_symlink()
    assert (outside/'keep.txt').read_text()=='Keep me'

async def test_failed_delete_transaction_preserves_exam_and_uploads(client,db_session):
    from app.main import app
    from app.core.db import get_db
    teacher=await login(client,'teacher');exam=await draft(client,teacher);eid=exam['id']
    await question(client,teacher,eid,1)
    directory=get_settings().upload_dir/eid;directory.mkdir(parents=True);(directory/'keep.png').write_bytes(b'fixture')
    original=app.dependency_overrides[get_db]
    async def fail_commit():
        async with db_session() as db:
            async with db.begin():
                yield db
                raise RuntimeError('Simulated request failure')
    app.dependency_overrides[get_db]=fail_commit
    try:
        with pytest.raises(RuntimeError,match='Simulated request failure'):
            await client.delete(f'/api/teacher/exams/{eid}',headers=teacher)
    finally:
        app.dependency_overrides[get_db]=original
    async with db_session() as db:
        assert await db.get(Exam,eid) is not None
        assert await db.scalar(select(func.count()).select_from(Question))==1
        assert await db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.action=='exam.delete'))==0
    assert (directory/'keep.png').read_bytes()==b'fixture'
