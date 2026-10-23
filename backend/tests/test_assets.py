import base64
import pytest
from app.core.config import get_settings
from conftest import login, start

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0S8AAAAASUVORK5CYII=')


async def exam_with_image(client, teacher, filename='question.png', image_on_option=False):
    response = await client.post('/api/teacher/exams', headers=teacher, json={'title': 'Rasmli sinov'})
    assert response.status_code == 200, response.text
    exam = response.json()
    path = f'{exam["id"]}/{filename}'
    directory = get_settings().upload_dir / exam['id']
    directory.mkdir(parents=True)
    (directory / filename).write_bytes(PNG)
    response = await client.post(f'/api/teacher/exams/{exam["id"]}/questions', headers=teacher,
        json={'position': 1, 'kind': 'single' if image_on_option else 'short', 'text': 'Rasmga qarang',
              'image_paths': [] if image_on_option else [path],
              'options': [{'label': 'A', 'text': '', 'image_path': path}, {'label': 'B', 'text': 'Matnli variant'}] if image_on_option else [],
              'parts': [{'label': 'main', 'accepted': ['A' if image_on_option else 'javob']}]})
    assert response.status_code == 200, response.text
    assert (await client.post(f'/api/teacher/exams/{exam["id"]}/publish', headers=teacher, json={'verified': True})).status_code == 200
    return exam, path


@pytest.mark.parametrize('image_on_option', [False, True])
async def test_student_with_attempt_can_fetch_referenced_image(client, image_on_option):
    teacher = await login(client, 'teacher'); student = await login(client)
    exam, path = await exam_with_image(client, teacher, image_on_option=image_on_option)
    attempt = await start(client, student, exam)
    if image_on_option:
        assert attempt['exam']['questions'][0]['options'][0] == {'label': 'A', 'text': '', 'image_path': path}
        assert 'accepted' not in str(attempt['exam']['questions'])
    response = await client.get(f'/api/assets/{path}', headers=student)
    assert response.status_code == 200 and response.content == PNG
    assert response.headers['content-type'] == 'image/png'
    assert 'no-store' in response.headers['cache-control']


@pytest.mark.parametrize('image_on_option', [False, True])
async def test_student_without_attempt_cannot_fetch_image(client, image_on_option):
    teacher = await login(client, 'teacher'); student = await login(client)
    _, path = await exam_with_image(client, teacher, image_on_option=image_on_option)
    assert (await client.get(f'/api/assets/{path}', headers=student)).status_code == 404
    assert (await client.get(f'/api/assets/{path}')).status_code == 401


@pytest.mark.parametrize('image_on_option', [False, True])
async def test_student_attempt_does_not_grant_access_to_other_exam_or_unreferenced_files(client, image_on_option):
    teacher = await login(client, 'teacher'); student = await login(client)
    own, _ = await exam_with_image(client, teacher)
    _, other_path = await exam_with_image(client, teacher, 'other.png', image_on_option=image_on_option)
    await start(client, student, own)
    # Even a physical file with the other exam's filename is not in this exam's allowlist.
    (get_settings().upload_dir / own['id'] / 'other.png').write_bytes(PNG)
    assert (await client.get(f'/api/assets/{other_path}', headers=student)).status_code == 404
    assert (await client.get(f'/api/assets/{own["id"]}/other.png', headers=student)).status_code == 404


@pytest.mark.parametrize('role', ['teacher', 'admin'])
async def test_staff_can_fetch_exam_assets_without_an_attempt_or_question_reference(client, role):
    teacher = await login(client, 'teacher'); staff = await login(client, role)
    exam, path = await exam_with_image(client, teacher)
    (get_settings().upload_dir / exam['id'] / 'page.png').write_bytes(PNG)
    for asset_path in [path, f'{exam["id"]}/page.png']:
        response = await client.get(f'/api/assets/{asset_path}', headers=staff)
        assert response.status_code == 200 and response.content == PNG


@pytest.mark.parametrize('filename', ['bad..png', 'nested%2Fquestion.png', 'nested%5Cquestion.png', '%2e%2e%2Fquestion.png', 'question.jpg', 'question.PNG'])
async def test_asset_rejects_traversal_nested_paths_and_non_png_suffixes(client, filename):
    teacher = await login(client, 'teacher')
    exam, _ = await exam_with_image(client, teacher)
    (get_settings().upload_dir / exam['id'] / 'bad..png').write_bytes(PNG)
    response = await client.get(f'/api/assets/{exam["id"]}/{filename}', headers=teacher)
    assert response.status_code == 404, response.text


async def test_asset_requires_an_existing_exam_and_file(client):
    teacher = await login(client, 'teacher')
    exam, path = await exam_with_image(client, teacher)
    assert (await client.get(f'/api/assets/{exam["id"]}/missing.png', headers=teacher)).status_code == 404
    missing = get_settings().upload_dir / 'missing-exam'; missing.mkdir(); (missing / 'question.png').write_bytes(PNG)
    assert (await client.get('/api/assets/missing-exam/question.png', headers=teacher)).status_code == 404
    (get_settings().upload_dir / path).unlink()
    assert (await client.get(f'/api/assets/{path}', headers=teacher)).status_code == 404
