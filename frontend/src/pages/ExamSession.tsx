import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CheckCheck,
  Clock3,
  Flag,
  Grid2X2,
  LoaderCircle,
  Send,
  TriangleAlert,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, post, put } from "../services/api";
import type { Attempt, SavedResponse } from "../types";
import { ErrorBox, Loading, Pill } from "../components/ui";
import QuestionBody from "../components/QuestionBody";
export default function ExamSession() {
  const { id } = useParams();
  const nav = useNavigate(),
    client = useQueryClient();
  const [attempt, setAttempt] = useState<Attempt | null>(null),
    [error, setError] = useState(""),
    [saveStatus, setSaveStatus] = useState("Barcha javoblar saqlangan"),
    [current, setCurrent] = useState(0),
    [now, setNow] = useState(Date.now()),
    [offset, setOffset] = useState(0),
    [grid, setGrid] = useState(false),
    [confirm, setConfirm] = useState(false),
    [submitting, setSubmitting] = useState(false),
    [responses, setResponses] = useState<Record<string, SavedResponse>>({}),
    [essay, setEssay] = useState("");
  const responseRef = useRef<Record<string, SavedResponse>>({}),
    pending = useRef(new Map<string, SavedResponse>()),
    pendingEssay = useRef<string | null>(null),
    running = useRef<Promise<void> | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    expired = useRef(false),
    mounted = useRef(true);
  const finish = useCallback(() => {
    void client.invalidateQueries({ queryKey: ["attempts"] });
    nav(`/results/${id}`, { replace: true });
  }, [id, nav, client]);
  useEffect(() => {
    mounted.current = true;
    api<Attempt>(`/attempts/${id}`)
      .then((a) => {
        if (!mounted.current) return;
        if (a.status === "submitted") {
          finish();
          return;
        }
        setAttempt(a);
        setOffset(new Date(a.server_now).getTime() - Date.now());
        const map = Object.fromEntries(
          a.responses.map((r) => [r.question_id, r]),
        );
        responseRef.current = map;
        setResponses(map);
        setEssay(a.essay_text);
      })
      .catch((e) => setError(e.message));
    return () => {
      mounted.current = false;
    };
  }, [id, finish]);
  const flush = useCallback(async (): Promise<void> => {
    if (running.current) {
      await running.current;
      return flush();
    }
    const work = async () => {
      while (pending.current.size || pendingEssay.current !== null) {
        setSaveStatus("Saqlanmoqda…");
        for (const [qid, draft] of pending.current) {
          pending.current.delete(qid);
          const revision = responseRef.current[qid]?.revision || 0;
          try {
            const saved = await put<{ revision: number }>(
              `/attempts/${id}/responses/${qid}`,
              { answers: draft.answers, marked: draft.marked, revision },
            );
            const latest = {
              ...responseRef.current[qid],
              revision: saved.revision,
            };
            responseRef.current = { ...responseRef.current, [qid]: latest };
            if (mounted.current) setResponses(responseRef.current);
          } catch (e) {
            if (e instanceof ApiError && e.submitted) {
              finish();
              return;
            }
            if (!pending.current.has(qid)) pending.current.set(qid, draft);
            throw e;
          }
        }
        if (pendingEssay.current !== null) {
          const text = pendingEssay.current;
          pendingEssay.current = null;
          try {
            await put(`/attempts/${id}/essay`, { text });
          } catch (e) {
            if (pendingEssay.current === null) pendingEssay.current = text;
            if (e instanceof ApiError && e.submitted) {
              finish();
              return;
            }
            throw e;
          }
        }
      }
      if (mounted.current) {
        setSaveStatus("Barcha javoblar saqlangan");
        setError("");
      }
    };
    const task = work();
    running.current = task;
    try {
      await task;
    } catch (e) {
      setSaveStatus("Saqlashda xatolik");
      setError(e instanceof Error ? e.message : "Javob saqlanmadi");
      throw e;
    } finally {
      if (running.current === task) running.current = null;
    }
  }, [id, finish]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      void flush().catch(() => {});
    },
    [flush],
  );
  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flush().catch(() => {});
    }, 600);
    setSaveStatus("Saqlanmagan o‘zgarishlar");
  };
  const change = (
    qid: string,
    answers: Record<string, string>,
    marked?: boolean,
  ) => {
    const old = responseRef.current[qid];
    const draft = {
      question_id: qid,
      answers,
      marked: marked ?? old?.marked ?? false,
      revision: old?.revision || 0,
    };
    responseRef.current = { ...responseRef.current, [qid]: draft };
    setResponses(responseRef.current);
    pending.current.set(qid, draft);
    schedule();
  };
  const submit = useCallback(
    async (force = false) => {
      setSubmitting(true);
      setError("");
      try {
        if (!force) await flush();
        await post(`/attempts/${id}/submit`);
        finish();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Yakunlashda xatolik");
        expired.current = false;
      } finally {
        setSubmitting(false);
      }
    },
    [flush, id, finish],
  );
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const sync = setInterval(() => {
      api<Attempt>(`/attempts/${id}`)
        .then((a) => {
          setOffset(new Date(a.server_now).getTime() - Date.now());
          if (a.status === "submitted") finish();
        })
        .catch(() => {});
    }, 30000);
    const unload = (event: BeforeUnloadEvent) => {
      if (
        pending.current.size ||
        pendingEssay.current !== null ||
        running.current
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      clearInterval(tick);
      clearInterval(sync);
      window.removeEventListener("beforeunload", unload);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [id, finish]);
  const remaining = attempt
    ? Math.max(
        0,
        Math.ceil((new Date(attempt.deadline).getTime() - now - offset) / 1000),
      )
    : 0;
  useEffect(() => {
    if (attempt && remaining === 0 && !expired.current) {
      expired.current = true;
      void submit(true);
    }
  }, [remaining, attempt, submit]);
  if (!attempt) return error ? <ErrorBox error={error} /> : <Loading />;
  const exam = attempt.exam!,
    questions = exam.questions || [],
    q = questions[current],
    answer = responses[q?.id]?.answers || {},
    marked = responses[q?.id]?.marked || false;
  const answered = questions.filter((item) =>
    item.parts.every((p) => responses[item.id]?.answers[p.label]?.trim()),
  ).length;
  const passage = exam.passages?.find((p) => p.id === q?.passage_id);
  return (
    <div className="exam-session">
      <div className="exam-toolbar">
        <Link
          to="/exams"
          className="text-link"
          onClick={(e) => {
            if (pending.current.size || running.current) {
              e.preventDefault();
              void flush()
                .then(() => nav("/exams"))
                .catch(() => {});
            }
          }}
        >
          <ArrowLeft size={17} />
          Sinovlar
        </Link>
        <span className={remaining < 300 ? "timer urgent" : "timer"}>
          <Clock3 size={19} />
          {Math.floor(remaining / 3600) > 0
            ? `${Math.floor(remaining / 3600)}:`
            : ""}
          {String(Math.floor(remaining / 60) % 60).padStart(2, "0")}:
          {String(remaining % 60).padStart(2, "0")}
        </span>
        <button
          className="button primary"
          onClick={() => setConfirm(true)}
          disabled={submitting}
        >
          Yakunlash
          <Send size={16} />
        </button>
      </div>
      <div className="exam-heading">
        <Pill>Sinov imtihoni</Pill>
        <h1>{exam.title}</h1>
        <div className="exam-progress-label">
          <span>
            {answered} / {questions.length} ta savolga javob berildi
          </span>
          <span className="save-status" aria-live="polite">
            {saveStatus.includes("Saqlanmoqda") ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <CheckCheck size={14} />
            )}{" "}
            {saveStatus}
          </span>
        </div>
        <div className="progress-track">
          <div
            style={{
              width: `${questions.length ? (answered / questions.length) * 100 : 0}%`,
            }}
          />
        </div>
      </div>
      {error && (
        <div>
          <ErrorBox error={error} />
          <button
            className="button secondary"
            onClick={() => void flush().catch(() => {})}
          >
            Qayta saqlash
          </button>
        </div>
      )}
      <div className="session-grid">
        <section className="question-panel panel">
          {q && (
            <>
              <div className="question-top">
                <span className="eyebrow">
                  {q.position}-SAVOL{" "}
                  <span className="muted">/ {questions.length}</span>
                </span>
                <button
                  className={`review-button ${marked ? "marked" : ""}`}
                  onClick={() => change(q.id, answer, !marked)}
                >
                  <Flag size={17} />
                  {marked ? "Belgilangan" : "Qayta ko‘rish"}
                </button>
              </div>
              <QuestionBody question={q} answers={answer} passage={passage} onAnswer={answers => change(q.id, answers)} />
              <div className="question-bottom">
                <button
                  className="button secondary"
                  disabled={current === 0}
                  onClick={() => setCurrent((v) => v - 1)}
                >
                  <ArrowLeft size={17} />
                  Oldingi
                </button>
                <button
                  className="text-link muted"
                  onClick={() => change(q.id, {})}
                >
                  Javobni tozalash
                </button>
                <button
                  className="button primary"
                  disabled={current === questions.length - 1}
                  onClick={() => setCurrent((v) => v + 1)}
                >
                  Keyingi
                  <ArrowRight size={17} />
                </button>
              </div>
            </>
          )}
          {exam.essay_required && (
            <details className="essay-editor">
              <summary>Yozma ish / esse</summary>
              <p>
                Esse matnini shu yerga kiriting. O‘qituvchi 24 ballik mezon
                bo‘yicha baholaydi.
              </p>
              <textarea
                aria-label="Esse matni"
                rows={12}
                maxLength={50000}
                value={essay}
                onChange={(e) => {
                  setEssay(e.target.value);
                  pendingEssay.current = e.target.value;
                  schedule();
                }}
              />
              <small className="muted">{essay.length} ta belgi</small>
            </details>
          )}
        </section>
        <aside className={`question-sidebar panel ${grid ? "expanded" : ""}`}>
          <button
            className="question-grid-title"
            onClick={() => setGrid((v) => !v)}
          >
            <Grid2X2 size={18} />
            <strong>Savollar xaritasi</strong>
          </button>
          <div className="question-grid">
            {questions.map((item, i) => {
              const r = responses[item.id];
              return (
                <button
                  key={item.id}
                  aria-label={`${item.position}-savol`}
                  aria-current={current === i ? "step" : undefined}
                  className={`${current === i ? "current " : ""}${item.parts.every((p) => r?.answers[p.label]?.trim()) ? "answered " : ""}${r?.marked ? "flagged" : ""}`}
                  onClick={() => {
                    setCurrent(i);
                    setGrid(false);
                  }}
                >
                  {item.position}
                  {r?.marked && <span />}
                </button>
              );
            })}
          </div>
          <div className="question-legend">
            <span>
              <i className="legend-dot answered" />
              Javob berilgan
            </span>
            <span>
              <i className="legend-dot" />
              Javob berilmagan
            </span>
            <span>
              <i className="legend-dot flagged" />
              Qayta ko‘rish
            </span>
          </div>
          <div className="info-note">
            <Clock3 size={18} />
            <p>
              Vaqt server tomonidan nazorat qilinadi. Javoblar avtomatik
              saqlanadi.
            </p>
          </div>
        </aside>
      </div>
      {confirm && (
        <div className="modal-backdrop">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="submit-title"
          >
            <div className="modal-icon">
              <Send size={26} />
            </div>
            <h2 id="submit-title">Sinovni yakunlaysizmi?</h2>
            <p>
              {answered} / {questions.length} ta savolga to‘liq javob berilgan.
            </p>
            {answered < questions.length && (
              <div className="alert">
                <TriangleAlert size={18} />
                {questions.length - answered} ta savolda javob yetishmaydi.
              </div>
            )}
            <p>Yakunlaganingizdan keyin javoblarni o‘zgartirib bo‘lmaydi.</p>
            <div className="button-row">
              <button
                className="button secondary"
                disabled={submitting}
                onClick={() => setConfirm(false)}
              >
                Davom ettirish
              </button>
              <button
                className="button primary"
                disabled={submitting}
                onClick={() => void submit()}
              >
                {submitting ? "Yakunlanmoqda…" : "Tasdiqlash"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
