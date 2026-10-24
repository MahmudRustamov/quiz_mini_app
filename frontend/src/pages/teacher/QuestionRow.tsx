import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, Check, Copy, CornerDownLeft, EllipsisVertical, Trash2 } from "lucide-react";
import { Pill } from "../../components/ui";
import type { Question } from "../../types";
import { kinds } from "./questionModel";

export type QuestionRowProps = {
  question: Question; count: number; active: boolean; ready: boolean; flagMissingKey: boolean;
  editable: boolean; busy: boolean; full: boolean; moveValue: string;
  onSelect: () => void; onMoveValueChange: (value: string) => void; onMoveTo: (raw: string) => void;
  onInsert: (after: boolean) => void; onDuplicate: () => void; onDelete: () => void;
};

// One compact row per question. Everything that changes the order, adds a neighbour or deletes
// lives behind the three-dot menu, so a 50-question list stays scannable.
export default function QuestionRow({ question: q, count, active, ready, flagMissingKey, editable, busy, full, moveValue, onSelect, onMoveValueChange, onMoveTo, onInsert, onDuplicate, onDelete }: QuestionRowProps) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);

  // The menu is position: fixed so the scrolling question list cannot clip it. Every action
  // closes it: a move shifts the row, and a menu that followed would jump under the cursor.
  const place = () => {
    const anchor = trigger.current?.getBoundingClientRect(), box = menu.current;
    if (!anchor || !box) return;
    const gap = 6, margin = 8, width = box.offsetWidth, height = box.offsetHeight;
    const left = Math.max(margin, Math.min(anchor.right - width, window.innerWidth - width - margin));
    const below = anchor.bottom + gap + height <= window.innerHeight - margin;
    const top = below ? anchor.bottom + gap : Math.max(margin, anchor.top - gap - height);
    setAt(old => old && old.top === top && old.left === left ? old : { top, left });
  };
  useLayoutEffect(() => { if (open) place(); });
  useEffect(() => {
    if (!open) { setAt(null); return; }
    // Scrolling or resizing keeps the menu attached to its button; it closes only once the
    // button itself has left the screen or the scrolling list.
    const follow = () => {
      const button = trigger.current?.getBoundingClientRect(), rail = trigger.current?.closest(".question-list-panel")?.getBoundingClientRect();
      const gone = !button || button.bottom < 0 || button.top > window.innerHeight || (!!rail && (button.bottom < rail.top || button.top > rail.bottom));
      if (gone) setOpen(false); else place();
    };
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("mousedown", outside); document.addEventListener("touchstart", outside); document.addEventListener("keydown", escape);
    window.addEventListener("resize", follow); window.addEventListener("scroll", follow, true);
    return () => {
      document.removeEventListener("mousedown", outside); document.removeEventListener("touchstart", outside); document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", follow); window.removeEventListener("scroll", follow, true);
    };
  }, [open]);
  // Keyboard users land inside the menu. preventScroll matters: a scroll would close it again.
  const placed = !!at;
  useEffect(() => {
    if (open && placed) menu.current?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled)")?.focus({ preventScroll: true });
  }, [open, placed]);

  const done = (action: () => void) => () => { action(); setOpen(false); };
  return <div className={`question-row${active ? " active" : ""}${open ? " menu-open" : ""}`}>
    <button type="button" className="question-row-main" aria-label={`${q.position} ${q.text}`} aria-current={active ? "true" : undefined} disabled={busy} onClick={onSelect}>
      <span className="question-row-no">{q.position}</span>
      <span className="question-row-body">
        <strong title={q.text}>{q.text}</strong>
        <small>{kinds[q.kind as keyof typeof kinds] ?? q.kind} · {q.topic}</small>
        <span className="question-row-flags">
          <Pill tone={ready ? "green" : "amber"}>{ready ? "Tayyor" : "Tekshiruv kerak"}</Pill>
          {flagMissingKey && <Pill tone="amber">Javob kaliti yo‘q</Pill>}
        </span>
      </span>
    </button>
    {editable && <button ref={trigger} type="button" className="question-row-more" aria-label={`${q.position}-savol amallari`} aria-haspopup="true" aria-expanded={open} disabled={busy} onClick={() => setOpen(value => !value)}><EllipsisVertical size={17} /></button>}
    {open && <div ref={menu} className="question-menu" role="group" aria-label={`${q.position}-savol amallari`} style={at ? { top: at.top, left: at.left } : { top: 0, left: 0, visibility: "hidden" }}>
      <p className="question-menu-title">Joylashuv</p>
      <button type="button" className="question-menu-item" aria-label={`${q.position}-savolni yuqoriga ko‘chirish`} disabled={busy || q.position === 1} onClick={done(() => onMoveTo(String(q.position - 1)))}><ArrowUp size={16} />Yuqoriga ko‘chirish</button>
      <button type="button" className="question-menu-item" aria-label={`${q.position}-savolni pastga ko‘chirish`} disabled={busy || q.position === count} onClick={done(() => onMoveTo(String(q.position + 1)))}><ArrowDown size={16} />Pastga ko‘chirish</button>
      {/* Applied only by Enter or the confirm button. Closing the menu by clicking away cancels the typed slot. */}
      <div className="question-menu-move"><CornerDownLeft size={16} /><span>O‘rin</span>
        <input aria-label={`${q.position}-savolni ko‘chirish manzili`} type="number" inputMode="numeric" min={1} max={count} step={1} disabled={busy} value={moveValue}
          onChange={e => onMoveValueChange(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); onMoveTo(e.currentTarget.value); setOpen(false); } }} />
        <button type="button" className="question-menu-go" aria-label={`${q.position}-savolni shu o‘ringa ko‘chirish`} disabled={busy} onClick={done(() => onMoveTo(moveValue))}><Check size={15} /></button>
      </div>
      <p className="question-menu-title">Qo‘shish</p>
      <button type="button" className="question-menu-item" disabled={busy || full} onClick={done(() => onInsert(false))}><ArrowUpToLine size={16} />Yuqorisiga qo‘shish</button>
      <button type="button" className="question-menu-item" disabled={busy || full} onClick={done(() => onInsert(true))}><ArrowDownToLine size={16} />Pastiga qo‘shish</button>
      <button type="button" className="question-menu-item" disabled={busy || full} onClick={done(onDuplicate)}><Copy size={16} />Nusxa</button>
      <hr />
      <button type="button" className="question-menu-item danger" aria-label={`${q.position}-savolni o‘chirish`} disabled={busy} onClick={done(onDelete)}><Trash2 size={16} />O‘chirish</button>
    </div>}
  </div>;
}
