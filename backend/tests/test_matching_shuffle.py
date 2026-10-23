"""Matching options must not reach a student in their authoring order.

The editor labels parts p1..pN and options R1..RN as pairs are added, and both
are serialized sorted by label. Without a per-attempt shuffle the Nth row's
answer is always the Nth option, so a student scores full marks by picking them
in order without reading anything.
"""
from app.models import User
from app.core.auth import create_session
from conftest import login, start

PAIRS = [('dengiz', 'suv'), ('quyosh', 'olov'), ('tog‘', 'tosh'), ('o‘rmon', 'daraxt'),
         ('cho‘l', 'qum'), ('osmon', 'bulut'), ('bog‘', 'gul'), ('dala', 'bug‘doy')]
QUESTION = {'position': 1, 'kind': 'matching', 'text': 'Juftlarni moslang', 'topic': 'Leksika',
            'options': [{'label': f'R{i}', 'text': right} for i, (_, right) in enumerate(PAIRS, 1)],
            'parts': [{'label': f'p{i}', 'prompt': left, 'weight': 1, 'accepted': [f'R{i}']}
                      for i, (left, _) in enumerate(PAIRS, 1)]}


async def published_exam(client, teacher):
    exam = (await client.post('/api/teacher/exams', headers=teacher,
                              json={'title': 'Moslashtirish', 'duration_minutes': 60})).json()
    created = await client.post(f'/api/teacher/exams/{exam["id"]}/questions', headers=teacher, json=QUESTION)
    assert created.status_code == 200, created.text
    assert (await client.post(f'/api/teacher/exams/{exam["id"]}/publish', headers=teacher,
                              json={'verified': True})).status_code == 200
    return exam


async def sitting(client, db_session, exam, telegram_id):
    async with db_session.begin() as db:
        student = User(telegram_id=telegram_id, name=f'Talaba {telegram_id}', role='student')
        db.add(student)
        await db.flush()
        session = await create_session(db, student)
    headers = {'Authorization': f'Bearer {session["access_token"]}'}
    attempt = (await client.post(f'/api/exams/{exam["id"]}/attempts', headers=headers)).json()
    return headers, attempt['id']


async def options_of(client, headers, attempt_id):
    data = (await client.get(f'/api/attempts/{attempt_id}', headers=headers)).json()
    question = data['exam']['questions'][0]
    return [o['label'] for o in question['options']], [p['label'] for p in question['parts']]


async def test_matching_options_are_shuffled_per_attempt_and_stay_stable(client, db_session):
    teacher = await login(client, 'teacher')
    exam = await published_exam(client, teacher)
    authoring = [f'R{i}' for i in range(1, len(PAIRS) + 1)]

    orders = []
    for telegram_id in (7001, 7002, 7003):
        headers, attempt_id = await sitting(client, db_session, exam, telegram_id)
        options, parts = await options_of(client, headers, attempt_id)
        assert sorted(options) == sorted(authoring), 'every option must still be offered'
        assert parts == [f'p{i}' for i in range(1, len(PAIRS) + 1)], 'left column keeps the authored order'
        # Reading twice must not reshuffle, or a student loses their place on reload.
        again, _ = await options_of(client, headers, attempt_id)
        assert again == options, 'the order must be stable for one attempt'
        orders.append(options)

    # With eight pairs, three attempts all landing on the authoring order is 1 in 4e13.
    assert any(order != authoring for order in orders), 'options must not arrive in authoring order'
    assert len({tuple(order) for order in orders}) > 1, 'different attempts must see different orders'


async def test_shuffling_does_not_change_grading(client, db_session):
    teacher = await login(client, 'teacher')
    exam = await published_exam(client, teacher)
    headers, attempt_id = await sitting(client, db_session, exam, 7010)
    data = (await client.get(f'/api/attempts/{attempt_id}', headers=headers)).json()
    question = data['exam']['questions'][0]

    # Answer by the labels the payload carries, whatever order they arrive in.
    answers = {f'p{i}': f'R{i}' for i in range(1, len(PAIRS) + 1)}
    saved = await client.put(f'/api/attempts/{attempt_id}/responses/{question["id"]}',
                             headers=headers, json={'answers': answers, 'revision': 0})
    assert saved.status_code == 200, saved.text
    assert (await client.post(f'/api/attempts/{attempt_id}/submit', headers=headers)).status_code == 200
    result = (await client.get(f'/api/attempts/{attempt_id}/result', headers=headers)).json()
    assert result['raw_score'] == len(PAIRS) and result['correct'] == len(PAIRS)

    # Picking the Nth option for the Nth row must no longer be a free full score.
    other, other_attempt = await sitting(client, db_session, exam, 7011)
    shown = (await client.get(f'/api/attempts/{other_attempt}', headers=other)).json()['exam']['questions'][0]
    positional = {part['label']: option['label'] for part, option in zip(shown['parts'], shown['options'])}
    await client.put(f'/api/attempts/{other_attempt}/responses/{shown["id"]}',
                     headers=other, json={'answers': positional, 'revision': 0})
    assert (await client.post(f'/api/attempts/{other_attempt}/submit', headers=other)).status_code == 200
    blind = (await client.get(f'/api/attempts/{other_attempt}/result', headers=other)).json()
    assert blind['raw_score'] < len(PAIRS), 'matching by position must not score full marks'
