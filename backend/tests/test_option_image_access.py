"""Upload an option image and prove the student who sits the exam can fetch it.

The browser suite mocks the API, so this is the only place the whole chain runs
for real: upload, persist on the option, publish, then serve through the
authorization branch students actually take.
"""
import base64
from app.models import User
from app.core.auth import create_session
from conftest import login, start

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')


async def upload(client, teacher, exam_id, content=PNG, name='rasm.png'):
    return await client.post(f'/api/teacher/exams/{exam_id}/images', headers=teacher,
                             files={'file': (name, content, 'image/png')})


async def test_student_can_fetch_an_option_image_only_for_an_exam_they_sit(client, db_session):
    teacher = await login(client, 'teacher')
    student = await login(client)
    exam = (await client.post('/api/teacher/exams', headers=teacher,
                              json={'title': 'Rasmli variantlar', 'duration_minutes': 60})).json()
    uploaded = await upload(client, teacher, exam['id'])
    assert uploaded.status_code == 200, uploaded.text
    path = uploaded.json()['path']
    assert path.startswith(f'{exam["id"]}/') and path.endswith('.png')

    # B carries an image and no text at all — the case OptionInput used to reject.
    question = {'position': 1, 'kind': 'single', 'text': 'Qaysi rasm to‘g‘ri?', 'topic': 'Umumiy',
                'options': [{'label': 'A', 'text': 'Matnli variant'}, {'label': 'B', 'text': '', 'image_path': path},
                            {'label': 'C', 'text': 'Uchinchi'}, {'label': 'D', 'text': 'To‘rtinchi'}],
                'parts': [{'label': 'main', 'prompt': '', 'weight': 1, 'accepted': ['B']}]}
    created = await client.post(f'/api/teacher/exams/{exam["id"]}/questions', headers=teacher, json=question)
    assert created.status_code == 200, created.text
    assert (await client.post(f'/api/teacher/exams/{exam["id"]}/publish', headers=teacher,
                              json={'verified': True})).status_code == 200

    attempt = await start(client, student, exam)
    served = [o for o in attempt['exam']['questions'][0]['options'] if o['label'] == 'B'][0]
    assert served['image_path'] == path, 'the option image must survive student serialization'

    filename = path.split('/', 1)[1]
    fetched = await client.get(f'/api/assets/{exam["id"]}/{filename}', headers=student)
    assert fetched.status_code == 200, fetched.text
    assert fetched.headers['content-type'] == 'image/png' and fetched.content == PNG

    # A student without an attempt on this exam must not reach the same file.
    async with db_session.begin() as db:
        other = User(telegram_id=4242, name='Boshqa talaba', role='student')
        db.add(other)
        await db.flush()
        session = await create_session(db, other)
    outsider = {'Authorization': f'Bearer {session["access_token"]}'}
    assert (await client.get(f'/api/assets/{exam["id"]}/{filename}', headers=outsider)).status_code == 404
    assert (await client.get(f'/api/assets/{exam["id"]}/{filename}', headers=teacher)).status_code == 200


async def test_upload_rejects_non_png_and_guards_the_path(client):
    teacher = await login(client, 'teacher')
    exam = (await client.post('/api/teacher/exams', headers=teacher,
                              json={'title': 'Yuklash cheklovlari', 'duration_minutes': 60})).json()
    # A PDF renamed to .png must not pass: the magic bytes decide, not the filename.
    assert (await upload(client, teacher, exam['id'], b'%PDF-1.7 fake')).status_code == 422
    path = (await upload(client, teacher, exam['id'])).json()['path']
    filename = path.split('/', 1)[1]

    student = await login(client)
    for bad in ['../secret.png', '..%2Fsecret.png', filename.replace('.png', '.txt')]:
        assert (await client.get(f'/api/assets/{exam["id"]}/{bad}', headers=student)).status_code == 404
    # Uploaded but never attached to a question: still out of reach for students.
    assert (await client.get(f'/api/assets/{exam["id"]}/{filename}', headers=student)).status_code == 404
