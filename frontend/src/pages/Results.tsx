import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  CheckCheck,
  Clock3,
  Target,
  Trophy,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../services/api";
import type { Attempt, Result } from "../types";
import {
  Empty,
  ErrorBox,
  Loading,
  PageTitle,
  Pill,
  SectionTitle,
  date,
  fmt,
  ProtectedImage,
} from "../components/ui";
export default function Results() {
  const q = useQuery({
    queryKey: ["attempts"],
    queryFn: () => api<Attempt[]>("/attempts"),
  });
  const done = q.data?.filter((a) => a.status === "submitted") || [];
  return (
    <>
      <PageTitle
        eyebrow="O‘SISHINGIZNI KUZATING"
        title="Mening natijalarim"
        description="Har bir natija — keyingi yutuq uchun yo‘l xaritasi."
      />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : done.length ? (
        <div className="results-grid">
          {done.map((a) => (
            <Link
              className="panel result-card"
              key={a.id}
              to={`/results/${a.id}`}
            >
              <div className="result-card-head">
                <span className="subject-icon">
                  <BookOpen size={24} />
                </span>
                <Pill>Yakunlangan</Pill>
              </div>
              <h2>{a.exam_title}</h2>
              <span className="muted small">{date(a.submitted_at)}</span>
              <div className="result-card-score">
                <strong>
                  {fmt(a.raw_percentage)}
                  <small>%</small>
                </strong>
                <span>Xom natija</span>
              </div>
              <div className="progress-track">
                <div style={{ width: `${a.raw_percentage || 0}%` }} />
              </div>
              <span className="text-link">
                Batafsil tahlil
                <ArrowRight size={17} />
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="panel">
          <Empty
            title="Birinchi natijangizni kashf eting"
            description="Imtihonni yakunlaganingizdan so‘ng tahlil va natijalar shu yerda ko‘rinadi."
          >
            <Link className="button primary" to="/exams">
              Sinovlarni ko‘rish
              <ArrowRight size={17} />
            </Link>
          </Empty>
        </div>
      )}
    </>
  );
}
export function ResultDetail() {
  const { id } = useParams();
  const q = useQuery({
    queryKey: ["result", id],
    queryFn: () => api<Result>(`/attempts/${id}/result`),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const r = q.data!;
  const slices = [
    { name: "To‘g‘ri", value: r.correct, color: "#10a78c" },
    { name: "Noto‘g‘ri", value: r.incorrect, color: "#e78079" },
    { name: "Javobsiz", value: r.unanswered, color: "#dfe7ed" },
    { name: "Tekshirilmoqda", value: r.pending_parts, color: "#e8b963" },
  ].filter((s) => s.value > 0);
  return (
    <>
      <PageTitle
        eyebrow="NATIJALAR TAHLILI"
        title={r.exam_title}
        description={`${date(r.submitted_at)} · ${r.label}`}
        action={
          <Link className="button secondary" to="/results">
            Barcha natijalar
          </Link>
        }
      />
      <div className="result-overview">
        <div className="panel score-summary">
          <div className="donut-wrap">
            <ResponsiveContainer width="100%" height={210}>
              <PieChart>
                <Pie
                  isAnimationActive={false}
                  data={slices}
                  dataKey="value"
                  innerRadius={73}
                  outerRadius={91}
                  paddingAngle={3}
                  stroke="none"
                >
                  {slices.map((s) => (
                    <Cell key={s.name} fill={s.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-label">
              <strong>
                {fmt(r.raw_percentage)}
                <small>%</small>
              </strong>
              <span>Xom natija</span>
            </div>
          </div>
          <h2>
            {fmt(r.raw_score)}{" "}
            <span className="muted">/ {fmt(r.maximum)} ball</span>
          </h2>
          {r.pending_parts > 0 && (
            <Pill tone="amber">{r.pending_parts} qism tekshirilmoqda</Pill>
          )}
          <div className="score-legend">
            {slices.map((s) => (
              <span key={s.name}>
                <i style={{ background: s.color }} />
                {s.name}
                <strong>{s.value}</strong>
              </span>
            ))}
          </div>
        </div>
        <div className="result-score-grid">
          {[
            {
              label: "Rasch qobiliyati (θ)",
              value: fmt(r.theta, 3),
              icon: Target,
            },
            { label: "Standart Z-ball", value: fmt(r.z, 3), icon: CheckCheck },
            { label: "Test T-balli", value: fmt(r.t, 2), icon: Trophy },
            {
              label: "Yozma ish",
              value: r.essay_required
                ? r.essay_ready
                  ? `${fmt(r.essay_score)} / 24`
                  : "Baholanmoqda"
                : "Talab etilmaydi",
              icon: BookOpen,
            },
            {
              label: "Esse (75 ball)",
              value: fmt(r.converted_essay_score, 2),
              icon: CheckCheck,
            },
            {
              label: "Yakuniy natija",
              value:
                r.final_score === null
                  ? "Kutilmoqda"
                  : `${fmt(r.final_score, 2)} · ${r.grade}`,
              icon: Trophy,
            },
          ].map(({ label, value, icon: Icon }) => (
            <div className="panel result-score" key={label}>
              <Icon size={20} />
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </div>
      {r.t === null && (
        <div className="info-note">
          <Clock3 size={21} />
          <p>
            T-ball uchun tasdiqlangan kalibrlash, aniq referens populyatsiya va
            natijalar e’loni talab qilinadi. Hozircha xom natijangizdan
            foydalaning.
          </p>
        </div>
      )}
      {r.essay_required && !r.essay_ready && (
        <div className="info-note">
          <BookOpen size={21} />
          <p>
            Yozma ish ekspertlar tomonidan baholanmoqda: {r.assessed_experts} /{" "}
            {r.expert_count}. Rasmiy konvertatsiya jadvali va barcha ekspert
            baholari tayyor bo‘lgach yakuniy natija hisoblanadi.
          </p>
        </div>
      )}
      {r.reference && (
        <div className="info-note">
          <Target size={21} />
          <p>
            Referens: {r.reference.name} · μ = {r.reference.mean}, σ ={" "}
            {r.reference.sd}. Versiya: {r.scoring_version}. Kalibrlash:{" "}
            {r.calibration_id}. θ standart xatosi: {fmt(r.theta_se, 3)}.
          </p>
        </div>
      )}
      <SectionTitle title="Mavzular bo‘yicha natija" />
      <div className="panel chart-panel">
        <ResponsiveContainer
          width="100%"
          height={Math.max(230, r.topics.length * 45)}
        >
          <BarChart
            layout="vertical"
            data={r.topics.map((t) => ({
              ...t,
              foiz: t.maximum ? (t.score / t.maximum) * 100 : 0,
            }))}
            margin={{ left: 15, right: 25 }}
          >
            <CartesianGrid
              strokeDasharray="4 6"
              horizontal={false}
              stroke="var(--line)"
            />
            <XAxis
              type="number"
              domain={[0, 100]}
              unit="%"
              tick={{ fill: "var(--muted)", fontSize: 12 }}
            />
            <YAxis
              type="category"
              dataKey="topic"
              width={130}
              tick={{ fill: "var(--muted)", fontSize: 12 }}
            />
            <Tooltip />
            <Bar
              isAnimationActive={false}
              dataKey="foiz"
              name="Natija %"
              fill="#10a78c"
              radius={[0, 5, 5, 0]}
              barSize={18}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <SectionTitle title="Javoblar tahlili" />
      <p className="muted small">
        Ballar savolning alohida baholanadigan qismlari bo‘yicha hisoblanadi.{" "}
        {r.answer_released
          ? "Javob kaliti e’lon qilingan."
          : "Javob kaliti o‘qituvchi ruxsatidan so‘ng ochiladi."}
      </p>
      <div className="review-list">
        {r.review.map((question) => (
          <details className="panel review-item" key={question.id}>
            <summary>
              <span className="review-number">{question.position}</span>
              <span>
                {question.text.slice(0, 110)}
                {question.text.length > 110 ? "…" : ""}
              </span>
              <Pill
                tone={
                  question.grades.some((g) => g.status === "pending")
                    ? "amber"
                    : question.grades.every((g) => g.status === "correct")
                      ? "green"
                      : "gray"
                }
              >
                {fmt(question.grades.reduce((s, g) => s + (g.score || 0), 0))}{" "}
                ball
              </Pill>
            </summary>
            <div className="review-content">
              <p className="preserve">{question.text}</p>
              {question.image_paths.map((path) => (
                <ProtectedImage key={path} path={path} alt="Savol rasmi" />
              ))}
              {question.options.length > 0 && <div className="review-options">{question.options.map(option => <div key={option.label}><strong>{option.label}.</strong> {option.text}{option.image_path && <ProtectedImage path={option.image_path} alt={`${option.label} variant rasmi`} />}</div>)}</div>}
              {question.parts.map((part) => (
                <div key={part.id} className="review-part">
                  <strong>
                    {part.label === "main" ? "Javob" : `${part.label} qism`}
                  </strong>
                  <p>
                    Sizning javobingiz:{" "}
                    {question.answers[part.label] || "Javob berilmagan"}
                  </p>
                  {part.accepted && (
                    <p className="text-accent">
                      Qabul qilinadigan javob: {part.accepted.join(" / ")}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </>
  );
}
