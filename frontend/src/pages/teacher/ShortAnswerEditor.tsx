import type { EditorProps } from "./questionModel";
import { AcceptedAnswers, ReviewToggle, WeightField } from "./PartFields";
export default function ShortAnswerEditor({ value, onChange, errors }: EditorProps) {
  const part = value.parts[0], update = (p: typeof part) => onChange({ ...value, parts: [p] });
  return <div className="kind-fields">
    <AcceptedAnswers part={part} onChange={update} errors={errors} path="parts.0" />
    <WeightField part={part} onChange={update} errors={errors} path="parts.0" />
    <label className="check-field"><input type="checkbox" checked={part.case_sensitive} onChange={e => update({ ...part, case_sensitive: e.target.checked })} />Katta-kichik harfni farqlash</label>
    <ReviewToggle part={part} onChange={update} />
  </div>;
}
