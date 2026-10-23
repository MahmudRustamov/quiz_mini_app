import math
from typing import Literal
from pydantic import BaseModel, Field, model_validator


class TelegramLogin(BaseModel):
    init_data: str = Field(min_length=1, max_length=15000)


class DevLogin(BaseModel):
    account: Literal['student', 'teacher', 'admin'] = 'student'


class ExamInput(BaseModel):
    title: str = Field(min_length=3, max_length=250)
    subject: str = Field(default='Ona tili va adabiyot', max_length=100)
    description: str = Field(default='', max_length=10000)
    duration_minutes: int = Field(default=90, ge=1, le=1440)
    certificate_thresholds: dict[str, float] = Field(default_factory=lambda: {'A+':70,'A':65,'B+':60,'B':55,'C+':50,'C':46})
    essay_required: bool = False

    @model_validator(mode='after')
    def thresholds_valid(self):
        order = ['A+', 'A', 'B+', 'B', 'C+', 'C']
        if set(self.certificate_thresholds) != set(order):
            raise ValueError('Six certificate thresholds are required')
        values = [self.certificate_thresholds[k] for k in order]
        if not all(math.isfinite(v) for v in values) or any(a <= b for a,b in zip(values, values[1:])):
            raise ValueError('Thresholds must be finite and strictly descending')
        return self
    expert_count: int = Field(default=1, ge=1, le=10)


class PartInput(BaseModel):
    label: str = Field(default='main', min_length=1, max_length=30)
    prompt: str = Field(default='', max_length=10000)
    weight: float = Field(default=1, gt=0, le=100, allow_inf_nan=False)
    accepted: list[str] = Field(default_factory=list, max_length=100)
    case_sensitive: bool = False
    manual_review: bool = False


class OptionInput(BaseModel):
    label: str = Field(min_length=1, max_length=30)
    text: str = Field(default='', max_length=10000)
    image_path: str | None = None

    @model_validator(mode='after')
    def content_required(self):
        if not self.text.strip() and not self.image_path:
            raise ValueError('Variant matni yoki rasmi bo‘lishi kerak')
        return self


class QuestionInput(BaseModel):
    position: int = Field(ge=1, le=500)
    kind: Literal['single', 'matching', 'short', 'two_part', 'reading', 'image']
    text: str = Field(min_length=1, max_length=50000)
    topic: str = Field(default='Umumiy', max_length=100)
    passage_id: str | None = None
    image_paths: list[str] = Field(default_factory=list, max_length=20)
    options: list[OptionInput] = Field(default_factory=list, max_length=50)
    parts: list[PartInput] = Field(default_factory=lambda: [PartInput()], min_length=1, max_length=50)

    @model_validator(mode='after')
    def unique_labels(self):
        if len({p.label for p in self.parts}) != len(self.parts):
            raise ValueError('Part labels must be unique')
        if len({o.label for o in self.options}) != len(self.options):
            raise ValueError('Option labels must be unique')
        if self.kind == 'two_part' and {p.label for p in self.parts} != {'A', 'B'}:
            raise ValueError('Two-part questions require A and B')
        if self.kind in {'single', 'reading', 'image'} and self.options and len(self.parts) != 1:
            raise ValueError('Choice questions require one scoring part')
        return self


class QuestionOrderInput(BaseModel):
    question_ids: list[str] = Field(max_length=500)


class SaveResponse(BaseModel):
    answers: dict[str, str] = Field(default_factory=dict, max_length=50)
    marked: bool = False
    revision: int = Field(ge=0)

    @model_validator(mode='after')
    def lengths(self):
        if any(len(k) > 30 or len(v) > 10000 for k, v in self.answers.items()):
            raise ValueError('Answer too long')
        return self


class EssaySave(BaseModel):
    text: str = Field(max_length=50000)


class EssayGradeInput(BaseModel):
    score: float = Field(ge=0, le=24, multiple_of=0.5, allow_inf_nan=False)
    rubric_id: str
    comment: str = Field(default='', max_length=10000)


class ReviewInput(BaseModel):
    score: float = Field(ge=0, allow_inf_nan=False)
    reason: str = Field(min_length=3, max_length=2000)


class CalibrationApproval(BaseModel):
    reference_name: str = Field(min_length=5)
    reference_mean: float = Field(allow_inf_nan=False)
    reference_sd: float = Field(gt=0, allow_inf_nan=False)
    validation_note: str = Field(min_length=30)


class RoleChange(BaseModel):
    role: Literal['student', 'teacher', 'admin']
    active: bool = True

# Student-facing response schemas enforce an additional answer-key allowlist.
from datetime import datetime


class SessionOutput(BaseModel):
    access_token: str
    token_type: str
    expires_at: datetime


class UserOutput(BaseModel):
    id: str
    name: str
    avatar_url: str | None
    role: Literal['student','teacher','admin']
    telegram_id: int
    active: bool


class ExamOutput(BaseModel):
    id: str
    title: str
    subject: str
    description: str
    duration_minutes: int
    question_count: int
    status: str
    certificate_thresholds: dict[str,float]
    essay_required: bool
    expert_count: int
    answer_released: bool
    results_published: bool


class StudentPartOutput(BaseModel):
    id: str
    label: str
    prompt: str
    weight: float


class StudentQuestionOutput(BaseModel):
    id: str
    position: int
    kind: str
    text: str
    topic: str
    passage_id: str | None
    image_paths: list[str]
    options: list[OptionInput]
    parts: list[StudentPartOutput]


class PassageOutput(BaseModel):
    id: str
    title: str
    text: str


class StudentExamOutput(ExamOutput):
    questions: list[StudentQuestionOutput]
    passages: list[PassageOutput]


class ResponseOutput(BaseModel):
    question_id: str
    answers: dict[str,str]
    marked: bool
    revision: int
    saved_at: datetime


class AttemptOutput(BaseModel):
    id: str
    exam_id: str
    status: str
    started_at: datetime
    deadline: datetime
    server_now: datetime
    submitted_at: datetime | None
    responses: list[ResponseOutput]
    essay_text: str
    exam: StudentExamOutput | None = None
    exam_title: str | None = None
    raw_percentage: float | None = None
    raw_score: float | None = None
    grade: str | None = None
