import { useState } from "react";
import { ProtectedImage } from "../../components/ui";
import type { UploadImage } from "./questionModel";

export default function ImageField({ label, paths, onChange, onUpload, maximum = 1 }: {
  label: string; paths: string[]; onChange: (paths: string[]) => void; onUpload?: UploadImage; maximum?: number;
}) {
  const [uploading, setUploading] = useState(false);
  return <div className="image-field" role="group" aria-label={label}>
    {!!paths.length && <div className="image-field-previews">{paths.map((path, i) => <div key={`${path}-${i}`}>
      <ProtectedImage path={path} alt={`${label} ${i + 1}`} />
      <button type="button" className="text-link" aria-label={`${label}: ${i + 1}-rasmni olib tashlash`} onClick={() => onChange(paths.filter((_, j) => i !== j))}>Rasmni olib tashlash</button>
    </div>)}</div>}
    {onUpload && <label className="image-upload button secondary">{uploading ? "Rasm yuklanmoqda…" : `${label}: PNG yuklash`}
      <input className="image-upload-input" type="file" accept="image/png,.png" aria-label={`${label}: PNG yuklash`} disabled={uploading || paths.length >= maximum} onChange={e => {
        const file = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (!file) return;
        void (async () => {
          setUploading(true);
          try { const path = await onUpload(file); if (path) onChange([...paths, path]); }
          finally { setUploading(false); }
        })();
      }} />
    </label>}
  </div>;
}
