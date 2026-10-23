import pytest
from sqlalchemy import select
from app.models import AuditLog, Exam
from conftest import login, create_exam, start


async def draft_questions(client, teacher, count=5):
    response = await client.post('/api/teacher/exams', headers=teacher, json={'title': 'Tartiblash sinovi'})
    assert response.status_code == 200, response.text
    exam = response.json()
    questions = []
    for position in range(1, count + 1):
        response = await client.post(f'/api/teacher/exams/{exam["id"]}/questions', headers=teacher,
            json={'position': position, 'kind': 'short', 'text': f'{position}-savol', 'topic': f'Mavzu {position}',
                  'parts': [{'label': 'main', 'prompt': 'Yozing', 'weight': position, 'accepted': [f'javob {position}'], 'case_sensitive': True}]})
        assert response.status_code == 200, response.text
        questions.append(response.json())
    return exam, questions


@pytest.mark.parametrize('order', [[2, 4, 0, 3, 1], [4, 3, 2, 1, 0]])
async def test_reorder_keeps_content_and_keys_and_is_audited_and_publishable(client, db_session, order):
    teacher = await login(client, 'teacher')
    exam, questions = await draft_questions(client, teacher)
    ids = [questions[i]['id'] for i in order]
    response = await client.put(f'/api/teacher/exams/{exam["id"]}/questions/order', headers=teacher, json={'question_ids': ids})
    assert response.status_code == 200, response.text
    assert response.json() == {'question_ids': ids}
    rows = (await client.get(f'/api/teacher/exams/{exam["id"]}', headers=teacher)).json()['questions']
    assert rows == [{**questions[i], 'position': n} for n, i in enumerate(order, 1)]
    async with db_session() as db:
        log = await db.scalar(select(AuditLog).where(AuditLog.action == 'question.reorder', AuditLog.entity_id == exam['id']))
        assert log and log.before == {'question_ids': [q['id'] for q in questions]}
        assert log.after == {'question_ids': ids}
    response = await client.post(f'/api/teacher/exams/{exam["id"]}/publish', headers=teacher, json={'verified': True})
    assert response.status_code == 200, response.text


@pytest.mark.parametrize('invalid', ['missing', 'duplicate', 'foreign', 'unknown', 'extra', 'empty'])
async def test_reorder_rejects_anything_except_the_exact_exam_id_set_without_writes(client, db_session, invalid):
    teacher = await login(client, 'teacher')
    exam, questions = await draft_questions(client, teacher)
    ids = [q['id'] for q in questions]
    if invalid == 'missing': ids.pop()
    elif invalid == 'duplicate': ids[-1] = ids[0]
    elif invalid == 'foreign':
        _, other = await draft_questions(client, teacher, count=1)
        ids[-1] = other[0]['id']
    elif invalid == 'unknown': ids[-1] = 'missing-question'
    elif invalid == 'extra': ids.append(ids[0])
    else: ids = []
    response = await client.put(f'/api/teacher/exams/{exam["id"]}/questions/order', headers=teacher, json={'question_ids': ids})
    assert response.status_code == 422, response.text
    rows = (await client.get(f'/api/teacher/exams/{exam["id"]}', headers=teacher)).json()['questions']
    assert rows == questions
    async with db_session() as db:
        assert await db.scalar(select(AuditLog).where(AuditLog.action == 'question.reorder', AuditLog.entity_id == exam['id'])) is None


@pytest.mark.parametrize('with_attempt', [False, True])
async def test_reorder_rejects_published_exams_and_drafts_with_attempts(client, db_session, with_attempt):
    teacher = await login(client, 'teacher')
    exam = await create_exam(client, teacher)
    rows = (await client.get(f'/api/teacher/exams/{exam["id"]}', headers=teacher)).json()['questions']
    if with_attempt:
        student = await login(client)
        await start(client, student, exam)
        async with db_session.begin() as db:
            (await db.get(Exam, exam['id'])).status = 'draft'
    response = await client.put(f'/api/teacher/exams/{exam["id"]}/questions/order', headers=teacher,
                                json={'question_ids': [q['id'] for q in reversed(rows)]})
    assert response.status_code == 409, response.text
    assert (await client.get(f'/api/teacher/exams/{exam["id"]}', headers=teacher)).json()['questions'] == rows


async def test_reorder_requires_teacher_and_an_existing_exam(client):
    teacher = await login(client, 'teacher')
    student = await login(client)
    exam, questions = await draft_questions(client, teacher, count=1)
    url = f'/api/teacher/exams/{exam["id"]}/questions/order'
    body = {'question_ids': [q['id'] for q in questions]}
    assert (await client.put(url, json=body)).status_code == 401
    assert (await client.put(url, headers=student, json=body)).status_code == 403
    assert (await client.put('/api/teacher/exams/missing-exam/questions/order', headers=teacher, json=body)).status_code == 404


async def test_empty_exam_can_submit_its_complete_empty_order(client):
    teacher = await login(client, 'teacher')
    exam, _ = await draft_questions(client, teacher, count=0)
    response = await client.put(f'/api/teacher/exams/{exam["id"]}/questions/order', headers=teacher, json={'question_ids': []})
    assert response.status_code == 200, response.text
