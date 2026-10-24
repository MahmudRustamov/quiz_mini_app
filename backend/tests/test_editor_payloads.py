"""The payloads the teacher form editors build must survive the real API.

Frontend unit tests assert the editors produce these shapes; these tests assert
the backend accepts them, publishes them and grades them. Together they close
the contract the JSON editor used to leave to the teacher.
"""
import pytest
from conftest import login, start

# One QuestionPart per left-hand item, right-hand items as Options, key = option label.
MATCHING = {'position': 1, 'kind': 'matching', 'text': 'Juftlarni moslang', 'topic': 'Leksika',
            'options': [{'label': 'R1', 'text': 'suv'}, {'label': 'R2', 'text': 'olov'}],
            'parts': [{'label': 'p1', 'prompt': 'dengiz', 'weight': 1, 'accepted': ['R1']},
                      {'label': 'p2', 'prompt': 'quyosh', 'weight': 1, 'accepted': ['R2']}]}
SINGLE = {'position': 2, 'kind': 'single', 'text': 'Qaysi turkum?', 'topic': 'Morfologiya',
          'options': [{'label': l, 'text': t} for l, t in zip('ABCD', ['Ot', 'Sifat', 'Fe’l', 'Ravish'])],
          'parts': [{'label': 'main', 'prompt': '', 'weight': 1, 'accepted': ['A']}]}
SHORT = {'position': 3, 'kind': 'short', 'text': 'So‘zni yozing', 'topic': 'Imlo',
         'parts': [{'label': 'main', 'prompt': '', 'weight': 1, 'accepted': ['o‘quvchi', 'oquvchi']}]}
TWO_PART = {'position': 4, 'kind': 'two_part', 'text': 'Ikki qismga javob bering', 'topic': 'Sintaksis',
            'parts': [{'label': 'A', 'prompt': 'Ega nima?', 'weight': 2, 'accepted': ['ega']},
                      {'label': 'B', 'prompt': 'Kesim nima?', 'weight': 3, 'accepted': ['kesim'], 'manual_review': True}]}


@pytest.mark.parametrize('reordered', [False, True])
async def test_form_editor_payloads_publish_and_grade(client, reordered):
    teacher = await login(client, 'teacher')
    student = await login(client)
    exam = (await client.post('/api/teacher/exams', headers=teacher,
                              json={'title': 'Muharrir sinovi', 'duration_minutes': 60})).json()
    created = []
    for payload in [MATCHING, SINGLE, SHORT, TWO_PART]:
        response = await client.post(f'/api/teacher/exams/{exam["id"]}/questions', headers=teacher, json=payload)
        assert response.status_code == 200, f'{payload["kind"]}: {response.text}'
        created.append(response.json()['id'])
    if reordered:
        created.reverse()
        response = await client.put(f'/api/teacher/exams/{exam["id"]}/questions/order', headers=teacher,
                                    json={'question_ids': created})
        assert response.status_code == 200, response.text
    published = await client.post(f'/api/teacher/exams/{exam["id"]}/publish', headers=teacher, json={'verified': True})
    assert published.status_code == 200, published.text

    attempt = await start(client, student, exam)
    assert [q['id'] for q in attempt['exam']['questions']] == created
    assert [q['position'] for q in attempt['exam']['questions']] == [1, 2, 3, 4]
    assert 'accepted' not in str(attempt)
    questions = {q['kind']: q for q in attempt['exam']['questions']}
    # Matching reaches the student as one scoring part per pair plus the options, whose
    # order is shuffled per attempt — assert membership, never a fixed sequence.
    matching = questions['matching']
    assert sorted(o['label'] for o in matching['options']) == ['R1', 'R2']
    assert sorted(p['label'] for p in matching['parts']) == ['p1', 'p2']

    # B is answered off-key so the manual_review branch is exercised, not the exact match.
    answers = {'matching': {'p1': 'R1', 'p2': 'R2'}, 'single': {'main': 'A'},
               'short': {'main': 'O‘QUVCHI'}, 'two_part': {'A': 'ega', 'B': 'gapning kesimi'}}
    for kind, given in answers.items():
        saved = await client.put(f'/api/attempts/{attempt["id"]}/responses/{questions[kind]["id"]}',
                                 headers=student, json={'answers': given, 'revision': 0})
        assert saved.status_code == 200, saved.text
    assert (await client.post(f'/api/attempts/{attempt["id"]}/submit', headers=student)).status_code == 200

    result = (await client.get(f'/api/attempts/{attempt["id"]}/result', headers=student)).json()
    # p1 + p2 + single + short + A(2) = 6 auto-scored; B(3) awaits a teacher because it missed the key.
    assert result['raw_score'] == 6 and result['maximum'] == 9
    assert result['pending_parts'] == 1
    assert {t['topic'] for t in result['topics']} == {'Leksika', 'Morfologiya', 'Imlo', 'Sintaksis'}


async def test_matching_key_must_reference_an_existing_option(client):
    teacher = await login(client, 'teacher')
    exam = (await client.post('/api/teacher/exams', headers=teacher,
                              json={'title': 'Kalit tekshiruvi', 'duration_minutes': 60})).json()
    broken = {**MATCHING, 'parts': [{**MATCHING['parts'][0], 'accepted': ['R9']}, MATCHING['parts'][1]]}
    assert (await client.post(f'/api/teacher/exams/{exam["id"]}/questions', headers=teacher, json=broken)).status_code == 200
    rejected = await client.post(f'/api/teacher/exams/{exam["id"]}/publish', headers=teacher, json={'verified': True})
    assert rejected.status_code == 422 and 'variantlarga mos emas' in rejected.text
