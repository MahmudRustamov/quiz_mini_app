import csv
import io
import json
import uuid
import pytest
from sqlalchemy import select
from app.core.config import get_settings
from app.models import AuditLog, Exam
from conftest import login, create_exam, start
from test_assets import PNG


async def draft(client, teacher):
    response = await client.post('/api/teacher/exams', headers=teacher, json={'title': 'Rasm yuklash sinovi'})
    assert response.status_code == 200, response.text
    return response.json()


async def upload(client, teacher, exam, content=PNG, filename='photo.png', mime='image/png'):
    return await client.post(f'/api/teacher/exams/{exam["id"]}/images', headers=teacher, files={'file': (filename, content, mime)})


async def test_png_upload_uses_magic_bytes_generated_name_and_is_audited(client, db_session):
    teacher = await login(client, 'teacher'); exam = await draft(client, teacher)
    response = await upload(client, teacher, exam, filename='../../not-an-image.jpg', mime='text/html')
    assert response.status_code == 200, response.text
    path = response.json()['path']; directory, filename = path.split('/')
    assert directory == exam['id'] and filename.endswith('.png')
    assert str(uuid.UUID(filename[:-4])) == filename[:-4]
    assert (get_settings().upload_dir / path).read_bytes() == PNG
    assert (await client.get(f'/api/assets/{path}', headers=teacher)).content == PNG
    async with db_session() as db:
        log = await db.scalar(select(AuditLog).where(AuditLog.action == 'exam.image_upload', AuditLog.entity_id == exam['id']))
        assert log and log.after == {'path': path}


@pytest.mark.parametrize('content', [b'', b'<svg></svg>', b'not a PNG', b'\xff\xd8\xffJPEG', b'\x89PNG'])
async def test_upload_rejects_false_png_without_writing_a_file(client, content):
    teacher = await login(client, 'teacher'); exam = await draft(client, teacher)
    response = await upload(client, teacher, exam, content)
    assert response.status_code == 422, response.text
    assert not (get_settings().upload_dir / exam['id']).exists()


async def test_upload_enforces_the_configured_size_boundary(client, monkeypatch):
    teacher = await login(client, 'teacher'); exam = await draft(client, teacher)
    monkeypatch.setattr(get_settings(), 'max_upload_mb', 1)
    oversized = PNG + bytes(1024 * 1024 + 1 - len(PNG))
    assert (await upload(client, teacher, exam, oversized)).status_code == 413
    assert not (get_settings().upload_dir / exam['id']).exists()
    assert (await upload(client, teacher, exam, oversized[:-1])).status_code == 200


async def test_upload_requires_teacher_existing_exam_and_editable_draft(client, db_session):
    teacher = await login(client, 'teacher'); student = await login(client); exam = await draft(client, teacher)
    url = f'/api/teacher/exams/{exam["id"]}/images'
    assert (await client.post(url, files={'file': ('x.png', PNG)})).status_code == 401
    assert (await upload(client, student, exam)).status_code == 403
    assert (await upload(client, teacher, {'id': 'missing-exam'})).status_code == 404
    published = await create_exam(client, teacher)
    assert (await upload(client, teacher, published)).status_code == 409
    await start(client, student, published)
    async with db_session.begin() as db:
        (await db.get(Exam, published['id'])).status = 'draft'
    assert (await upload(client, teacher, published)).status_code == 409


@pytest.mark.parametrize('scope', ['question', 'option'])
@pytest.mark.parametrize('bad_path', ['other-exam/photo.png', '{id}/../photo.png', '{id}/photo.jpg', 'https://example.com/photo.png'])
async def test_image_paths_use_the_same_exam_scoped_validation(client, scope, bad_path):
    teacher = await login(client, 'teacher'); exam = await draft(client, teacher)
    path = bad_path.format(id=exam['id'])
    payload = {'position': 1, 'kind': 'single', 'text': 'Savol', 'parts': [{'label': 'main', 'accepted': ['A']}]}
    payload.update({'image_paths': [path], 'options': [{'label': 'A', 'text': 'Javob'}]} if scope == 'question' else {'options': [{'label': 'A', 'image_path': path}]})
    response = await client.post(f'/api/teacher/exams/{exam["id"]}/questions', headers=teacher, json=payload)
    assert response.status_code == 422, response.text
    assert (await client.get(f'/api/teacher/exams/{exam["id"]}', headers=teacher)).json()['questions'] == []


