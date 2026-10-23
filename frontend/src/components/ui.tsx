import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import { apiFetch } from "../services/api";
export function Loading() {
  return (
    <div className="empty">
      <LoaderCircle className="spin" />
      <p>Yuklanmoqda…</p>
    </div>
  );
}
export function ErrorBox({ error }: { error: unknown }) {
  return (
    <div role="alert" className="alert">
      <TriangleAlert size={18} />
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <BookOpen size={25} />
      </div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {children}
    </div>
  );
}
export function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function Pill({
  children,
  tone = "green",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`pill ${tone}`}>{children}</span>;
}
export function SectionTitle({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {children}
    </div>
  );
}
export function ProtectedImage({ path, alt }: { path: string; alt: string }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    let object = "";
    setError(false);
    apiFetch(`/assets/${path}`)
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.blob();
      })
      .then((blob) => {
        object = URL.createObjectURL(blob);
        if (active) setUrl(object);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
      if (object) URL.revokeObjectURL(object);
    };
  }, [path]);
  return error ? (
    <p className="alert">Rasm yuklanmadi</p>
  ) : url ? (
    <img className="question-image" src={url} alt={alt} />
  ) : (
    <Loading />
  );
}
export const fmt = (n: number | null | undefined, digits = 1) =>
  n == null ? "—" : n.toFixed(digits);
export const date = (v: string | null | undefined) => {
  if (!v) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: "Asia/Tashkent",
  }).formatToParts(new Date(v));
  const value = (key: string) => parts.find((p) => p.type === key)?.value || "";
  const months = [
    "yan",
    "fev",
    "mar",
    "apr",
    "may",
    "iyn",
    "iyl",
    "avg",
    "sen",
    "okt",
    "noy",
    "dek",
  ];
  return `${value("day")} ${months[Number(value("month")) - 1]} ${value("year")}`;
};
export function ArrowLink({ children }: { children: ReactNode }) {
  return (
    <span className="inline-link">
      {children}
      <ArrowRight size={16} />
    </span>
  );
}
