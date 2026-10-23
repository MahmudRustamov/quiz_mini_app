import type { EditorProps, PartInput } from "./questionModel";
import { AcceptedAnswers, errorProps, FieldError, ReviewToggle, WeightField } from "./PartFields";
export default function TwoPartEditor({ value, onChange, errors }: EditorProps) {
  return <div className="kind-fields">{["A", "B"].map(label => {
    const i = value.parts.findIndex(p => p.label === label), part = value.parts[i];
    const update = (p: PartInput) => onChange({ ...value, parts: value.parts.map((old, j) => i === j ? p : old) });
    return <fieldset className="part-card" key={label}><legend>{label} qism</legend>
      <label className="field">{label} qism matni<textarea aria-label={`${label} qism matni`} {...errorProps(errors, `parts.${i}.prompt`)} rows={3} maxLength={10000} value={part.prompt} onChange={e => update({ ...part, prompt: e.target.value })} /><FieldError errors={errors} path={`parts.${i}.prompt`} /></label>
      <AcceptedAnswers part={part} onChange={update} errors={errors} path={`parts.${i}`} />
      <WeightField part={part} onChange={update} errors={errors} path={`parts.${i}`} />
      <ReviewToggle part={part} onChange={update} />
    </fieldset>;
  })}</div>;
}
