import type { Issues, PartInput } from "./questionModel";

export function FieldError({ errors, path }: { errors: Issues; path: string }) {
  return errors[path] ? <small id={`question-error-${path}`} className="field-error" role="alert">{errors[path]}</small> : null;
}
export const errorProps = (errors: Issues, path: string) => ({ "aria-invalid": !!errors[path], "aria-describedby": errors[path] ? `question-error-${path}` : undefined });
export function WeightField({ part, onChange, errors, path }: { part: PartInput; onChange: (p: PartInput) => void; errors: Issues; path: string }) {
  return <label className="field">Vazn ({part.label})<input aria-label={`Vazn (${part.label})`} {...errorProps(errors, `${path}.weight`)} type="number" min="0" max="100" step="any" value={part.weight} onChange={e => onChange({ ...part, weight: Number(e.target.value) })} /><FieldError errors={errors} path={`${path}.weight`} /></label>;
}
export function AcceptedAnswers({ part, onChange, errors, path }: { part: PartInput; onChange: (p: PartInput) => void; errors: Issues; path: string }) {
  return <div className="accepted-answers"><strong>Qabul qilinadigan javoblar ({part.label})</strong>
    {part.accepted.map((answer, i) => <div className="answer-row" key={i}>
      <label className="field">{i + 1}-javob ({part.label})<input value={answer} onChange={e => onChange({ ...part, accepted: part.accepted.map((a, j) => i === j ? e.target.value : a) })} /></label>
      <button type="button" className="text-link" aria-label={`${part.label}: ${i + 1}-javobni o‘chirish`} onClick={() => onChange({ ...part, accepted: part.accepted.filter((_, j) => i !== j) })}>O‘chirish</button>
    </div>)}
    <button type="button" className="text-link" disabled={part.accepted.length >= 100} onClick={() => onChange({ ...part, accepted: [...part.accepted, ""] })}>+ Javob ({part.label})</button>
    <FieldError errors={errors} path={`${path}.accepted`} />
  </div>;
}
export function ReviewToggle({ part, onChange }: { part: PartInput; onChange: (p: PartInput) => void }) {
  return <label className="check-field"><input type="checkbox" checked={part.manual_review} onChange={e => onChange({ ...part, manual_review: e.target.checked })} />Qo‘lda tekshirish ({part.label})</label>;
}
