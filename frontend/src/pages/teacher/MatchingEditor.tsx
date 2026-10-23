import { newPart, type EditorProps } from "./questionModel";
import { errorProps, FieldError, WeightField } from "./PartFields";
import ImageField from "./ImageField";
function unused(prefix: string, used: string[]) { let n = 1; while (used.includes(`${prefix}${n}`)) n++; return `${prefix}${n}`; }
export default function MatchingEditor({ value, onChange, errors, onUpload }: EditorProps) {
  const add = () => {
    const label = unused("R", value.options.map(o => o.label));
    onChange({ ...value, options: [...value.options, { label, text: "", image_path: null }], parts: [...value.parts, { ...newPart(unused("p", value.parts.map(p => p.label))), accepted: [label] }] });
  };
  return <div className="kind-fields">
    {value.parts.map((part, i) => {
      const optionIndex = value.options.findIndex(o => o.label === part.accepted[0]);
      const updateOption = (fields: Partial<QuestionOption>) => {
        if (optionIndex >= 0) onChange({ ...value, options: value.options.map((o, j) => j === optionIndex ? { ...o, ...fields } : o) });
        else {
          const label = unused("R", value.options.map(o => o.label));
          onChange({ ...value, options: [...value.options, { label, text: "", image_path: null, ...fields }], parts: value.parts.map((p, j) => i === j ? { ...p, accepted: [label] } : p) });
        }
      };
      return <div className="matching-pair" key={part.label}>
        <div className="pair-columns">
          <label className="field">Chap matn ({part.label})<textarea aria-label={`Chap matn (${part.label})`} {...errorProps(errors, `parts.${i}.prompt`)} rows={2} maxLength={10000} value={part.prompt} onChange={e => onChange({ ...value, parts: value.parts.map((p, j) => i === j ? { ...p, prompt: e.target.value } : p) })} /><FieldError errors={errors} path={`parts.${i}.prompt`} /></label>
          <div><label className="field">Mos o‘ng matn ({part.label})<textarea aria-label={`Mos o‘ng matn (${part.label})`} {...errorProps(errors, `options.${optionIndex}.text`)} rows={2} maxLength={10000} value={value.options[optionIndex]?.text || ""} onChange={e => updateOption({ text: e.target.value })} /><FieldError errors={errors} path={`options.${optionIndex}.text`} /></label>
            <ImageField label={`${part.label} mos variant rasmi`} paths={value.options[optionIndex]?.image_path ? [value.options[optionIndex].image_path!] : []} onUpload={onUpload} onChange={paths => updateOption({ image_path: paths[0] || null })} /><FieldError errors={errors} path={`options.${optionIndex}.image_path`} />
          </div>
        </div>
        <div className="pair-controls"><WeightField part={part} errors={errors} path={`parts.${i}`} onChange={updated => onChange({ ...value, parts: value.parts.map((p, j) => i === j ? updated : p) })} />
          <button type="button" className="text-link" aria-label={`${part.label} juftligini o‘chirish`} onClick={() => {
            const parts = value.parts.filter((_, j) => i !== j);
            onChange({ ...value, parts, options: value.options.filter(o => o.label !== part.accepted[0] || parts.some(p => p.accepted.includes(o.label))) });
          }}>O‘chirish</button>
        </div><FieldError errors={errors} path={`parts.${i}.accepted`} />
      </div>;
    })}
    <button type="button" className="text-link" disabled={value.parts.length >= 50 || value.options.length >= 50} onClick={add}>+ Juftlik</button>
    <FieldError errors={errors} path="parts" />
  </div>;
}
type QuestionOption = EditorProps["value"]["options"][number];
