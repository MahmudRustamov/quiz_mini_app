import { useState, type FormEvent } from "react";
import { LoaderCircle, Save } from "lucide-react";
import { ErrorBox, Pill } from "../../components/ui";
import QuestionBody, { type QuestionBodyData } from "../../components/QuestionBody";
import PassagePicker, { type PassageActions } from "./PassagePicker";
import ImageField from "./ImageField";
import SingleChoiceEditor from "./SingleChoiceEditor";
import MatchingEditor from "./MatchingEditor";
import ShortAnswerEditor from "./ShortAnswerEditor";
import TwoPartEditor from "./TwoPartEditor";
import { errorProps, FieldError } from "./PartFields";
import { blankQuestion, canUseForm, encode, inspectBuffer, kinds, losesData, switchKind, type Kind, type QuestionInput, type UploadImage } from "./questionModel";

export default function QuestionEditor({ buffer, position, editing, editable, busy, onChange, onSave, onUpload, examId, passages, onCreatePassage, onDeletePassage }: PassageActions & {
  buffer: string; position: number; editing: boolean; editable: boolean; busy: boolean;
  onChange: (buffer: string) => void; onSave: (data: QuestionInput) => Promise<void>;
  onUpload?: UploadImage; examId?: string;
}) {
  const { data, errors } = inspectBuffer(buffer, position, examId), ready = !Object.keys(errors).length;
  const supported = data && canUseForm(data);
  const [view, setView] = useState(() => supported ? "form" : "json");
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, string>>({});
  const [pendingKind, setPendingKind] = useState<Kind | null>(null);
  // An untouched blank question is incomplete by definition; flagging it in red on open
  // reads as breakage. The key strip and the status pill already say what is missing.
  // A restored draft is not untouched: only a question still equal to its own blank counts as pristine.
  const [touched, setTouched] = useState(() => !data || JSON.stringify(data) !== JSON.stringify(blankQuestion(position, data.kind)));
  const shown: typeof errors = touched ? errors : {};
  const update = (value: QuestionInput) => { setTouched(true); setPreviewAnswers({}); onChange(encode(value)); };
  const changeKind = (kind: Kind) => {
    if (!data || kind === data.kind) return;
    if (losesData(data, kind)) setPendingKind(kind);
    else { update(switchKind(data, kind)); setView("form"); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); if (data && ready && editable && !busy && !pendingKind) void onSave(data); };
  const editors = { single: SingleChoiceEditor, matching: MatchingEditor, short: ShortAnswerEditor, two_part: TwoPartEditor, reading: SingleChoiceEditor, image: SingleChoiceEditor };
  const Editor = data && data.kind in editors ? editors[data.kind as keyof typeof editors] : null;
  // Project only student-facing data. Preview answers never enter the authoring buffer.
  const preview: QuestionBodyData | undefined = data && {
    position: data.position, kind: data.kind, text: data.text, topic: data.topic,
    image_paths: data.image_paths, options: data.options,
    parts: data.parts.map(({ label, prompt, weight }) => ({ label, prompt, weight })),
  };
  return <form className="panel question-editor" onSubmit={submit} noValidate aria-label="Savol muharriri">
    <div className="question-editor-heading"><h2>{editing ? "Savolni tahrirlash" : "Yangi savol"}</h2><span className="muted small">{position}-savol · raqam avtomatik</span></div>
    <div className="question-editor-toolbar">
      <label className="field">Savol turi<select aria-label="Savol turi" value={data?.kind || ""} disabled={!editable || busy || !data} onChange={e => changeKind(e.target.value as Kind)}>
        {!data && <option value="">JSONni tekshiring</option>}{Object.entries(kinds).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
      </select></label>
      <div className="tabs" role="tablist" aria-label="Muharrir ko‘rinishi">
        <button type="button" role="tab" aria-selected={view === "form" && !!supported} disabled={!supported} className={view === "form" && supported ? "selected" : ""} onClick={() => setView("form")}>Forma</button>
        <button type="button" role="tab" aria-selected={view === "json" || (!supported && view !== "preview")} className={view === "json" || (!supported && view !== "preview") ? "selected" : ""} onClick={() => setView("json")}>JSON</button>
        <button type="button" role="tab" aria-selected={view === "preview"} disabled={!data} className={view === "preview" ? "selected" : ""} onClick={() => setView("preview")}>Ko‘rish</button>
      </div>
    </div>
    {pendingKind && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="kind-change-title">
      <h2 id="kind-change-title">Savol turini o‘zgartirasizmi?</h2><p>Variantlar, juftliklar yoki ortiqcha qismlar va ularning kalitlari yo‘qolishi mumkin. Matn, mavzu va mavjud rasmlar saqlanadi.</p>
      <div className="button-row"><button type="button" className="button secondary" onClick={() => setPendingKind(null)}>Bekor qilish</button><button type="button" className="button primary" onClick={() => {
        if (data) update(switchKind(data, pendingKind)); setView("form"); setPendingKind(null);
      }}>O‘zgartirish</button></div>
    </div></div>}
    <fieldset className="question-editor-body" disabled={view !== "preview" && (!editable || busy)}>
      {(!supported && data && view !== "preview") && <p className="info-note">Mavjud tuzilma oddiy formaga mos emas. Ma’lumotlarni yo‘qotmasdan JSON orqali tahrirlang.</p>}
      {view === "preview" && preview ? <section className="question-preview" aria-label="O‘quvchi ko‘rinishi" onKeyDown={e => { if (e.key === "Enter" && e.target instanceof HTMLInputElement) e.preventDefault(); }}>
        <p className="muted small">Sinab ko‘ring — bu javoblar saqlanmaydi.</p>
        <QuestionBody question={preview} answers={previewAnswers} onAnswer={setPreviewAnswers} passage={passages?.find(p => p.id === data?.passage_id)} />
      </section> : <>
      {view === "json" || (!supported && view !== "preview") ? <><label className="field">Savol tuzilishi<textarea aria-label="Savol tuzilishi" {...errorProps(shown, "json")} className="code-editor" rows={20} spellCheck={false} value={buffer} onChange={e => { setTouched(true); setPreviewAnswers({}); onChange(e.target.value); }} /><FieldError errors={shown} path="json" /></label>{data && <ImageField label="Savol rasmlari" paths={data.image_paths} maximum={20} onUpload={onUpload} onChange={paths => update({ ...data, image_paths: paths })} />}</> : data && Editor && <>
        <label className="field">Savol matni<textarea aria-label="Savol matni" {...errorProps(shown, "text")} rows={4} maxLength={50000} value={data.text} onChange={e => update({ ...data, text: e.target.value })} /><FieldError errors={shown} path="text" /></label>
        <ImageField label="Savol rasmlari" paths={data.image_paths} maximum={20} onUpload={onUpload} onChange={paths => update({ ...data, image_paths: paths })} />
        <label className="field">Mavzu<input aria-label="Mavzu" {...errorProps(shown, "topic")} maxLength={100} value={data.topic} onChange={e => update({ ...data, topic: e.target.value })} /><FieldError errors={shown} path="topic" /></label>
        {data.kind === "reading" && <PassagePicker passages={passages} value={data.passage_id} onChange={passage_id => update({ ...data, passage_id })} onCreatePassage={onCreatePassage} onDeletePassage={onDeletePassage} />}
        <Editor value={data} onChange={update} errors={shown} onUpload={onUpload} />
      </>}
      </>}
      {view !== "preview" && touched && !ready && !errors.json && <ul className="question-validation" aria-label="Tekshirish kerak">{Object.entries(errors).map(([path, message]) => <li key={path}>{message}</li>)}</ul>}
    </fieldset>
    <div className="question-answer-strip" aria-label="Javob kaliti">
      <div><strong>Javob kaliti</strong><div className="key-summary">{data?.parts.length ? data.parts.map((part, i) => <span key={`${part.label}-${i}`}>{part.label}: {part.accepted.join(" / ") || "kiritilmagan"}{part.manual_review ? " · qo‘lda tekshirish" : ""}</span>) : "Kalitni tekshiring"}</div></div>
      <Pill tone={ready ? "green" : "amber"}>{ready ? "Tayyor" : "Tekshiruv kerak"}</Pill>
      <button type="submit" className="button primary question-save-button" aria-busy={busy} disabled={!editable || busy || !ready || !!pendingKind}>
        <span className="question-save-icon" aria-hidden="true">{busy ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}</span>
        <span>{busy ? "Saqlanmoqda…" : "Savolni saqlash"}</span>
      </button>
    </div>
    {!editable && <ErrorBox error="Bu imtihonni tahrirlab bo‘lmaydi." />}
  </form>;
}
