import { useId } from "react";
import { Check } from "lucide-react";
import type { Exam, Question } from "../types";
import { ProtectedImage } from "./ui";

// Student-visible fields only: keys and attempt state do not belong in this renderer.
export type QuestionBodyData = Pick<
  Question,
  "position" | "kind" | "text" | "topic" | "image_paths" | "options"
> & {
  parts: Pick<Question["parts"][number], "label" | "prompt" | "weight">[];
};
export default function QuestionBody({
  question: q,
  answers: answer,
  onAnswer,
  passage,
}: {
  question: QuestionBodyData;
  answers: Record<string, string>;
  onAnswer: (answers: Record<string, string>) => void;
  passage?: NonNullable<Exam["passages"]>[number];
}) {
  const inputId = useId();
  return (
    <>
      <div className="question-topic">{q.topic}</div>
      {passage && (
        <details className="passage" open>
          <summary>{passage.title || "O‘qish uchun matn"}</summary>
          <p>{passage.text}</p>
        </details>
      )}
      <h2 className="question-text">{q.text}</h2>
      {q.image_paths.map((path) => (
        <ProtectedImage
          path={path}
          alt={`${q.position}-savol rasmi`}
          key={path}
        />
      ))}
      {q.kind === "matching" && q.options.some((o) => o.image_path) && (
        <div
          className="matching-option-images"
          aria-label="Moslashtirish variantlari"
        >
          {q.options.map((option, index) => (
            <div className="matching-option-card" key={option.label}>
              {/* Numbered by the order served, never by the authoring label. */}
              <strong>{index + 1}</strong>
              {option.text && <p>{option.text}</p>}
              {option.image_path && (
                <ProtectedImage
                  path={option.image_path}
                  alt={`${index + 1} variant rasmi`}
                />
              )}
            </div>
          ))}
        </div>
      )}
      {q.parts.map((part) => (
        <div className="question-part" key={part.label}>
          {part.label !== "main" && (
            <label className="part-label">
              {part.label} qism {part.prompt && `— ${part.prompt}`}
            </label>
          )}
          {q.kind !== "matching" && q.options.length > 0 ? (
            <div
              className="answer-options"
              role="radiogroup"
              aria-label={`${q.position}-savol ${part.label}`}
            >
              {q.options.map((option) => (
                <label
                  className={`answer-option ${answer[part.label] === option.label ? "chosen" : ""}`}
                  key={option.label}
                >
                  <input
                    type="radio"
                    name={`${inputId}-${part.label}`}
                    checked={answer[part.label] === option.label}
                    onChange={() =>
                      onAnswer({
                        ...answer,
                        [part.label]: option.label,
                      })
                    }
                  />
                  <span className="option-letter">{option.label}</span>
                  <span className="option-content">
                    {option.text}
                    {option.image_path && (
                      <ProtectedImage
                        path={option.image_path}
                        alt={`${option.label} variant rasmi`}
                      />
                    )}
                  </span>
                  {answer[part.label] === option.label && (
                    <Check className="option-check" size={18} />
                  )}
                </label>
              ))}
            </div>
          ) : q.kind === "matching" && q.options.length ? (
            <select
              aria-label={`${part.prompt || part.label} uchun javob`}
              value={answer[part.label] || ""}
              onChange={(e) =>
                onAnswer({
                  ...answer,
                  [part.label]: e.target.value,
                })
              }
            >
              <option value="">Mos javobni tanlang</option>
              {/* The value stays the stored label; only the shown number follows the served order. */}
              {q.options.map((o, index) => (
                <option key={o.label} value={o.label}>
                  {index + 1}. {o.text || (o.image_path ? "Rasmli variant" : "")}
                </option>
              ))}
            </select>
          ) : (
            <textarea
              aria-label={`${q.position}-savol ${part.label} javobi`}
              placeholder="Javobingizni yozing…"
              rows={3}
              maxLength={10000}
              value={answer[part.label] || ""}
              onChange={(e) =>
                onAnswer({
                  ...answer,
                  [part.label]: e.target.value,
                })
              }
            />
          )}
          <small className="muted">{part.weight} ball</small>
        </div>
      ))}
    </>
  );
}
