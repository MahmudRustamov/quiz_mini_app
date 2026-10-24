import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCheck,
  Download,
  FileUp,
  Plus,
  Settings2,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { api, post, put, download } from "../services/api";
import { useAuth } from "../hooks/auth";
import type {
  Exam,
  TeacherAttempt,
  Rubric,
  Calibration,
  ImportDoc,
  Result,
  Attempt,
  User,
} from "../types";
import {
  Empty,
  ErrorBox,
  Loading,
  PageTitle,
  Pill,
  SectionTitle,
  fmt,
  date,
} from "../components/ui";
import DeleteConfirmation from "./teacher/DeleteConfirmation";
import QuestionWorkspace from "./teacher/QuestionWorkspace";

const examSchema = z.object({
  title: z.string().min(3, "Kamida 3 ta belgi kiriting"),
  subject: z.string().min(1),
  description: z.string(),
  certificate_thresholds: z.record(z.string(), z.number()),
  duration_minutes: z.number().min(1).max(1440),
  essay_required: z.boolean(),
  expert_count: z.number().min(1).max(10),
});
type ExamForm = z.infer<typeof examSchema>;
function TeacherNav() {
  const { user } = useAuth();
  return (
    <div className="teacher-shortcuts">
      <Link to="/teacher">
        <BookOpen size={17} />
        Imtihonlar
      </Link>
      <Link to="/teacher/students">
        <Users size={17} />
        Talabalar
      </Link>
      <Link to="/teacher/rubrics">
        <ShieldCheck size={17} />
        Baholash jadvali
      </Link>
      {user?.role === "admin" && (
        <Link to="/teacher/audit">
          <Settings2 size={17} />
          Audit tarixi
        </Link>
      )}
    </div>
  );
}
// Both delete paths (list row, exam page) confirm with the same sentence, naming the exam.
const deletedMessage = (title: string) => `«${title}» imtihoni o‘chirildi`;
export default function Teacher() {
  const [create, setCreate] = useState(false);
  const [pendingDelete,setPendingDelete]=useState<Exam|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const location=useLocation();
  // The exam page hands over the deleted title through navigation state, because its own banner state ends with the page.
  const [message,setMessage]=useState(()=>{const t=(location.state as {deleted?:string}|null)?.deleted;return t?deletedMessage(t):'';});
  const client=useQueryClient();
  const act=async(action:()=>Promise<unknown>,success:string)=>{
    setBusy(true);setError('');setMessage('');
    try{await action();setMessage(success);await client.invalidateQueries({queryKey:['teacher-exams']});await client.invalidateQueries({queryKey:['exams']});}
    catch(e){setError(e instanceof Error?e.message:'Amal bajarilmadi');}finally{setBusy(false);}
  };
  const nav = useNavigate();
  // History state survives a reload; clear it so the banner shows once, not on every refresh.
  useEffect(()=>{if((location.state as {deleted?:string}|null)?.deleted)nav(location.pathname,{replace:true,state:null});},[]);
  const q = useQuery({
    queryKey: ["teacher-exams"],
    queryFn: () => api<Exam[]>("/teacher/exams"),
  });
  const attempts = useQuery({
    queryKey: ["teacher-attempts"],
    queryFn: () => api<TeacherAttempt[]>("/teacher/attempts"),
  });
  const form = useForm<ExamForm>({
    resolver: zodResolver(examSchema),
    defaultValues: {
      title: "",
      subject: "Ona tili va adabiyot",
      description: "",
      certificate_thresholds: {
        "A+": 70,
        A: 65,
        "B+": 60,
        B: 55,
        "C+": 50,
        C: 46,
      },
      duration_minutes: 90,
      essay_required: false,
      expert_count: 1,
    },
  });
  const mutation = useMutation({
    mutationFn: (values: ExamForm) => post<Exam>("/teacher/exams", values),
    onSuccess: (e) => nav(`/teacher/exams/${e.id}`),
  });
  return (
    <>
      <PageTitle
        eyebrow="O‘QITUVCHI KABINETI"
        title="Imtihonlarni boshqarish"
        description="Savollar, baholash va natijalar — barchasi bir joyda."
        action={
          <button
            className="button primary"
            onClick={() => setCreate((v) => !v)}
          >
            <Plus size={18} />
            Yangi imtihon
          </button>
        }
      />
      <TeacherNav />
      {error&&<ErrorBox error={error}/>}
      {message&&<div className="success-note" role="status"><CheckCheck size={18}/>{message}</div>}
      {pendingDelete&&<DeleteConfirmation text={`«${pendingDelete.title}» qoralamasi, savollari, matnlari va yuklangan fayllari o‘chiriladi. Audit tarixi saqlanadi.`} busy={busy} error={error}
        onCancel={()=>setPendingDelete(null)} onConfirm={()=>void act(async()=>{
          await api(`/teacher/exams/${pendingDelete.id}`,{method:'DELETE'});
          client.removeQueries({queryKey:['teacher-exam',pendingDelete.id]});setPendingDelete(null);
        },deletedMessage(pendingDelete.title))}/>}
      {create && (
        <form
          className="panel form-panel"
          onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
        >
          <h2>Yangi imtihon</h2>
          <div className="form-grid">
            <label className="field">
              Imtihon nomi
              <input {...form.register("title")} />
              {form.formState.errors.title && (
                <small className="text-error">
                  {form.formState.errors.title.message}
                </small>
              )}
            </label>
            <label className="field">
              Fan
              <input {...form.register("subject")} />
            </label>
            <label className="field">
              Vaqt (daqiqa)
              <input
                type="number"
                min={1}
                max={1440}
                {...form.register("duration_minutes", { valueAsNumber: true })}
              />
            </label>
            <label className="field">
              Ekspertlar soni
              <input
                type="number"
                min={1}
                max={10}
                {...form.register("expert_count", { valueAsNumber: true })}
              />
            </label>
          </div>
          <label className="field">
            Tavsif
            <textarea {...form.register("description")} />
          </label>
          <label className="check-field">
            <input type="checkbox" {...form.register("essay_required")} />
            Yozma ish talab qilinadi
          </label>
          {mutation.error && <ErrorBox error={mutation.error} />}
          <button className="button primary" disabled={mutation.isPending}>
            Qoralama yaratish
            <ArrowRight size={17} />
          </button>
        </form>
      )}
      <SectionTitle title="Imtihonlar" />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : q.data?.length ? (
        <div className="panel table-scroll">
          <table>
            <thead>
              <tr>
                <th>Imtihon</th>
                <th>Fan</th>
                <th>Savollar</th>
                <th>Holat</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {q.data.map((e) => (
                <tr key={e.id}>
                  <td>
                    <strong>{e.title}</strong>
                  </td>
                  <td>{e.subject}</td>
                  <td>{e.question_count}</td>
                  <td>
                    <Pill tone={e.status === "draft" ? "amber" : "green"}>
                      {e.status === "draft"
                        ? "Qoralama"
                        : e.status === "closed"
                          ? "Yopilgan"
                          : "E’lon qilingan"}
                    </Pill>
                  </td>
                  <td>
                    <div className="exam-table-actions">
                      <Link to={`/teacher/exams/${e.id}`} className="text-link">
                        Boshqarish
                        <ArrowRight size={16} />
                      </Link>
                      {e.status === "draft" && (
                        <button type="button" className="exam-delete-button" disabled={busy} aria-label={`${e.title} imtihonini o‘chirish`}
                          onClick={() => { setError(""); setPendingDelete(e); }}>
                          <Trash2 size={15} />O‘chirish
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel">
          <Empty
            title="Birinchi imtihonni yarating"
            description="Qoralama yarating, savollarni kiriting yoki PDF/JSON/CSV orqali import qiling."
          />
        </div>
      )}
      <SectionTitle title="Urinishlar va yozma ishlar" />
      {attempts.error ? (
        <ErrorBox error={attempts.error} />
      ) : attempts.isLoading ? (
        <Loading />
      ) : attempts.data?.length ? (
        <AttemptTable rows={attempts.data} />
      ) : (
        <div className="panel">
          <Empty
            title="Urinishlar hali yo‘q"
            description="Talabalar boshlagan imtihonlar va baholash kutilayotgan ishlar shu yerda ko‘rinadi."
          />
        </div>
      )}
    </>
  );
}
function AttemptTable({ rows }: { rows: TeacherAttempt[] }) {
  return (
    <div className="panel table-scroll">
      <table>
        <thead>
          <tr>
            <th>Talaba</th>
            <th>Imtihon</th>
            <th>Holat</th>
            <th>Ekspertlar</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td>{a.student_name}</td>
              <td>{a.exam_title}</td>
              <td>{a.status === "submitted" ? "Yakunlangan" : "Jarayonda"}</td>
              <td>
                {a.essay_required
                  ? `${a.assessed_experts}/${a.expert_count}`
                  : "—"}
              </td>
              <td>
                <Link className="text-link" to={`/teacher/attempts/${a.id}`}>
                  Ko‘rish
                  <ArrowRight size={16} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function ExamEditor() {
  const { id } = useParams();
  const { user } = useAuth();
  const client = useQueryClient();
  const nav = useNavigate();
  const [tab, setTab] = useState("questions"),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [verified, setVerified] = useState(false),
    [ocr, setOcr] = useState(false),
    [reviewBusy, setReviewBusy] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false);
  const q = useQuery({
    queryKey: ["teacher-exam", id],
    queryFn: () => api<Exam>(`/teacher/exams/${id}`),
  });
  const docs = useQuery({
    queryKey: ["imports", id],
    queryFn: () => api<ImportDoc[]>(`/teacher/exams/${id}/imports`),
    enabled: tab === "import",
  });
  const attempts = useQuery({
    queryKey: ["teacher-attempts", id],
    queryFn: () => api<TeacherAttempt[]>(`/teacher/attempts?exam_id=${id}`),
    enabled: tab === "results",
  });
  const calibrations = useQuery({
    queryKey: ["calibrations", id],
    queryFn: () => api<Calibration[]>(`/teacher/exams/${id}/calibrations`),
    enabled: tab === "calibration",
  });
  const stats = useQuery({
    queryKey: ["stats", id],
    queryFn: () =>
      api<{
        participants: number;
        mean_percentage: number | null;
        median_percentage: number | null;
        sd_percentage: number | null;
        pending_parts: number;
        pending_essays: number;
      }>(`/teacher/exams/${id}/statistics`),
    enabled: tab === "results",
  });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["teacher-exam", id] });
    await client.invalidateQueries({ queryKey: ["teacher-exams"] });
    await client.invalidateQueries({ queryKey: ["exams"] });
  };
  const act = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(success);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Amal bajarilmadi");
    } finally {
      setBusy(false);
    }
  };
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const exam = q.data!,
    editable = exam.status === "draft";
  const upload = async (file: File | undefined, kind: string) => {
    if (!file || busy || reviewBusy) return;
    await act(async () => {
      const data = new FormData();
      data.append("file", file);
      if (kind === "pdf") data.append("ocr", String(ocr));
      await api(`/teacher/exams/${id}/import/${kind}`, {
        method: "POST",
        body: data,
      });
      await client.invalidateQueries({ queryKey: ["imports", id] });
    }, "Import saqlandi. Savollar va kalitlarni qo‘lda tekshiring.");
  };
  return (
    <>
      <Link to="/teacher" className="text-link">
        <ArrowLeft size={16} />
        O‘qituvchi paneli
      </Link>
      <PageTitle
        title={exam.title}
        description={`${exam.subject} · ${exam.duration_minutes} daqiqa · ${exam.question_count} ta savol`}
        action={
          <>
            <Pill tone={editable ? "amber" : "green"}>
              {editable
                ? "Qoralama"
                : exam.status === "closed"
                  ? "Yopilgan"
                  : "E’lon qilingan"}
            </Pill>
            {/* A draft is deletable from here too, not only from the exam list. */}
            {editable && (
              <button
                className="exam-delete-button"
                disabled={busy || reviewBusy}
                aria-label={`${exam.title} imtihonini o‘chirish`}
                onClick={() => {
                  setError("");
                  setConfirmDelete(true);
                }}
              >
                <Trash2 size={15} />
                O‘chirish
              </button>
            )}
          </>
        }
      />
      {confirmDelete && (
        <DeleteConfirmation
          text={`«${exam.title}» qoralamasi, savollari, matnlari va yuklangan fayllari o‘chiriladi. Audit tarixi saqlanadi.`}
          busy={busy}
          error={error}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() =>
            void (async () => {
              setBusy(true);
              setError("");
              try {
                await api(`/teacher/exams/${exam.id}`, { method: "DELETE" });
                client.removeQueries({ queryKey: ["teacher-exam", exam.id] });
                setConfirmDelete(false);
                await refresh();
                nav("/teacher", { state: { deleted: exam.title } });
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Imtihon o‘chirilmadi.",
                );
              } finally {
                setBusy(false);
              }
            })()
          }
        />
      )}
      <div className="tabs teacher-tabs">
        {[
          ["questions", "Savollar"],
          ["import", "Import"],
          ["results", "Urinishlar va statistika"],
          ["calibration", "Rasch kalibrlash"],
          ["settings", "Sozlamalar"],
        ].map(([v, l]) => (
          <button
            key={v}
            className={tab === v ? "selected" : ""}
            onClick={() => {
              setTab(v);
              setMessage("");
              setError("");
            }}
          >
            {l}
          </button>
        ))}
      </div>
      {error && <ErrorBox error={error} />}{" "}
      {message && (
        <div className="success-note" role="status">
          <CheckCheck size={18} />
          {message}
        </div>
      )}
      {tab === "questions" && (
        <>
          <QuestionWorkspace key={exam.id} exam={exam} onRefresh={refresh} />
        </>
      )}
      {tab === "import" && (
        <>
          <div className="panel form-panel">
            <h2>Savollarni import qilish</h2>
            <p>
              PDF matni, sahifalari va diagrammalar saqlanadi. Savollar
              avtomatik to‘qilmaydi — ajratilgan matndan foydalanib ularni
              muharrirda tekshiring.
            </p>
            <div className="upload-grid">
              <label className="upload-box">
                <FileUp size={30} />
                <strong>PDF yuklash</strong>
                <span>20 MB gacha · PyMuPDF</span>
                <input
                  type="file"
                  accept="application/pdf"
                  disabled={busy || reviewBusy || !editable}
                  onChange={(e) => void upload(e.target.files?.[0], "pdf")}
                />
              </label>
              <label className="upload-box">
                <FileUp size={30} />
                <strong>JSON yoki CSV yuklash</strong>
                <span>Savollar, variantlar va kalitlar</span>
                <input
                  type="file"
                  accept=".json,.csv"
                  disabled={busy || reviewBusy || !editable}
                  onChange={(e) =>
                    void upload(e.target.files?.[0], "structured")
                  }
                />
              </label>
            </div>
            <label className="check-field">
              <input
                type="checkbox"
                checked={ocr}
                onChange={(e) => setOcr(e.target.checked)}
              />
              Skan sahifalar uchun mahalliy OCR (Tesseract o‘rnatilgan bo‘lsa)
            </label>
            {busy && <Loading />}
          </div>
          {docs.error && <ErrorBox error={docs.error} />}{" "}
          {docs.isPending && <Loading />}
          {docs.data && <p className="info-note">Import qilingan savollar va javob kalitlarini o‘qituvchi tekshirishi shart. E’lon qilish Sozlamalar bo‘limida alohida tasdiqlanadi.</p>}
          {docs.data && <QuestionWorkspace key={exam.id} exam={exam} onRefresh={refresh} importDocs={docs.data} disabled={busy} onBusyChange={setReviewBusy} />}

        </>
      )}
      {tab === "results" && (
        <>
          {stats.error && <ErrorBox error={stats.error} />}{" "}
          {stats.data && (
            <div className="stats-grid">
              {[
                ["Ishtirokchilar", stats.data.participants],
                ["O‘rtacha xom foiz", fmt(stats.data.mean_percentage)],
                ["Mediana", fmt(stats.data.median_percentage)],
                ["Standart og‘ish", fmt(stats.data.sd_percentage)],
              ].map(([label, value]) => (
                <div className="stat-card" key={label}>
                  <span className="stat-label">{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          )}
          <div className="button-row">
            <button
              className="button secondary"
              onClick={() =>
                void act(
                  () =>
                    download(
                      `/teacher/exams/${id}/export?format=csv`,
                      "natijalar.csv",
                    ),
                  "CSV yuklandi",
                )
              }
            >
              <Download size={17} />
              CSV
            </button>
            <button
              className="button secondary"
              onClick={() =>
                void act(
                  () =>
                    download(
                      `/teacher/exams/${id}/export?format=xlsx`,
                      "natijalar.xlsx",
                    ),
                  "Excel yuklandi",
                )
              }
            >
              <Download size={17} />
              Excel
            </button>
          </div>
          {attempts.error ? (
            <ErrorBox error={attempts.error} />
          ) : attempts.data?.length ? (
            <AttemptTable rows={attempts.data} />
          ) : (
            <Empty title="Yakunlangan urinishlar yo‘q" />
          )}
        </>
      )}
      {tab === "calibration" && (
        <>
          <div className="panel form-panel">
            <h2>Rasch 1PL kalibrlash</h2>
            <p>
              MML baholash mustaqil ikkilik qismlardan foydalanadi.
              Ishtirokchilar soni ishonchlilik kafolati emas. Har bir versiya
              diagnostik tekshiruv va administrator tasdig‘ini talab qiladi.
            </p>
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await post(`/teacher/exams/${id}/calibrations`);
                  await client.invalidateQueries({
                    queryKey: ["calibrations", id],
                  });
                }, "Kalibrlash diagnostikasi saqlandi")
              }
            >
              Kalibrlashni boshlash
            </button>
          </div>
          {calibrations.error && <ErrorBox error={calibrations.error} />}{" "}
          {calibrations.data?.map((run) => (
            <CalibrationCard
              key={run.id}
              run={run}
              isAdmin={user?.role === "admin"}
              onChange={() =>
                client.invalidateQueries({ queryKey: ["calibrations", id] })
              }
            />
          ))}
        </>
      )}
      {tab === "settings" && (
        <>
          <ExamSettings exam={exam} onSaved={refresh} />
          <div className="panel form-panel">
            <h2>Imtihonni e’lon qilish</h2>
            <p>
              Birinchi urinishdan keyin savollar va kalitlar o‘zgarmaydi.
              Tuzatish uchun yangi imtihon yarating.
            </p>
            <label className="check-field">
              <input
                type="checkbox"
                checked={verified}
                onChange={(e) => setVerified(e.target.checked)}
              />
              Barcha matn, rasmlar, javob kalitlari va ballarni tekshirdim
            </label>
            <button
              className="button primary"
              disabled={busy || !editable || !verified}
              onClick={() =>
                void act(
                  () =>
                    post(`/teacher/exams/${id}/publish`, { verified: true }),
                  "Imtihon e’lon qilindi",
                )
              }
            >
              E’lon qilish
            </button>
          </div>
          {user?.role === "admin" && (
            <div className="panel form-panel">
              <h2>Natijalar va javoblar e’loni</h2>
              <p>
                Natijalarni e’lon qilish xom ballar reytingini ochadi. Yakuniy
                baho faqat tasdiqlangan kalibrlash va kerakli ekspert baholari
                bo‘lsa chiqadi. Javob kaliti ochilganda imtihon yangi urinishlar
                uchun yopiladi.
              </p>
              <div className="button-row">
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () =>
                        post(`/admin/exams/${id}/release`, {
                          results_published: true,
                          answer_released: false,
                        }),
                      "Natijalar e’lon qilindi",
                    )
                  }
                >
                  Natijalarni e’lon qilish
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () =>
                        post(`/admin/exams/${id}/release`, {
                          results_published: true,
                          answer_released: true,
                        }),
                      "Javob kaliti ochildi, imtihon yopildi",
                    )
                  }
                >
                  Kalitni ochish va yopish
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () =>
                        post(`/admin/exams/${id}/release`, {
                          results_published: false,
                          answer_released: false,
                        }),
                      "Natijalar qaytarib olindi",
                    )
                  }
                >
                  Natijalarni qaytarib olish
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
function ExamSettings({
  exam,
  onSaved,
}: {
  exam: Exam;
  onSaved: () => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const form = useForm<ExamForm>({
    resolver: zodResolver(examSchema),
    defaultValues: {
      title: exam.title,
      subject: exam.subject,
      description: exam.description,
      certificate_thresholds: exam.certificate_thresholds,
      duration_minutes: exam.duration_minutes,
      essay_required: exam.essay_required,
      expert_count: exam.expert_count,
    },
  });
  return (
    <form
      className="panel form-panel"
      onSubmit={form.handleSubmit(async (values) => {
        setError("");
        try {
          await api(`/teacher/exams/${exam.id}`, {
            method: "PATCH",
            body: JSON.stringify(values),
          });
          setSaved(true);
          await onSaved();
        } catch (e) {
          setError((e as Error).message);
        }
      })}
    >
      <h2>Imtihon sozlamalari</h2>
      <fieldset disabled={exam.status !== "draft"}>
        <div className="form-grid">
          <label className="field">
            Nomi
            <input {...form.register("title")} />
          </label>
          <label className="field">
            Fan
            <input {...form.register("subject")} />
          </label>
          <label className="field">
            Vaqt (daqiqa)
            <input
              type="number"
              {...form.register("duration_minutes", { valueAsNumber: true })}
            />
          </label>
          <label className="field">
            Ekspertlar soni
            <input
              type="number"
              {...form.register("expert_count", { valueAsNumber: true })}
            />
          </label>
        </div>
        <label className="field">
          Tavsif
          <textarea {...form.register("description")} />
        </label>
        <label className="check-field">
          <input type="checkbox" {...form.register("essay_required")} />
          Esse talab etiladi
        </label>
        <h3>Norasmiy daraja chegaralari</h3>
        <div className="form-grid">
          {["A+", "A", "B+", "B", "C+", "C"].map((grade) => (
            <label className="field" key={grade}>
              {grade}
              <input
                type="number"
                step="any"
                {...form.register(`certificate_thresholds.${grade}`, {
                  valueAsNumber: true,
                })}
              />
            </label>
          ))}
        </div>
        <button className="button primary">Saqlash</button>
      </fieldset>
      {error && <ErrorBox error={error} />}{" "}
      {saved && <p className="text-accent">Saqlandi</p>}
    </form>
  );
}
function CalibrationCard({
  run,
  isAdmin,
  onChange,
}: {
  run: Calibration;
  isAdmin: boolean;
  onChange: () => Promise<unknown>;
}) {
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      const result = await fn();
      setMessage(JSON.stringify(result));
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel form-panel">
      <div className="section-title">
        <h3>Versiya {run.id.slice(0, 8)}</h3>
        <Pill tone={run.approved ? "green" : "amber"}>
          {run.approved ? "Tasdiqlangan" : "Tekshiruv kutilmoqda"}
        </Pill>
      </div>
      <pre className="diagnostics">
        {JSON.stringify(run.diagnostics, null, 2)}
      </pre>
      {isAdmin && !run.approved && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            void act(() =>
              post(`/admin/calibrations/${run.id}/approve`, {
                reference_name: data.get("name"),
                reference_mean: Number(data.get("mean")),
                reference_sd: Number(data.get("sd")),
                validation_note: data.get("note"),
              }),
            );
          }}
        >
          <h3>Referens populyatsiya va validatsiya</h3>
          <label className="field">
            Referens nomi
            <input name="name" required minLength={5} />
          </label>
          <div className="form-grid">
            <label className="field">
              Referens θ o‘rtachasi
              <input type="number" step="any" name="mean" required />
            </label>
            <label className="field">
              Referens θ standart og‘ishi
              <input
                type="number"
                step="any"
                min="0.000001"
                name="sd"
                required
              />
            </label>
          </div>
          <label className="field">
            Validatsiya dalili (kamida 30 belgi)
            <textarea name="note" required minLength={30} />
          </label>
          <button
            className="button primary"
            disabled={
              busy ||
              run.diagnostics.flags.length > 0 ||
              !run.diagnostics.converged
            }
          >
            Versiyani tasdiqlash
          </button>
        </form>
      )}
      {run.approved && (
        <>
          <p>
            Referens: {run.reference_name}, μ={run.reference_mean}, σ=
            {run.reference_sd}
          </p>
          <button
            className="button primary"
            disabled={busy}
            onClick={() =>
              void act(() => post(`/teacher/calibrations/${run.id}/score`))
            }
          >
            Urinishlarni baholash
          </button>
        </>
      )}
      {error && <ErrorBox error={error} />}{" "}
      {message && <p className="success-note">{message}</p>}
    </div>
  );
}
export function Assessment() {
  const { id } = useParams();
  const client = useQueryClient();
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const q = useQuery({
      queryKey: ["assessment", id],
      queryFn: () =>
        api<{
          attempt: Attempt;
          student: User;
          result: Result | null;
          assessments: {
            teacher_id: string;
            score: number;
            converted_score: number;
            rubric_id: string;
            comment: string;
            graded_at: string;
          }[];
        }>(`/teacher/attempts/${id}`),
    }),
    rubrics = useQuery({
      queryKey: ["rubrics"],
      queryFn: () => api<Rubric[]>("/teacher/rubrics"),
    });
  const act = async (fn: () => Promise<unknown>) => {
    setError("");
    setBusy(true);
    try {
      await fn();
      setMessage("Saqlandi");
      await client.invalidateQueries({ queryKey: ["assessment", id] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const data = q.data!;
  return (
    <>
      <Link className="text-link" to="/teacher">
        <ArrowLeft size={16} />
        O‘qituvchi paneli
      </Link>
      <PageTitle
        title={data.student.name}
        description={data.result?.exam_title || "Urinish jarayonda"}
      />
      {error && <ErrorBox error={error} />}{" "}
      {message && <div className="success-note">{message}</div>}
      {data.result && (
        <div className="info-note">
          <CheckCheck size={20} />
          <p>
            Xom ball: {fmt(data.result.raw_score)} / {fmt(data.result.maximum)}.
            Kutilayotgan qismlar: {data.result.pending_parts}.
          </p>
        </div>
      )}
      <div className="panel form-panel">
        <h2>Talabaning yozma ishi</h2>
        <div className="essay-text preserve">
          {data.attempt.essay_text || "Yozma ish matni kiritilmagan."}
        </div>
      </div>
      {data.result?.essay_required && (
        <form
          className="panel form-panel"
          onSubmit={(e) => {
            e.preventDefault();
            const values = new FormData(e.currentTarget);
            void act(() =>
              put(`/teacher/attempts/${id}/essay-grade`, {
                score: Number(values.get("score")),
                rubric_id: values.get("rubric"),
                comment: values.get("comment"),
              }),
            );
          }}
        >
          <h2>Ekspert bahosi</h2>
          <p>
            Har bir ekspertning bahosi avval rasmiy jadval bo‘yicha
            konvertatsiya qilinadi. So‘ng 75 ballik baholarning o‘rtachasi
            olinadi.
          </p>
          {rubrics.error && <ErrorBox error={rubrics.error} />}{" "}
          {!rubrics.data?.length && (
            <div className="alert">
              Rasmiy baholash jadvali hali yuklanmagan. Administrator
              Baholash_mezoni.pdf va tekshirilgan jadvalni kiritishi kerak.
            </div>
          )}
          <div className="form-grid">
            <label className="field">
              Ball (0–24, qadam 0.5)
              <input
                type="number"
                name="score"
                min={0}
                max={24}
                step={0.5}
                required
              />
            </label>
            <label className="field">
              Rasmiy jadval versiyasi
              <select name="rubric" required>
                <option value="">Tanlang</option>
                {rubrics.data?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.source_name} · {r.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            Izoh / tuzatish sababi
            <textarea name="comment" />
          </label>
          <button
            className="button primary"
            disabled={
              busy || !rubrics.data?.length || data.result.results_published
            }
          >
            O‘z ekspert bahomni saqlash
          </button>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Ekspert</th>
                  <th>24 ball</th>
                  <th>75 ball</th>
                  <th>Sana</th>
                </tr>
              </thead>
              <tbody>
                {data.assessments.map((a) => (
                  <tr key={a.teacher_id}>
                    <td>{a.teacher_id.slice(0, 8)}</td>
                    <td>{a.score}</td>
                    <td>{a.converted_score}</td>
                    <td>{date(a.graded_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </form>
      )}
      {data.result?.review
        .filter((q) => q.parts.some((p) => p.manual_review))
        .map((question) => (
          <div className="panel form-panel" key={question.id}>
            <h3>
              {question.position}. {question.text}
            </h3>
            {question.parts
              .filter((p) => p.manual_review)
              .map((part) => (
                <form
                  className="manual-grade-row"
                  key={part.id}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const values = new FormData(e.currentTarget);
                    void act(() =>
                      put(`/teacher/attempts/${id}/parts/${part.id}/grade`, {
                        score: Number(values.get("score")),
                        reason: values.get("reason"),
                      }),
                    );
                  }}
                >
                  <p>
                    <strong>{part.label}</strong> · Javob:{" "}
                    {question.answers[part.label] || "Javob yo‘q"}
                  </p>
                  <label className="field">
                    Ball (0–{part.weight})
                    <input
                      type="number"
                      name="score"
                      min={0}
                      max={part.weight}
                      step="any"
                      required
                      defaultValue={
                        question.grades.find((g) => g.part_id === part.id)
                          ?.score ?? ""
                      }
                    />
                  </label>
                  <label className="field">
                    Sabab
                    <input name="reason" minLength={3} required />
                  </label>
                  <button
                    className="button secondary"
                    disabled={busy || data.result?.results_published}
                  >
                    Qismni baholash
                  </button>
                </form>
              ))}
          </div>
        ))}
      <div className="button-row">
        <Link className="button secondary" to={`/results/${id}`}>
          Batafsil natija
        </Link>
        <button
          className="button primary"
          disabled={
            busy ||
            !data.result?.results_published ||
            data.student.telegram_id <= 0
          }
          onClick={() => void act(() => post(`/teacher/attempts/${id}/notify`))}
        >
          Telegram orqali natija xabari
        </button>
      </div>
    </>
  );
}
export function Students() {
  const { user } = useAuth();
  const client = useQueryClient();
  const [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const q = useQuery({
    queryKey: ["students"],
    queryFn: () => api<User[]>("/teacher/students"),
  });
  const update = async (student: User, role: string, active: boolean) => {
    try {
      await api(`/admin/users/${student.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role, active }),
      });
      await client.invalidateQueries({ queryKey: ["students"] });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <PageTitle
        title="Talabalar va rollar"
        description="Huquqlar faqat administrator tomonidan o‘zgartiriladi."
      />
      <TeacherNav />
      {error && <ErrorBox error={error} />}{" "}
      {message && <p className="success-note">{message}</p>}
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <div className="panel table-scroll">
          <table>
            <thead>
              <tr>
                <th />
                <th>Ism</th>
                <th>Telegram ID</th>
                <th>Rol</th>
                <th>Holat</th>
              </tr>
            </thead>
            <tbody>
              {q.data?.map((s) => (
                <tr key={s.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${s.name} ni tanlash`}
                      checked={selected.includes(s.id)}
                      onChange={(e) =>
                        setSelected((v) =>
                          e.target.checked
                            ? [...v, s.id]
                            : v.filter((id) => id !== s.id),
                        )
                      }
                    />
                  </td>
                  <td>{s.name}</td>
                  <td>{s.telegram_id}</td>
                  <td>
                    <select
                      aria-label={`${s.name} roli`}
                      disabled={user?.role !== "admin" || s.id === user.id}
                      value={s.role}
                      onChange={(e) => void update(s, e.target.value, s.active)}
                    >
                      <option value="student">Talaba</option>
                      <option value="teacher">O‘qituvchi</option>
                      <option value="admin">Administrator</option>
                    </select>
                  </td>
                  <td>
                    <button
                      className="text-link"
                      disabled={user?.role !== "admin" || s.id === user.id}
                      onClick={() => void update(s, s.role, !s.active)}
                    >
                      {s.active ? "Faol" : "Bloklangan"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {user?.role === "admin" && (
        <form
          className="panel form-panel"
          onSubmit={(e) => {
            e.preventDefault();
            const values = new FormData(e.currentTarget);
            setError("");
            post<{ sent: number; failed: number }>("/admin/announcements", {
              user_ids: selected,
              text: values.get("text"),
            })
              .then((r) =>
                setMessage(`Yuborildi: ${r.sent}, yuborilmadi: ${r.failed}`),
              )
              .catch((e) => setError(e.message));
          }}
        >
          <h2>Telegram e’loni</h2>
          <p>
            {selected.length} ta hisob tanlangan. Faqat haqiqiy Telegram
            hisoblariga yuboriladi.
          </p>
          <label className="field">
            E’lon matni
            <textarea name="text" maxLength={3000} required />
          </label>
          <button className="button primary" disabled={selected.length === 0}>
            Tanlangan talabalarga yuborish
          </button>
        </form>
      )}
    </>
  );
}
export function RubricManager() {
  const { user } = useAuth();
  const client = useQueryClient();
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["rubrics"],
    queryFn: () => api<Rubric[]>("/teacher/rubrics"),
  });
  const upload = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const form = new FormData(e.currentTarget);
      await api("/admin/rubrics", { method: "POST", body: form });
      setMessage("Rasmiy jadval versiyasi saqlandi");
      await client.invalidateQueries({ queryKey: ["rubrics"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageTitle
        title="Rasmiy esse baholash jadvali"
        description="Aniq PDF jadvali talab qilinadi. Avtomatik chiziqli konvertatsiya qo‘llanmaydi."
      />
      <TeacherNav />
      {error && <ErrorBox error={error} />}{" "}
      {message && <div className="success-note">{message}</div>}
      {user?.role === "admin" && (
        <form className="panel form-panel" onSubmit={upload}>
          <label className="field">
            Baholash_mezoni.pdf
            <input
              type="file"
              accept="application/pdf"
              name="source"
              required
            />
          </label>
          <label className="field">
            PDF bilan tekshirilgan JSON jadvali
            <textarea
              className="code-editor"
              rows={12}
              name="table_json"
              required
              placeholder={'{"0.0": ..., "0.5": ..., ... "24.0": ...}'}
            />
          </label>
          <p className="muted small">
            0.0 dan 24.0 gacha, 0.5 qadam bilan 49 ta qiymat. Har bir qiymat
            PDFdagi 75 ballik natijaga aynan teng bo‘lishi shart.
          </p>
          <label className="check-field">
            <input type="checkbox" name="verified" value="true" required />
            Har bir qiymatni PDFdagi rasmiy jadval bilan solishtirib tekshirdim
          </label>
          <button className="button primary" disabled={busy}>
            Jadvalni tasdiqlash va saqlash
          </button>
        </form>
      )}
      {q.error && <ErrorBox error={q.error} />}{" "}
      {q.data?.length ? (
        q.data.map((r) => (
          <details className="panel form-panel" key={r.id}>
            <summary>
              {r.source_name} · {r.id.slice(0, 8)}
            </summary>
            <p className="small break-word">SHA256: {r.source_sha256}</p>
            <pre className="diagnostics">
              {JSON.stringify(r.table, null, 2)}
            </pre>
          </details>
        ))
      ) : (
        <div className="panel">
          <Empty
            title="Rasmiy jadval mavjud emas"
            description="PDF yuklanguncha esse konvertatsiyasi va unga bog‘liq yakuniy ball kutish holatida qoladi."
          />
        </div>
      )}
    </>
  );
}
export function AuditPage() {
  const q = useQuery({
    queryKey: ["audit"],
    queryFn: () =>
      api<
        {
          actor_id: string;
          action: string;
          entity_id: string;
          before: unknown;
          after: unknown;
          created_at: string;
        }[]
      >("/admin/audit"),
  });
  return (
    <>
      <PageTitle
        title="Audit tarixi"
        description="Baholar, huquqlar va natijalardagi o‘zgarishlar tarixi."
      />
      <TeacherNav />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <div className="panel table-scroll">
          <table>
            <thead>
              <tr>
                <th>Sana</th>
                <th>Amal</th>
                <th>Muallif</th>
                <th>Tafsilot</th>
              </tr>
            </thead>
            <tbody>
              {q.data?.map((r, i) => (
                <tr key={i}>
                  <td>{date(r.created_at)}</td>
                  <td>{r.action}</td>
                  <td>{r.actor_id.slice(0, 8)}</td>
                  <td>
                    <details>
                      <summary>{r.entity_id.slice(0, 8)}</summary>
                      <pre className="diagnostics">
                        {JSON.stringify(
                          { before: r.before, after: r.after },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
