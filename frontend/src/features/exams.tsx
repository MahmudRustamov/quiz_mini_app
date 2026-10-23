import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, BookOpen, Clock3, FileText, Layers } from "lucide-react";
import { post } from "../services/api";
import { ErrorBox, Pill } from "../components/ui";
import type { Attempt, Exam } from "../types";
export function ExamCard({ exam, attempt }: { exam: Exam; attempt?: Attempt }) {
  const nav = useNavigate(),
    client = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const start = useMutation({
    mutationFn: () => post<Attempt>(`/exams/${exam.id}/attempts`),
    onSuccess: (a) => {
      void client.invalidateQueries({ queryKey: ["attempts"] });
      nav(a.status === "submitted" ? `/results/${a.id}` : `/exam/${a.id}`);
    },
  });
  return (
    <article className="exam-card">
      <div className="exam-card-top">
        <div className="subject-icon">
          <BookOpen size={25} />
        </div>
        <Pill tone={attempt?.status === "in_progress" ? "amber" : "green"}>
          {attempt?.status === "in_progress"
            ? "Davom etmoqda"
            : attempt?.status === "submitted"
              ? "Yakunlangan"
              : "Sinov imtihoni"}
        </Pill>
      </div>
      <div className="exam-subject">{exam.subject}</div>
      <h3>{exam.title}</h3>
      <p>
        {exam.description ||
          "Bilimingizni tekshiring va tayyorgarlik darajangizni aniqlang."}
      </p>
      <div className="exam-meta">
        <span>
          <FileText size={15} />
          {exam.question_count} ta savol
        </span>
        <span>
          <Clock3 size={15} />
          {exam.duration_minutes} daqiqa
        </span>
        {exam.essay_required && (
          <span>
            <Layers size={15} />
            Esse
          </span>
        )}
      </div>
      {start.error && <ErrorBox error={start.error} />}
      <div className="exam-card-bottom">
        {attempt?.status === "submitted" ? (
          <Link className="button secondary full" to={`/results/${attempt.id}`}>
            Natijani ko‘rish
            <ArrowRight size={17} />
          </Link>
        ) : (
          <button
            className="button primary full"
            disabled={start.isPending}
            onClick={() => (attempt ? start.mutate() : setConfirm(true))}
          >
            {start.isPending
              ? "Ochilmoqda…"
              : attempt
                ? "Davom ettirish"
                : "Testni boshlash"}
            <ArrowRight size={17} />
          </button>
        )}
      </div>
      {confirm && (
        <div className="modal-backdrop">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`start-${exam.id}`}
          >
            <h2 id={`start-${exam.id}`}>Imtihonga tayyormisiz?</h2>
            <p>
              {exam.question_count} ta savol uchun {exam.duration_minutes}{" "}
              daqiqa beriladi. Boshlangandan so‘ng vaqt to‘xtamaydi. Har bir
              imtihon uchun bitta urinish mavjud.
            </p>
            <div className="button-row">
              <button
                className="button secondary"
                onClick={() => setConfirm(false)}
              >
                Bekor qilish
              </button>
              <button
                className="button primary"
                disabled={start.isPending}
                onClick={() => start.mutate()}
              >
                Boshlash
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