@pytest.mark.parametrize('text,image', [('', None), ('   ', None), ('', '')])
async def test_option_requires_text_or_image(client, text, image):
    teacher = await login(client, 'teacher'); exam = await draft(client, teacher)
    response = await client.post(f'/api/teacher/exams/{exam["id"]}/questions', headers=teacher,
        json={'position': 1, 'kind': 'single', 'text': 'Savol', 'options': [{'label': 'A', 'text': text, 'image_path': image}]})
    assert response.status_code == 422, response.text


async def test_upload_save_edit_publish_and_grade_image_only_options(client):
    teacher = await login(client, 'teacher'); student = await login(client); exam = await draft(client, teacher)
    question_image = (await upload(client, teacher, exam)).json()['path']
    option_image = (await upload(client, teacher, exam)).json()['path']
    payload = {'position': 1, 'kind': 'single', 'text': 'Rasmni tanlang', 'image_paths': [question_image],
               'options': [{'label': 'A', 'image_path': option_image}, {'label': 'B', 'text': 'Matnli variant'}],
               'parts': [{'label': 'main', 'accepted': ['A']}]}
    response = await client.post(f'/api/teacher/exams/{exam["id"]}/questions', headers=teacher, json=payload)
    assert response.status_code == 200, response.text
    question = response.json(); assert question['options'][0] == {'label': 'A', 'text': '', 'image_path': option_image}
    payload['text'] = 'Rasmni yana tanlang'
    assert (await client.put(f'/api/teacher/exams/{exam["id"]}/questions/{question["id"]}', headers=teacher, json=payload)).status_code == 200
    reopened = (await client.get(f'/api/teacher/exams/{exam["id"]}', headers=teacher)).json()['questions'][0]
    assert reopened['image_paths'] == [question_image] and reopened['options'][0]['image_path'] == option_image
    assert (await client.post(f'/api/teacher/exams/{exam["id"]}/publish', headers=teacher, json={'verified': True})).status_code == 200
    attempt = await start(client, student, exam)
    for path in [question_image, option_image]: assert (await client.get(f'/api/assets/{path}', headers=student)).content == PNG
    assert (await client.put(f'/api/attempts/{attempt["id"]}/responses/{question["id"]}', headers=student, json={'answers': {'main': 'A'}, 'revision': 0})).status_code == 200
    assert (await client.post(f'/api/attempts/{attempt["id"]}/submit', headers=student)).status_code == 200
    result = (await client.get(f'/api/attempts/{attempt["id"]}/result', headers=student)).json()
    assert result['raw_score'] == 1 and result['review'][0]['options'][0]['image_path'] == option_image
    assert 'accepted' not in str(result['review'])


@pytest.mark.parametrize('format', ['json', 'csv'])
@pytest.mark.parametrize('image_only', [False, True])
async def test_structured_import_preserves_legacy_text_options_and_new_images(client, format, image_only):
    teacher = await login(client, 'teacher'); exam = await draft(client, teacher)
    path = (await upload(client, teacher, exam)).json()['path'] if image_only else None
    entry = {'position': 1, 'kind': 'single', 'text': 'Import savoli',
             'options': [{'label': 'A', 'image_path': path}] if image_only else [{'label': 'A', 'text': 'Matn'}],
             'parts': [{'label': 'main', 'accepted': ['A']}]}
    content = json.dumps([entry])
    if format == 'csv':
        stream = io.StringIO(); writer = csv.DictWriter(stream, fieldnames=entry.keys()); writer.writeheader()
        writer.writerow({k: json.dumps(v) if isinstance(v, list) else v for k, v in entry.items()}); content = stream.getvalue()
    response = await client.post(f'/api/teacher/exams/{exam["id"]}/import/structured', headers=teacher, files={'file': (f'questions.{format}', content.encode())})
    assert response.status_code == 200, response.text
    assert response.json()['questions'][0]['options'] == [{'label': 'A', 'text': '' if image_only else 'Matn', 'image_path': path}]
