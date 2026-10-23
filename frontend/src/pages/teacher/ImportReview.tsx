import { useState, type ReactNode } from "react";
import type { ImportDoc } from "../../types";
import { Pill, ProtectedImage } from "../../components/ui";

export default function ImportReview({
  documents,
  children,
}: {
  documents: ImportDoc[];
  children: ReactNode;
}) {
  const pages = documents.flatMap((doc) =>
    doc.extracted.pages.map((page) => ({
      doc,
      page,
      key: `${doc.id}:${page.page}`,
    })),
  );
  const [selected, setSelected] = useState("");
  const current = pages.find((page) => page.key === selected) || pages[0];
  return (
    <div className={current ? "pdf-review-layout" : ""}>
      {current && (
        <aside className="panel pdf-review-source" aria-label="PDF manbasi">
          <Pill tone="amber">O‘qituvchi tekshiruvi talab qilinadi</Pill>
          <label className="field">
            PDF sahifasi
            <select
              aria-label="PDF sahifasi"
              value={current.key}
              onChange={(e) => setSelected(e.target.value)}
            >
              {pages.map(({ doc, page, key }) => (
                <option key={key} value={key}>
                  {doc.source_name} · {page.page}-sahifa
                </option>
              ))}
            </select>
          </label>
          <ProtectedImage
            path={current.page.page_image}
            alt={`${current.page.page}-sahifa`}
          />
          <p className="muted small">
            {current.page.two_columns ? "Ikki ustun" : "Bir ustun"}
            {current.page.scanned ? " · Skan" : ""}
          </p>
          <details className="import-page">
            <summary>Ajratilgan matn va rasmlar</summary>
            <label className="field">
              Ajratilgan matn
              <textarea
                aria-label="Ajratilgan matn"
                readOnly
                rows={16}
                value={current.page.text}
              />
            </label>
            {current.page.images.map((image) => (
              <p className="small" key={image}>
                Rasm: <code>{image}</code>
              </p>
            ))}
          </details>
          {current.page.warnings.map((warning) => (
            <p className="alert" key={warning}>
              {warning}
            </p>
          ))}
          <p className="muted small">
            Sahifani solishtirib, savol va javob kalitini qo‘lda tekshiring.
            Savolni saqlash imtihonni e’lon qilmaydi.
          </p>
        </aside>
      )}
      {children}
    </div>
  );
}
