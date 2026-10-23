from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy import String, Text, ForeignKey, UniqueConstraint, CheckConstraint, Index, JSON, DateTime, BigInteger
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def now():
    return datetime.now(timezone.utc)


def uid():
    return str(uuid4())


class Base(DeclarativeBase):
    pass


class Role(Base):
    __tablename__ = 'roles'
    name: Mapped[str] = mapped_column(String(20), primary_key=True)


class User(Base):
    __tablename__ = 'users'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    avatar_url: Mapped[str | None] = mapped_column(Text)
    role: Mapped[str] = mapped_column(ForeignKey('roles.name'), default='student')
    active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AuthSession(Base):
    __tablename__ = 'auth_sessions'
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Exam(Base):
    __tablename__ = 'exams'
    __table_args__ = (CheckConstraint('duration_minutes > 0 AND duration_minutes <= 1440'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    title: Mapped[str] = mapped_column(String(250))
    subject: Mapped[str] = mapped_column(String(100), default='Ona tili va adabiyot')
    description: Mapped[str] = mapped_column(Text, default='')
    duration_minutes: Mapped[int] = mapped_column(default=90)
    status: Mapped[str] = mapped_column(String(20), default='draft', index=True)
    certificate_thresholds: Mapped[dict] = mapped_column(JSON().with_variant(JSONB(), 'postgresql'), default=lambda: {'A+':70,'A':65,'B+':60,'B':55,'C+':50,'C':46})
    essay_required: Mapped[bool] = mapped_column(default=False)
    expert_count: Mapped[int] = mapped_column(default=1)
    answer_released: Mapped[bool] = mapped_column(default=False)
    results_published: Mapped[bool] = mapped_column(default=False)
    created_by: Mapped[str] = mapped_column(ForeignKey('users.id'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Passage(Base):
    __tablename__ = 'passages'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    exam_id: Mapped[str] = mapped_column(ForeignKey('exams.id'), index=True)
    title: Mapped[str] = mapped_column(String(250), default='')
    text: Mapped[str] = mapped_column(Text)


class Question(Base):
    __tablename__ = 'questions'
    __table_args__ = (UniqueConstraint('exam_id', 'position'), CheckConstraint('position > 0'))
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    exam_id: Mapped[str] = mapped_column(ForeignKey('exams.id'), index=True)
    position: Mapped[int]
    kind: Mapped[str] = mapped_column(String(30))
    text: Mapped[str] = mapped_column(Text)
    topic: Mapped[str] = mapped_column(String(100), default='Umumiy')
    passage_id: Mapped[str | None] = mapped_column(ForeignKey('passages.id'))
    image_paths: Mapped[list] = mapped_column(JSON().with_variant(JSONB(), 'postgresql'), default=list)
    config: Mapped[dict] = mapped_column(JSON().with_variant(JSONB(), 'postgresql'), default=dict)


class Option(Base):
    __tablename__ = 'options'
    __table_args__ = (UniqueConstraint('question_id', 'label'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    question_id: Mapped[str] = mapped_column(ForeignKey('questions.id'), index=True)
    label: Mapped[str] = mapped_column(String(30))
    text: Mapped[str] = mapped_column(Text)
    image_path: Mapped[str | None] = mapped_column(Text, nullable=True)


class QuestionPart(Base):
    __tablename__ = 'question_parts'
    __table_args__ = (UniqueConstraint('question_id', 'label'), CheckConstraint('weight > 0'))
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    question_id: Mapped[str] = mapped_column(ForeignKey('questions.id'), index=True)
    label: Mapped[str] = mapped_column(String(30), default='main')
    prompt: Mapped[str] = mapped_column(Text, default='')
    weight: Mapped[float] = mapped_column(default=1.0)


class AnswerKey(Base):
    __tablename__ = 'answer_keys'
    part_id: Mapped[str] = mapped_column(ForeignKey('question_parts.id'), primary_key=True)
    accepted: Mapped[list] = mapped_column(JSON().with_variant(JSONB(), 'postgresql'))
    case_sensitive: Mapped[bool] = mapped_column(default=False)
    manual_review: Mapped[bool] = mapped_column(default=False)


class Attempt(Base):
    __tablename__ = 'attempts'
    __table_args__ = (UniqueConstraint('user_id', 'exam_id'), Index('ix_attempt_status_exam', 'exam_id', 'status'))
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    exam_id: Mapped[str] = mapped_column(ForeignKey('exams.id'))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    deadline: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), default='in_progress')
    essay_text: Mapped[str] = mapped_column(Text, default='')


class Response(Base):
    __tablename__ = 'responses'
    __table_args__ = (UniqueConstraint('attempt_id', 'question_id'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    attempt_id: Mapped[str] = mapped_column(ForeignKey('attempts.id'), index=True)
    question_id: Mapped[str] = mapped_column(ForeignKey('questions.id'))
    answers: Mapped[dict] = mapped_column(JSON().with_variant(JSONB(), 'postgresql'), default=dict)
    marked: Mapped[bool] = mapped_column(default=False)
    revision: Mapped[int] = mapped_column(default=1)
    saved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class RawGrade(Base):
    __tablename__ = 'raw_grades'
    __table_args__ = (UniqueConstraint('attempt_id', 'part_id'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    attempt_id: Mapped[str] = mapped_column(ForeignKey('attempts.id'), index=True)
    part_id: Mapped[str] = mapped_column(ForeignKey('question_parts.id'))
    score: Mapped[float | None]
    maximum: Mapped[float]
    status: Mapped[str] = mapped_column(String(20))


class EssayRubric(Base):
    __tablename__ = 'essay_rubrics'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    source_name: Mapped[str] = mapped_column(Text)
    source_sha256: Mapped[str] = mapped_column(String(64))
    table: Mapped[dict] = mapped_column(JSON().with_variant(JSONB(), 'postgresql'))
    verified_by: Mapped[str] = mapped_column(ForeignKey('users.id'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class EssayAssessment(Base):
    __tablename__ = 'essay_assessments'
    __table_args__ = (UniqueConstraint('attempt_id', 'teacher_id'), CheckConstraint('score >= 0 AND score <= 24 AND score * 2 = CAST(score * 2 AS INTEGER)'))
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    attempt_id: Mapped[str] = mapped_column(ForeignKey('attempts.id'), index=True)
    teacher_id: Mapped[str] = mapped_column(ForeignKey('users.id'))
    score: Mapped[float]
    converted_score: Mapped[float]
    rubric_id: Mapped[str] = mapped_column(ForeignKey('essay_rubrics.id'))
    comment: Mapped[str] = mapped_column(Text, default='')
    graded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class CalibrationRun(Base):
    __tablename__ = 'calibration_runs'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    exam_id: Mapped[str] = mapped_column(ForeignKey('exams.id'), index=True)
    model: Mapped[str] = mapped_column(String(30), default='rasch_mml_v1')
    diagnostics: Mapped[dict] = mapped_column(JSON().with_variant(JSONB(), 'postgresql'))
    approved: Mapped[bool] = mapped_column(default=False)
    reference_name: Mapped[str | None] = mapped_column(Text)
    reference_mean: Mapped[float | None]
    reference_sd: Mapped[float | None]
    validation_note: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[str] = mapped_column(ForeignKey('users.id'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ItemParameter(Base):
    __tablename__ = 'item_parameters'
    __table_args__ = (UniqueConstraint('calibration_id', 'part_id'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    calibration_id: Mapped[str] = mapped_column(ForeignKey('calibration_runs.id'), index=True)
    part_id: Mapped[str] = mapped_column(ForeignKey('question_parts.id'))
    difficulty: Mapped[float]
    standard_error: Mapped[float]


class AbilityEstimate(Base):
    __tablename__ = 'ability_estimates'
    __table_args__ = (UniqueConstraint('calibration_id', 'attempt_id'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    calibration_id: Mapped[str] = mapped_column(ForeignKey('calibration_runs.id'))
    attempt_id: Mapped[str] = mapped_column(ForeignKey('attempts.id'))
    theta: Mapped[float]
    standard_error: Mapped[float]


class StandardizedResult(Base):
    __tablename__ = 'standardized_results'
    __table_args__ = (UniqueConstraint('attempt_id', 'calibration_id'),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    attempt_id: Mapped[str] = mapped_column(ForeignKey('attempts.id'))
    calibration_id: Mapped[str] = mapped_column(ForeignKey('calibration_runs.id'))
    z: Mapped[float]
    t: Mapped[float]
    version: Mapped[str] = mapped_column(String(30), default='mock-t-v1')


class AuditLog(Base):
    __tablename__ = 'audit_logs'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    actor_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    action: Mapped[str] = mapped_column(String(100))
    entity_id: Mapped[str] = mapped_column(String(100), index=True)
    before: Mapped[dict | None] = mapped_column(JSON().with_variant(JSONB(), 'postgresql'))
    after: Mapped[dict | None] = mapped_column(JSON().with_variant(JSONB(), 'postgresql'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ImportDocument(Base):
    __tablename__ = 'import_documents'
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    exam_id: Mapped[str] = mapped_column(ForeignKey('exams.id'), index=True)
    source_name: Mapped[str] = mapped_column(Text)
    source_sha256: Mapped[str] = mapped_column(String(64))
    extracted: Mapped[dict] = mapped_column(JSON().with_variant(JSONB(), 'postgresql'))
    created_by: Mapped[str] = mapped_column(ForeignKey('users.id'))
