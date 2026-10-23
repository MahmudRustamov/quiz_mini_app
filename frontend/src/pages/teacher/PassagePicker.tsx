import { useState } from "react";
import type { Exam } from "../../types";

export type Passage = NonNullable<Exam["passages"]>[number];
export type PassageActions = {
  passages?: Passage[];
  onCreatePassage?: (
    value: Pick<Passage, "title" | "text">,
  ) => Promise<Passage | null>;
  onDeletePassage?: (id: string) => Promise<boolean>;
};
export default function PassagePicker({
  value,
  onChange,
  passages = [],
  onCreatePassage,
  onDeletePassage,
}: PassageActions & {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [title, setTitle] = useState(""),
    [text, setText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const passage = passages.find((p) => p.id === value);
  return (
    <div className="passage-picker kind-fields">
      <label className="field">
        O‘qish matni
        <select
          aria-label="O‘qish matni"
          value={value || ""}
          onChange={(e) => {
            onChange(e.target.value || null);
            setConfirmDelete(false);
          }}
        >
          <option value="">Matnsiz</option>
          {value && !passage && (
            <option value={value}>Mavjud matn ({value})</option>
          )}
          {passages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title || "O‘qish uchun matn"}
            </option>
          ))}
        </select>
      </label>
      {passage && (
        <>
          <details className="passage">
            <summary>{passage.title || "O‘qish uchun matn"}</summary>
            <p>{passage.text}</p>
          </details>
          {onDeletePassage && (
            <div>
              {confirmDelete ? (
                <>
                  <p>
                    Matn o‘chirilsinmi? Savolda ishlatilayotgan matnni avval
                    savoldan ajrating va savolni saqlang.
                  </p>
                  <div className="button-row">
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => setConfirmDelete(false)}
                    >
                      Bekor qilish
                    </button>
                    <button
                      type="button"
                      className="button danger"
                      onClick={() =>
                        void (async () => {
                          if (await onDeletePassage(passage.id)) {
                            onChange(null);
                            setConfirmDelete(false);
                          }
                        })()
                      }
                    >
                      Matnni o‘chirishni tasdiqlash
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  className="text-link"
                  onClick={() => setConfirmDelete(true)}
                >
                  Matnni o‘chirish
                </button>
              )}
            </div>
          )}
        </>
      )}
      {onCreatePassage && (
        <details>
          <summary>Yangi o‘qish matni</summary>
          <div className="kind-fields">
            <label className="field">
              Matn nomi
              <input
                aria-label="Matn nomi"
                maxLength={250}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="field">
              Matn
              <textarea
                aria-label="Matn"
                rows={6}
                maxLength={100000}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="button secondary"
              disabled={!text.trim()}
              onClick={() =>
                void (async () => {
                  const created = await onCreatePassage({ title, text });
                  if (created) {
                    onChange(created.id);
                    setTitle("");
                    setText("");
                  }
                })()
              }
            >
              Matnni saqlash
            </button>
          </div>
        </details>
      )}
    </div>
  );
}
