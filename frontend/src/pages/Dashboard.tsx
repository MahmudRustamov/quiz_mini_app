import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  ChartNoAxesCombined,
  CheckCheck,
  Clock3,
  GraduationCap,
  Sparkles,
  Target,
  Trophy,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAuth } from "../hooks/auth";
import { api } from "../services/api";
import type { Attempt, Exam } from "../types";
import {
  Empty,
  ErrorBox,
  Loading,
  PageTitle,
  SectionTitle,
  date,
  fmt,
} from "../components/ui";
import { ExamCard } from "../features/exams";
export default function Dashboard() {
  const { user } = useAuth();
  const exams = useQuery({
      queryKey: ["exams"],
      queryFn: () => api<Exam[]>("/exams"),
    }),
    attempts = useQuery({
      queryKey: ["attempts"],
      queryFn: () => api<Attempt[]>("/attempts"),
    });
  if (exams.isLoading || attempts.isLoading) return <Loading />;
  if (exams.error || attempts.error)
    return <ErrorBox error={exams.error || attempts.error} />;
  const all = attempts.data || [],
    completed = all.filter((a) => a.status === "submitted"),
    active = all.filter((a) => a.status === "in_progress");
  const average = completed.length
    ? completed.reduce((s, a) => s + (a.raw_percentage || 0), 0) /
      completed.length
    : null;
  const chart = [...completed]
    .reverse()
    .slice(-8)
    .map((a, i) => ({ name: `${i + 1}-sinov`, foiz: a.raw_percentage }));
  return (
    <>
      <PageTitle
        eyebrow="BUGUN HAM BIR QADAM OLDINGA"
        title={`Salom, ${user?.name.split(" ")[0]}!`}
        description="Maqsadingiz sari navbatdagi qadamni tashlashga tayyormisiz?"
        action={
          <span className="today-date">{date(new Date().toISOString())}</span>
        }
      />
      <section className="hero">
        <div className="hero-content">
          <span className="hero-kicker">
            <span className="live-dot" /> BILIM — ENG KATTA IMKONIYAT
          </span>
          <h2>
            Katta natijalar
            <br />
            <span>kichik qadamlardan.</span>
          </h2>
          <p>
            Haqiqiy imtihon muhitida o‘zingizni sinang.
            <br />
            Har bir sinov bilan maqsadingizga yaqinlashing.
          </p>
          <Link to="/exams" className="button hero-button">
            Sinovni tanlash
            <ArrowRight size={18} />
          </Link>
          <div className="hero-footnote">
            <ShieldIcon />
            Milliy Sertifikat formatidagi sinovlar
          </div>
        </div>
        <div className="hero-illustration" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="floating-spark">
            <Sparkles size={23} />
          </div>
          <div className="certificate">
            <div className="certificate-top">
              <GraduationCap size={30} />
              <span>
                MILLIY
                <br />
                SERTIFIKAT
              </span>
            </div>
            <div className="cert-line long" />
            <div className="cert-line" />
            <div className="cert-line medium" />
            <div className="cert-bottom">
              <div className="cert-seal">
                <Trophy size={25} />
              </div>
              <div>
                <div className="cert-line" />
                <div className="cert-line medium" />
              </div>
            </div>
          </div>
          <div className="floating-check">
            <CheckCheck size={22} />
            <span>
              O‘z kuchingizga
              <br />
              <strong>ishoning!</strong>
            </span>
          </div>
        </div>
      </section>
      <div className="stats-grid">
        {[
          {
            label: "Mavjud sinovlar",
            value: exams.data?.length || 0,
            sub: "Yangi imkoniyatlar",
            icon: BookOpen,
            tone: "teal",
          },
          {
            label: "Yakunlangan",
            value: completed.length,
            sub: "Topshirilgan imtihonlar",
            icon: CheckCheck,
            tone: "blue",
          },
          {
            label: "O‘rtacha natija",
            value: average === null ? "—" : `${fmt(average)}%`,
            sub: "Xom ball bo‘yicha",
            icon: ChartNoAxesCombined,
            tone: "violet",
          },
          {
            label: "Jarayonda",
            value: active.length,
            sub: "Davom ettirish mumkin",
            icon: Clock3,
            tone: "orange",
          },
        ].map(({ label, value, sub, icon: Icon, tone }) => (
          <div className="stat-card" key={label}>
            <div className={`stat-icon ${tone}`}>
              <Icon size={21} />
            </div>
            <span className="stat-label">{label}</span>
            <strong>{value}</strong>
            <small>{sub}</small>
          </div>
        ))}
      </div>
      <div className="dashboard-columns">
        <div>
          <SectionTitle title="Siz uchun sinovlar">
            <Link to="/exams" className="text-link">
              Barchasi
              <ArrowRight size={16} />
            </Link>
          </SectionTitle>
          {exams.data?.length ? (
            <div className="exam-grid compact">
              {exams.data.slice(0, 2).map((e) => (
                <ExamCard
                  key={e.id}
                  exam={e}
                  attempt={all.find((a) => a.exam_id === e.id)}
                />
              ))}
            </div>
          ) : (
            <div className="panel">
              <Empty
                title="Yangi sinovlar shu yerda paydo bo‘ladi"
                description="O‘qituvchi imtihonni e’lon qilgach, uni boshlashingiz mumkin."
              />
            </div>
          )}
          <SectionTitle title="Natijalar dinamikasi">
            <span className="muted small">Oxirgi 8 ta sinov</span>
          </SectionTitle>
          <div className="panel chart-panel">
            {chart.length ? (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={chart}>
                  <defs>
                    <linearGradient
                      id="performance"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="#0caa8d"
                        stopOpacity={0.22}
                      />
                      <stop offset="100%" stopColor="#0caa8d" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="4 6"
                    vertical={false}
                    stroke="var(--line)"
                  />
                  <XAxis
                    dataKey="name"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "var(--muted)", fontSize: 11 }}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tickLine={false}
                    axisLine={false}
                    unit="%"
                    tick={{ fill: "var(--muted)", fontSize: 11 }}
                  />
                  <Tooltip />
                  <Area
                    isAnimationActive={false}
                    type="monotone"
                    dataKey="foiz"
                    name="Natija %"
                    stroke="#0caa8d"
                    strokeWidth={3}
                    fill="url(#performance)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <Empty
                title="Rivojlanishingizni kuzating"
                description="Birinchi sinovni yakunlaganingizdan so‘ng natijalar grafigi shakllanadi."
              />
            )}
          </div>
        </div>
        <aside className="dashboard-side">
          <SectionTitle title="Tayyorgarlik yo‘li" />
          <div className="panel steps-panel">
            {[
              {
                n: "01",
                title: "Sinovni tanlang",
                text: "Fan va imtihon formatini ko‘rib chiqing.",
              },
              {
                n: "02",
                title: "Bilimingizni sinang",
                text: "Vaqtni nazorat qilib, savollarga javob bering.",
              },
              {
                n: "03",
                title: "Natijani tahlil qiling",
                text: "Kuchli tomonlaringiz va mavzularni aniqlang.",
              },
            ].map((s) => (
              <div className="study-step" key={s.n}>
                <span>{s.n}</span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="tip-card">
            <span className="tip-icon">
              <Target size={22} />
            </span>
            <span className="eyebrow">KUN TAVSIYASI</span>
            <h3>
              Muntazamlik —<br />
              muvaffaqiyat kaliti.
            </h3>
            <p>
              Har bir sinovdan keyin xatolaringizni tahlil qilish uchun vaqt
              ajrating.
            </p>
            <Link to="/results">
              Natijalarim
              <ArrowUpRight size={17} />
            </Link>
          </div>
        </aside>
      </div>
      <SectionTitle title="So‘nggi urinishlar">
        <Link to="/results" className="text-link">
          Tarixni ko‘rish
          <ArrowRight size={16} />
        </Link>
      </SectionTitle>
      <div className="panel">
        {all.length ? (
          <div className="attempt-list">
            {all.slice(0, 4).map((a) => (
              <Link
                className="attempt-row"
                key={a.id}
                to={
                  a.status === "submitted"
                    ? `/results/${a.id}`
                    : `/exam/${a.id}`
                }
              >
                <span className="subject-icon small-icon">
                  <BookOpen size={20} />
                </span>
                <div>
                  <strong>{a.exam_title}</strong>
                  <small>{date(a.started_at)}</small>
                </div>
                <span
                  className={`status-text ${a.status === "submitted" ? "text-accent" : ""}`}
                >
                  {a.status === "submitted"
                    ? `${fmt(a.raw_percentage)}%`
                    : "Jarayonda"}
                </span>
                <ArrowRight size={18} />
              </Link>
            ))}
          </div>
        ) : (
          <Empty
            title="Sizning hikoyangiz shu yerdan boshlanadi"
            description="Ilk sinovingizni topshiring va natijangizni kuzatib boring."
          />
        )}
      </div>
    </>
  );
}
function ShieldIcon() {
  return (
    <span className="hero-small-icon">
      <CheckCheck size={14} />
    </span>
  );
}
