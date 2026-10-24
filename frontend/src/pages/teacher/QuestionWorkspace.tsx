import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { Exam, ImportDoc, Question } from "../../types";
import { api, post, put } from "../../services/api";
import { Empty, ErrorBox, SectionTitle } from "../../components/ui";
import DeleteConfirmation from "./DeleteConfirmation";
import ImportReview from "./ImportReview";
import type { Passage } from "./PassagePicker";
import QuestionEditor from "./QuestionEditor";
import QuestionRow from "./QuestionRow";
import { blankQuestion, draftKey, encode, inspectBuffer, readDraft, toInput, validateQuestion, type QuestionInput } from "./questionModel";
import "./question-editor.css";

type Placement = { anchorId: string; after: boolean };
export default function QuestionWorkspace({ exam, onRefresh, importDocs, disabled = false, onBusyChange }: { exam: Exam; onRefresh: () => Promise<void>; importDocs?: ImportDoc[]; disabled?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [buffers, setBuffers] = useState<Record<string, string>>(() => Object.fromEntries([null, ...(exam.questions || []).map(q => q.id)].flatMap(id => {
    const buffer = readDraft(exam.id, id); return buffer === undefined ? [] : [[id || "new", buffer]];
  })));
  const [working, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const busy = working || disabled;
  useEffect(() => { onBusyChange?.(working); return () => onBusyChange?.(false); }, [working, onBusyChange]);
  const [storageError, setStorageError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Question | null>(null);
  const insertionKey = `${draftKey(exam.id, null)}:placement`;
  const [insertion, setInsertion] = useState<Placement | null>(() => {
    try { const value = JSON.parse(localStorage.getItem(insertionKey) || "null"); return value && typeof value.anchorId === "string" && typeof value.after === "boolean" ? { anchorId: value.anchorId, after: value.after } : null; }
    catch { return null; }
  });
  const [pendingPlacement, setPendingPlacement] = useState<{ id: string; target: Placement } | null>(null);
  const [moveEntry, setMoveEntry] = useState<{ id: string; value: string } | null>(null);
  const questions = exam.questions || [], question = questions.find(q => q.id === selected);
  const anchor = questions.find(q => q.id === insertion?.anchorId);
  const activeId = question?.id || null, slot = activeId || "new", position = question?.position ?? (anchor ? anchor.position + (insertion!.after ? 1 : 0) : questions.length + 1);
  const buffer = buffers[slot] ?? encode(question ? toInput(question) : blankQuestion(position));
  const editable = exam.status === "draft";
  const validity = useMemo(() => new Map((exam.questions || []).map(q => {
    const { data, errors } = inspectBuffer(buffers[q.id] ?? encode(toInput(q)), q.position, exam.id);
    return [q.id, { ready: !Object.keys(errors).length, missingKey: !data?.parts.length || data.parts.some(p => !p.accepted.some(a => a.trim())) }];
  })), [buffers, exam.questions, exam.id]);
  const ready = questions.filter(q => validity.get(q.id)?.ready).length;
  const setInsertTarget = (target: Placement | null) => {
    setInsertion(target);
    try { if (target) localStorage.setItem(insertionKey, JSON.stringify(target)); else localStorage.removeItem(insertionKey); }
    catch { setStorageError("Yangi savolning joylashuvini qurilmada saqlab bo‘lmadi."); }
  };
  const update = (value: string) => {
    setBuffers(old => ({ ...old, [slot]: value }));
    try { localStorage.setItem(draftKey(exam.id, activeId), value); setStorageError(""); }
    catch { setStorageError("Qoralamani qurilmada saqlab bo‘lmadi. Sahifani yopishdan oldin savolni saqlang."); }
    setMessage("");
  };
  const forget = (id: string | null) => {
    setBuffers(old => { const next = { ...old }; delete next[id || "new"]; return next; });
    try { localStorage.removeItem(draftKey(exam.id, id)); } catch { /* The in-memory buffer still clears after a successful write. */ }
  };
  const orderPath = `/teacher/exams/${exam.id}/questions/order`;
  const placedIds = (ids: string[], id: string, target: Placement) => {
    const ordered = ids.filter(qid => qid !== id), index = ordered.indexOf(target.anchorId);
    if (index < 0) throw new Error("Joylashuv uchun tanlangan savol topilmadi. Boshqa joyni tanlang.");
    ordered.splice(index + (target.after ? 1 : 0), 0, id); return ordered;
  };
  const reorder = async (ids: string[]) => {
    if (busy || !editable) return;
    setBusy(true); setError(""); setMessage("");
    try { await put(orderPath, { question_ids: ids }); await onRefresh(); setMessage("Savollar tartibi saqlandi"); }
    catch (e) { setError(e instanceof Error ? e.message : "Tartib saqlanmadi."); }
    finally { setBusy(false); }
  };
  const moveTo = (q: Question, raw: string) => {
    setMoveEntry(null);
    const value = Number(raw);
    if (busy || !editable || !raw.trim() || !Number.isInteger(value)) return;
    const target = Math.max(1, Math.min(questions.length, value));
    if (target === q.position) return;
    const ids = questions.filter(item => item.id !== q.id).map(item => item.id);
    ids.splice(target - 1, 0, q.id); void reorder(ids);
  };
  const createAtEnd = async (payload: QuestionInput, target: Placement | null, clearNew: boolean) => {
    if (busy || !editable) return;
    const data = { ...payload, position: questions.length + 1 }, errors = validateQuestion(data, exam.id);
    if (Object.keys(errors).length) { setError(`Avval savolni to‘ldirib saqlang: ${Object.values(errors)[0]}`); return; }
    if (target && !questions.some(q => q.id === target.anchorId)) { setError("Joylashuv uchun tanlangan savol topilmadi. Boshqa joyni tanlang."); return; }
    setBusy(true); setError(""); setMessage("");
    let saved: Question | undefined;
    try {
      // The occupied insertion slot is never passed to POST; only the order endpoint moves it there.
      saved = await post<Question>(`/teacher/exams/${exam.id}/questions`, data);
      if (clearNew) { forget(null); setInsertTarget(null); }
      if (target) await put(orderPath, { question_ids: placedIds([...questions.map(q => q.id), saved.id], saved.id, target) });
      setMessage(clearNew ? "Savol saqlandi" : "Savol nusxasi yaratildi");
    } catch (e) {
      const detail = e instanceof Error ? e.message : "Savol saqlanmadi.";
      if (saved && target) { setPendingPlacement({ id: saved.id, target }); setError(`Savol oxirida saqlandi, joylashuvi saqlanmadi. Joylashni qayta urinib ko‘ring. ${detail}`); }
      else setError(detail);
    } finally {
      if (saved) {
        try { await onRefresh(); setSelected(saved.id); }
        catch { setError("Savol saqlandi, ro‘yxat yangilanmadi. Sahifani qayta yuklang."); }
      }
      setBusy(false);
    }
  };
  const save = async (payload: QuestionInput) => {
    if (!activeId) return createAtEnd(payload, insertion, true);
    if (busy || !editable || Object.keys(validateQuestion(payload, exam.id)).length) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const saved = await put<Question>(`/teacher/exams/${exam.id}/questions/${activeId}`, payload);
      forget(activeId); await onRefresh(); setSelected(saved.id); setMessage("Savol saqlandi");
    } catch (e) { setError(e instanceof Error ? e.message : "Savol saqlanmadi."); }
    finally { setBusy(false); }
  };
  const uploadImage = async (file: File): Promise<string | null> => {
    if (busy || !editable) return null;
    setBusy(true); setError(""); setMessage("");
    try {
      const body = new FormData(); body.append("file", file);
      const result = await api<{ path: string }>(`/teacher/exams/${exam.id}/images`, { method: "POST", body });
      return result.path;
    } catch (e) { setError(e instanceof Error ? e.message : "Rasm yuklanmadi."); return null; }
    finally { setBusy(false); }
  };
  const createPassage = async (value: Pick<Passage, "title" | "text">): Promise<Passage | null> => {
    if (busy || !editable) return null;
    setBusy(true); setError(""); setMessage("");
    try {
      const passage = await post<Passage>(`/teacher/exams/${exam.id}/passages`, value);
      await onRefresh(); setMessage("Matn saqlandi"); return passage;
    } catch (e) { setError(e instanceof Error ? e.message : "Matn saqlanmadi."); return null; }
    finally { setBusy(false); }
  };
  const deletePassage = async (id: string): Promise<boolean> => {
    if (busy || !editable) return false;
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/teacher/exams/${exam.id}/passages/${id}`, { method: "DELETE" });
      await onRefresh(); setMessage("Matn o‘chirildi"); return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Matn o‘chirilmadi."); return false; }
    finally { setBusy(false); }
  };
  const editor = <QuestionEditor key={slot} buffer={buffer} position={position} editing={!!question} editable={editable} busy={busy} onChange={update} onSave={save} onUpload={uploadImage} examId={exam.id} passages={exam.passages} onCreatePassage={createPassage} onDeletePassage={deletePassage} />;
  return <>
    {error && <ErrorBox error={error} />}{storageError && <ErrorBox error={storageError} />}
    {message && <div className="success-note" role="status">{message}</div>}
    {!activeId && insertion && <p className="info-note">Yangi savol {anchor ? `${anchor.position}-savoldan ${insertion.after ? "keyin" : "oldin"}` : "tanlangan joyga"} qo‘shiladi. Saqlashgacha faqat qurilmadagi qoralama o‘zgaradi.</p>}
    {editable && pendingPlacement && <button className="button secondary" disabled={busy} onClick={() => void (async () => {
      if (busy) return;
      setBusy(true); setError(""); setMessage("");
      try {
        await put(orderPath, { question_ids: placedIds(questions.map(q => q.id), pendingPlacement.id, pendingPlacement.target) });
        await onRefresh(); setSelected(pendingPlacement.id); setPendingPlacement(null); setMessage("Savol joylashuvi saqlandi");
      } catch (e) { setError(e instanceof Error ? e.message : "Joylashuv saqlanmadi."); }
      finally { setBusy(false); }
    })()}>Joylashni qayta urinish</button>}
    {pendingDelete && <DeleteConfirmation text={`${pendingDelete.position}-savol o‘chiriladi va qolgan savollar raqami yangilanadi. Bu amalni qaytarib bo‘lmaydi.`} busy={busy} error={error} onCancel={() => setPendingDelete(null)} onConfirm={() => void (async () => {
      setBusy(true); setError(""); setMessage("");
      try {
        await api(`/teacher/exams/${exam.id}/questions/${pendingDelete.id}`, { method: "DELETE" });
        forget(pendingDelete.id); if (selected === pendingDelete.id) setSelected(null);
        if (insertion?.anchorId === pendingDelete.id) setInsertTarget(null);
        if (pendingPlacement?.id === pendingDelete.id) setPendingPlacement(null);
        setPendingDelete(null); await onRefresh(); setMessage("Savol o‘chirildi");
      } catch (e) { setError(e instanceof Error ? e.message : "Savol o‘chirilmadi."); }
      finally { setBusy(false); }
    })()} />}
    <div className={`editor-columns${importDocs ? " import-review-workspace" : ""}`}>
      <div className="panel question-list-panel"><SectionTitle title="Savollar"><button className="text-link" disabled={!editable || busy || questions.length >= 500} onClick={() => { setSelected(null); setInsertTarget(null); setError(""); setMessage(""); }}>Yangi<Plus size={16} /></button></SectionTitle>
        <p className="muted small" aria-label="Savollar holati">{ready} tayyor · {questions.length - ready} tekshiruv kerak</p>
        {questions.length ? questions.map(q => {
          const state = validity.get(q.id);
          return <QuestionRow key={q.id} question={q} count={questions.length} active={activeId === q.id} ready={!!state?.ready}
            flagMissingKey={!!importDocs && !!state?.missingKey} editable={editable} busy={busy} full={questions.length >= 500}
            moveValue={moveEntry?.id === q.id ? moveEntry.value : String(q.position)} onMoveValueChange={value => setMoveEntry({ id: q.id, value })} onMoveTo={raw => moveTo(q, raw)}
            onSelect={() => { setSelected(q.id); setError(""); setMessage(""); }}
            onInsert={after => { setInsertTarget({ anchorId: q.id, after }); setSelected(null); setError(""); setMessage(""); }}
            onDuplicate={() => void createAtEnd(toInput(q), { anchorId: q.id, after: true }, false)}
            onDelete={() => { setError(""); setPendingDelete(q); }} />;
        }) : <Empty title="Savol yo‘q" description="Savol qo‘shing yoki import qiling." />}
      </div>
      {importDocs ? <ImportReview documents={importDocs}>{editor}</ImportReview> : editor}
    </div>
  </>;
}
