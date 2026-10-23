from sqlalchemy import select
from app.models import CalibrationRun,ItemParameter,QuestionPart,Question,Attempt,User,AuditLog
from conftest import login,create_exam,start


async def test_validated_parameters_apply_to_small_cohort_and_results_are_gated(client,db_session):
    teacher=await login(client,'teacher');admin=await login(client,'admin');student=await login(client)
    exam=await create_exam(client,teacher);a=await start(client,student,exam)
    for q,answers in zip(a['exam']['questions'],[{'main':'A'},{'main':"o'quvchi"},{'A':'bir','B':'ikki'}]):
        await client.put(f'/api/attempts/{a["id"]}/responses/{q["id"]}',headers=student,json={'answers':answers,'revision':0})
    await client.post(f'/api/attempts/{a["id"]}/submit',headers=student)
    async with db_session.begin() as db:
        staff=await db.scalar(select(User).where(User.role=='admin'))
        # Explicitly prevalidated statistical fixture; not inferred from a one-person cohort.
        run=CalibrationRun(exam_id=exam['id'],created_by=staff.id,diagnostics={'converged':True,'flags':[],'latent_mean':0,'persons':800,'items':4,'method':'prevalidated test fixture'})
        db.add(run);await db.flush();rid=run.id
        parts=(await db.scalars(select(QuestionPart).join(Question).where(Question.exam_id==exam['id']))).all()
        for p,b in zip(parts,[-1,-.5,.5,1]):db.add(ItemParameter(calibration_id=rid,part_id=p.id,difficulty=b,standard_error=.1))
    payload={'reference_name':'Recorded validation population','reference_mean':0,'reference_sd':1,'validation_note':'External reference checked by administrator; this is a statistical test fixture only.'}
    assert (await client.post(f'/api/admin/calibrations/{rid}/approve',headers=teacher,json=payload)).status_code==403
    assert (await client.post(f'/api/admin/calibrations/{rid}/approve',headers=admin,json=payload)).status_code==200
    for _ in range(2):
        scored=await client.post(f'/api/teacher/calibrations/{rid}/score',headers=teacher)
        assert scored.status_code==200 and scored.json()['scored']==1
    before=(await client.get(f'/api/attempts/{a["id"]}/result',headers=student)).json()
    assert before['t'] is None and before['grade'] is None
    await client.post(f'/api/admin/exams/{exam["id"]}/release',headers=admin,json={'results_published':True})
    after=(await client.get(f'/api/attempts/{a["id"]}/result',headers=student)).json()
    assert after['t']>50 and after['grade'] is not None
    assert after['reference']=={'name':payload['reference_name'],'mean':0,'sd':1}
    assert after['scoring_version']=='mock-t-v1'
    # Correcting a raw response invalidates the old parameter set and blocks its reapproval.
    await client.post(f'/api/admin/exams/{exam["id"]}/release',headers=admin,json={'results_published':False})
    part=a['exam']['questions'][1]['parts'][0]
    reviewed=await client.put(f'/api/teacher/attempts/{a["id"]}/parts/{part["id"]}/grade',headers=teacher,json={'score':0,'reason':'Corrected after review'})
    assert reviewed.status_code==200
    assert (await client.post(f'/api/admin/calibrations/{rid}/approve',headers=admin,json=payload)).status_code==422


async def test_small_calibration_does_not_publish_t_score(client):
    teacher=await login(client,'teacher');student=await login(client)
    exam=await create_exam(client,teacher);a=await start(client,student,exam)
    await client.post(f'/api/attempts/{a["id"]}/submit',headers=student)
    calibration=await client.post(f'/api/teacher/exams/{exam["id"]}/calibrations',headers=teacher)
    assert calibration.status_code==422
    result=(await client.get(f'/api/attempts/{a["id"]}/result',headers=student)).json()
    assert result['raw_score']==0 and result['t'] is None
