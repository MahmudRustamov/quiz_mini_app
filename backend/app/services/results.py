from sqlalchemy import select, func
from app.models import (Exam, Question, QuestionPart, RawGrade, EssayAssessment, CalibrationRun,
                        StandardizedResult, AbilityEstimate, ItemParameter, Response)
from app.repositories.exams import question_data
from app.psychometrics.rasch import estimate_ability
from app.services.grading import certificate_grade, standardize


async def apply_calibration(db, attempt, run):
    existing = await db.scalar(select(StandardizedResult).where(StandardizedResult.attempt_id == attempt.id,
                                                               StandardizedResult.calibration_id == run.id))
    if existing:
        return existing
    if not run.approved or attempt.status != 'submitted':
        return None
    params = (await db.scalars(select(ItemParameter).where(ItemParameter.calibration_id == run.id).order_by(ItemParameter.part_id))).all()
    grades = {g.part_id: g for g in (await db.scalars(select(RawGrade).where(RawGrade.attempt_id == attempt.id))).all()}
    if not params or any(p.part_id not in grades or grades[p.part_id].score is None for p in params):
        return None
    x = [grades[p.part_id].score / grades[p.part_id].maximum for p in params]
    if any(v not in (0, 1) for v in x):
        return None
    theta, se = estimate_ability(x, [p.difficulty for p in params], run.diagnostics['latent_mean'])
    z, t = standardize(theta, run.reference_mean, run.reference_sd)
    db.add(AbilityEstimate(attempt_id=attempt.id, calibration_id=run.id, theta=theta, standard_error=se))
    record = StandardizedResult(attempt_id=attempt.id, calibration_id=run.id, z=z, t=t)
    db.add(record)
    await db.flush()
    return record


async def result_data(db, attempt, include_teacher=False):
    exam = await db.get(Exam, attempt.exam_id)
    grades = (await db.scalars(select(RawGrade).where(RawGrade.attempt_id == attempt.id))).all()
    raw_score = sum(g.score or 0 for g in grades)
    maximum = sum(g.maximum for g in grades)
    pending = sum(g.status == 'pending' for g in grades)
    assessments = (await db.scalars(select(EssayAssessment).where(EssayAssessment.attempt_id == attempt.id))).all()
    essay_ready = not exam.essay_required or len(assessments) >= exam.expert_count
    essay_converted = sum(a.converted_score for a in assessments) / len(assessments) if assessments else None
    run = await db.scalar(select(CalibrationRun).where(CalibrationRun.exam_id == exam.id, CalibrationRun.approved.is_(True))
                          .order_by(CalibrationRun.created_at.desc()))
    standardized = None
    ability = None
    if run:
        standardized = await db.scalar(select(StandardizedResult).where(StandardizedResult.attempt_id == attempt.id,
                                                                         StandardizedResult.calibration_id == run.id))
        ability = await db.scalar(select(AbilityEstimate).where(AbilityEstimate.attempt_id == attempt.id,
                                                               AbilityEstimate.calibration_id == run.id))
    visible = exam.results_published or include_teacher
    t = standardized.t if standardized and visible else None
    final = ((t + essay_converted) / 2 if exam.essay_required else t) if t is not None and essay_ready and not pending else None
    topics = {}
    review = []
    responses = {r.question_id: r for r in (await db.scalars(select(Response).where(Response.attempt_id == attempt.id))).all()}
    questions = (await db.scalars(select(Question).where(Question.exam_id == exam.id).order_by(Question.position))).all()
    by_part = {g.part_id: g for g in grades}
    for q in questions:
        # Review shows the same arrangement the student answered in.
        data = await question_data(db, q, include_teacher or exam.answer_released, attempt.id)
        qgrades = [by_part[p['id']] for p in data['parts'] if p['id'] in by_part]
        topic = topics.setdefault(q.topic, {'topic': q.topic, 'score': 0, 'maximum': 0})
        topic['score'] += sum(g.score or 0 for g in qgrades)
        topic['maximum'] += sum(g.maximum for g in qgrades)
        response = responses.get(q.id)
        data['answers'] = response.answers if response else {}
        data['grades'] = [{'part_id': g.part_id, 'score': g.score, 'maximum': g.maximum, 'status': g.status} for g in qgrades]
        review.append(data)
    return {'attempt_id': attempt.id, 'exam_id': exam.id, 'exam_title': exam.title,
            'status': attempt.status, 'submitted_at': attempt.submitted_at,
            'correct': sum(g.status == 'correct' for g in grades),
            'incorrect': sum(g.status == 'incorrect' for g in grades),
            'unanswered': sum(g.status == 'unanswered' for g in grades), 'pending_parts': pending,
            'raw_score': raw_score, 'maximum': maximum, 'raw_percentage': 100 * raw_score / maximum if maximum else 0,
            'essay_required': exam.essay_required, 'essay_ready': essay_ready,
            'expert_count': exam.expert_count, 'assessed_experts': len(assessments),
            'essay_score': sum(a.score for a in assessments) / len(assessments) if assessments and visible else None,
            'converted_essay_score': essay_converted if visible else None,
            'theta': ability.theta if ability and visible else None,
            'theta_se': ability.standard_error if ability and visible else None,
            'z': standardized.z if standardized and visible else None, 't': t,
            'final_score': final, 'grade': certificate_grade(final, exam.certificate_thresholds) if final is not None else None,
            'calibration_id': run.id if run and visible else None,
            'reference': {'name': run.reference_name, 'mean': run.reference_mean, 'sd': run.reference_sd} if run and visible else None,
            'scoring_version': standardized.version if standardized and visible else None,
            'results_published': exam.results_published, 'answer_released': exam.answer_released,
            'label': 'Norasmiy sinov natijasi', 'topics': list(topics.values()), 'review': review}
