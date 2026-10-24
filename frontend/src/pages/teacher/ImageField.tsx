import { useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { ProtectedImage } from "../../components/ui";
import type { UploadImage } from "./questionModel";

export default function ImageField({ label, paths, onChange, onUpload, maximum = 1 }: {
  label: string; paths: string[]; onChange: (paths: string[]) => void; onUpload?: UploadImage; maximum?: number;
}) {
  const [uploading, setUploading] = useState(false);
  const full = paths.length >= maximum;
  return <div className="image-field" role="group" aria-label={label}>
    {!!paths.length && <div className="image-field-previews">{paths.map((path, i) => <div className="image-thumb" key={`${path}-${i}`}>
      <ProtectedImage path={path} alt={`${label} ${i + 1}`} />
      <button type="button" className="image-remove" aria-label={`${label}: ${i + 1}-rasmni olib tashlash`}
        onClick={() => onChange(paths.filter((_, j) => i !== j))}><X size={13} /></button>
    </div>)}</div>}
    {/* Images are the exception, so this stays a quiet link rather than a button competing with the text field. */}
    {onUpload && <label className={`image-add${full ? " is-full" : ""}`}>
      <ImagePlus size={14} aria-hidden="true" />
      {uploading ? "Yuklanmoqda…" : full ? "Rasm qo‘shilgan" : paths.length ? "Yana rasm" : "Rasm"}
      <input className="image-upload-input" type="file" accept="image/png,.png" aria-label={`${label}: PNG yuklash`}
        disabled={uploading || full} onChange={e => {
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
