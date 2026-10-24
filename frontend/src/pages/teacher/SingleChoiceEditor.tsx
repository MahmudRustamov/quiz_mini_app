import type { EditorProps } from "./questionModel";
import { errorProps, FieldError, WeightField } from "./PartFields";
import ImageField from "./ImageField";
export default function SingleChoiceEditor({ value, onChange, errors, onUpload }: EditorProps) {
  const part = value.parts[0];
  // Option images belong to the picture-question kind. Elsewhere they appear only when an
  // option already carries one, so data a student would see is never hidden from the teacher.
  const optionImages = value.kind === "image" || value.options.some(o => o.image_path);
  return <div className="kind-fields">
    {value.options.map((option, i) => <div className="option-editor-row" key={option.label}><label className="field">{option.label} variant
      <textarea aria-label={`${option.label} variant`} {...errorProps(errors, `options.${i}.text`)} rows={2} maxLength={10000} value={option.text} onChange={e => onChange({ ...value, options: value.options.map((o, j) => i === j ? { ...o, text: e.target.value } : o) })} />
      <FieldError errors={errors} path={`options.${i}.text`} />
    </label>{optionImages && <ImageField label={`${option.label} variant rasmi`} paths={option.image_path ? [option.image_path] : []} onUpload={onUpload} onChange={paths => onChange({ ...value, options: value.options.map((o, j) => i === j ? { ...o, image_path: paths[0] || null } : o) })} />}<FieldError errors={errors} path={`options.${i}.image_path`} /></div>)}
    <WeightField part={part} errors={errors} path="parts.0" onChange={p => onChange({ ...value, parts: [p] })} />
    <fieldset className="choice-key"><legend>To‘g‘ri javob</legend>{value.options.map(option => <label className="check-field" key={option.label}>
      <input type="radio" name="correct-option" value={option.label} checked={part.accepted[0] === option.label} onChange={() => onChange({ ...value, parts: [{ ...part, accepted: [option.label] }] })} />{option.label}
    </label>)}<FieldError errors={errors} path="parts.0.accepted" /></fieldset>
  </div>;
}
