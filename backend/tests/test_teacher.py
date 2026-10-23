import json
import pymupdf
from sqlalchemy import select
from app.models import EssayRubric,User,AuditLog
from app.core.auth import create_session
from conftest import login,create_exam,start


async def test_manual_essay_multiple_experts_and_audit(client,db_session):
    teacher=await login(client,'teacher');student=await login(client);admin=await login(client,'admin')
    exam=await create_exam(client,teacher,essay=True,experts=2);a=await start(client,student,exam)
    assert (await client.put(f'/api/attempts/{a["id"]}/essay',headers=student,json={'text':'Talabaning mustaqil yozma ishi'})).status_code==200
    await client.post(f'/api/attempts/{a["id"]}/submit',headers=student)
    table={f'{i/2:.1f}':round((i/48)**2*75,4) for i in range(49)}
    async with db_session.begin() as db:
        teacher_user=await db.scalar(select(User).where(User.role=='teacher'))
        rubric=EssayRubric(source_name='SYNTHETIC TEST ONLY',source_sha256='0'*64,table=table,verified_by=teacher_user.id)
        db.add(rubric);await db.flush();rid=rubric.id
        second=User(telegram_id=4321,name='Expert 2',role='teacher');db.add(second);await db.flush();session=await create_session(db,second)
    expert2={'Authorization':f'Bearer {session["access_token"]}'}
    path=f'/api/teacher/attempts/{a["id"]}/essay-grade'
    assert (await client.put(path,headers=student,json={'score':12,'rubric_id':rid})).status_code==403
    assert (await client.put(path,headers=teacher,json={'score':12.25,'rubric_id':rid})).status_code==422
    assert (await client.put(path,headers=teacher,json={'score':12,'rubric_id':'missing'})).status_code==422
    assert (await client.put(path,headers=teacher,json={'score':11.5,'rubric_id':rid})).status_code==200
    assert (await client.put(path,headers=teacher,json={'score':12,'rubric_id':rid,'comment':'Correction'})).status_code==200
    result=(await client.get(f'/api/attempts/{a["id"]}/result',headers=teacher)).json()
    assert not result['essay_ready'] and result['final_score'] is None
    assert (await client.put(path,headers=expert2,json={'score':24,'rubric_id':rid})).status_code==200
    result=(await client.get(f'/api/attempts/{a["id"]}/result',headers=teacher)).json()
    assert result['essay_ready'] and result['converted_essay_score']==46.875
    assert result['final_score'] is None
    async with db_session() as db:
        logs=(await db.scalars(select(AuditLog).where(AuditLog.action=='essay.grade'))).all()
        assert len(logs)==3 and logs[1].before is not None
    await client.post(f'/api/admin/exams/{exam["id"]}/release',headers=admin,json={'results_published':True})
    assert (await client.put(path,headers=teacher,json={'score':10,'rubric_id':rid})).status_code==409


async def test_written_uncertainty_review_and_statistics_exports(client):
    teacher=await login(client,'teacher');student=await login(client);exam=await create_exam(client,teacher);a=await start(client,student,exam)
    q=a['exam']['questions'][1]
    await client.put(f'/api/attempts/{a["id"]}/responses/{q["id"]}',headers=student,json={'answers':{'main':'uncertain'},'revision':0})
    await client.post(f'/api/attempts/{a["id"]}/submit',headers=student)
    result=(await client.get(f'/api/attempts/{a["id"]}/result',headers=student)).json()
    assert result['pending_parts']==1
    part=q['parts'][0]
    assert (await client.put(f'/api/teacher/attempts/{a["id"]}/parts/{part["id"]}/grade',headers=teacher,json={'score':1,'reason':'Verified by teacher'})).status_code==200
    result=(await client.get(f'/api/attempts/{a["id"]}/result',headers=student)).json()
    assert result['pending_parts']==0 and result['raw_score']==1
    stats=(await client.get(f'/api/teacher/exams/{exam["id"]}/statistics',headers=teacher)).json()
    assert stats['participants']==1
    for fmt in ['csv','xlsx']:
        export=await client.get(f'/api/teacher/exams/{exam["id"]}/export?format={fmt}',headers=teacher)
        assert export.status_code==200 and len(export.content)>50


async def test_pdf_and_structured_import_without_invented_questions(client,tmp_path):
    teacher=await login(client,'teacher')
    exam=(await client.post('/api/teacher/exams',headers=teacher,json={'title':'Import draft'})).json()
    document=pymupdf.open();page=document.new_page();page.insert_text((40,60),'Selectable exam text');page.insert_text((40,90),'Left column');page.insert_text((340,60),'Right column');page.insert_text((340,90),'Right second block')
    content=document.tobytes();document.close()
    response=await client.post(f'/api/teacher/exams/{exam["id"]}/import/pdf',headers=teacher,files={'file':('exam.pdf',content,'application/pdf')})
    assert response.status_code==200,response.text
    assert 'Selectable exam text' in response.json()['extracted']['pages'][0]['text']
    assert response.json()['extracted']['verification_required']
    detail=(await client.get(f'/api/teacher/exams/{exam["id"]}',headers=teacher)).json()
    assert detail['question_count']==0
    question={'position':1,'kind':'short','text':'Explicit imported question','parts':[{'accepted':['Explicit key']}]}
    response=await client.post(f'/api/teacher/exams/{exam["id"]}/import/structured',headers=teacher,files={'file':('questions.json',json.dumps([question]).encode(),'application/json')})
    assert response.status_code==200,response.text
    assert response.json()['questions'][0]['parts'][0]['accepted']==['Explicit key']
