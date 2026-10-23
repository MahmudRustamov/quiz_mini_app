import { z } from "zod";
import type { Question } from "../../types";

export const kinds = {
  single: "A/B/C/D test", matching: "Moslashtirish", short: "Qisqa yozma javob",
  two_part: "Ikki qismli savol", reading: "O‘qish", image: "Rasmli savol",
} as const;
const partShape = z.object({
  label: z.string().default("main"), prompt: z.string().default(""), weight: z.number().default(1),
  accepted: z.array(z.string()).default([]), case_sensitive: z.boolean().default(false), manual_review: z.boolean().default(false),
});
const shape = z.object({
  position: z.number(), kind: z.enum(["single", "matching", "short", "two_part", "reading", "image"]),
  text: z.string(), topic: z.string().default("Umumiy"), passage_id: z.string().nullable().default(null),
  image_paths: z.array(z.string()).default([]),
  options: z.array(z.object({ label: z.string(), text: z.string().default(""), image_path: z.string().nullable().default(null) })).default([]),
  parts: z.array(partShape).default([{ label: "main", prompt: "", weight: 1, accepted: [], case_sensitive: false, manual_review: false }]),
});
export type QuestionInput = z.infer<typeof shape>;
export type PartInput = QuestionInput["parts"][number];
export type Kind = QuestionInput["kind"];
export type Issues = Record<string, string>;
export type UploadImage = (file: File) => Promise<string | null>;
export type EditorProps = { value: QuestionInput; onChange: (value: QuestionInput) => void; errors: Issues; onUpload?: UploadImage };
const isChoice = (kind: Kind) => ["single", "reading", "image"].includes(kind);
export const newPart = (label = "main"): PartInput => ({ label, prompt: "", weight: 1, accepted: [], case_sensitive: false, manual_review: false });
export function blankQuestion(position: number, kind: Kind = "single"): QuestionInput {
  return { position, kind, text: "", topic: "Umumiy", passage_id: null, image_paths: [],
    options: isChoice(kind) ? ["A", "B", "C", "D"].map(label => ({ label, text: "", image_path: null })) : [],
    parts: kind === "two_part" ? [newPart("A"), newPart("B")] : kind === "matching" ? [] : [newPart()] };
}
export function toInput(q: Question): QuestionInput {
  // single, reading and image all retain their option labels and scoring keys verbatim.
  return shape.parse({
    ...q,
    options: q.options.map(({ label, text, image_path }) => ({ label, text, image_path: image_path ?? null })),
    parts: q.parts.map(p => ({ ...p, accepted: p.accepted || [], case_sensitive: !!p.case_sensitive, manual_review: !!p.manual_review })),
  });
}
export const encode = (q: QuestionInput) => JSON.stringify(q, null, 2);
export function validateQuestion(q: QuestionInput, examId?: string): Issues {
  const errors: Issues = {};
  const add = (path: string, message: string) => { errors[path] = message; };
  const text = (path: string, value: string, max: number, required = false) => {
    if (required && !value.trim()) add(path, "Bu maydonni to‘ldiring.");
    else if (value.length > max) add(path, `Ko‘pi bilan ${max} ta belgi kiriting.`);
  };
  if (!Number.isInteger(q.position) || q.position < 1 || q.position > 500) add("position", "Savol raqami 1–500 oralig‘ida bo‘lishi kerak.");
  text("text", q.text, 50000, true); text("topic", q.topic, 100);
  if (q.image_paths.length > 20) add("image_paths", "Ko‘pi bilan 20 ta rasm bo‘lishi mumkin.");
  const image = (path: string, value: string) => {
    if (value.includes("..") || !value.toLowerCase().endsWith(".png") || !value.includes("/") || examId && !value.startsWith(`${examId}/`)) add(path, "Rasm shu imtihonga tegishli PNG fayli bo‘lishi kerak.");
  };
  q.image_paths.forEach((p, i) => image(`image_paths.${i}`, p));
  if (q.options.length > 50) add("options", "Ko‘pi bilan 50 ta variant bo‘lishi mumkin.");
  if (!q.parts.length || q.parts.length > 50) add("parts", "1–50 ta qism bo‘lishi kerak.");
  if (new Set(q.options.map(o => o.label)).size !== q.options.length) add("options", "Variant belgilari takrorlanmasin.");
  if (new Set(q.parts.map(p => p.label)).size !== q.parts.length) add("parts", "Qism belgilari takrorlanmasin.");
  if (q.kind === "two_part" && (q.parts.length !== 2 || !q.parts.some(p => p.label === "A") || !q.parts.some(p => p.label === "B"))) add("parts", "A va B qismlari bo‘lishi shart.");
  if (isChoice(q.kind) && q.options.length && q.parts.length !== 1) add("parts", "Variantli savolda bitta baholash qismi bo‘lishi kerak.");
  q.options.forEach((o, i) => {
    text(`options.${i}.label`, o.label, 30, true); text(`options.${i}.text`, o.text, 10000);
    if (!o.text.trim() && !o.image_path) add(`options.${i}.text`, "Variant matni yoki rasmi bo‘lishi kerak.");
    if (o.image_path) image(`options.${i}.image_path`, o.image_path);
  });
  q.parts.forEach((p, i) => {
    const path = `parts.${i}`;
    text(`${path}.label`, p.label, 30, true); text(`${path}.prompt`, p.prompt, 10000, q.kind === "matching");
    if (!Number.isFinite(p.weight) || p.weight <= 0 || p.weight > 100) add(`${path}.weight`, "Vazn 0 dan katta, 100 dan oshmagan bo‘lsin.");
    if (p.accepted.length > 100) add(`${path}.accepted`, "Ko‘pi bilan 100 ta javob kiriting.");
    else if ((!p.accepted.length || p.accepted.some(a => !a.trim())) && !p.manual_review) add(`${path}.accepted`, "Kamida bitta bo‘sh bo‘lmagan javob kiriting yoki qo‘lda tekshirishni yoqing.");
    if (q.options.length && (isChoice(q.kind) || q.kind === "matching") && p.accepted.some(a => !q.options.some(o => o.label === a))) add(`${path}.accepted`, "Kalit mavjud variant belgisiga mos bo‘lishi kerak.");
  });
  return errors;
}
export function inspectBuffer(buffer: string, position: number, examId?: string): { data?: QuestionInput; errors: Issues } {
  let raw: unknown;
  try { raw = JSON.parse(buffer); }
  catch (error) {
    const message = error instanceof Error ? error.message : "";
    const match = message.match(/position (\d+)/i), lc = message.match(/line (\d+) column (\d+)/i);
    const pos = match ? Number(match[1]) : buffer.length;
    const prefix = buffer.slice(0, pos).split("\n");
    const line = lc ? Number(lc[1]) : prefix.length, column = lc ? Number(lc[2]) : prefix.at(-1)!.length + 1;
    return { errors: { json: `JSON sintaksisi noto‘g‘ri: ${line}-qator, ${column}-ustun (${pos}-belgi). Qavs, qo‘shtirnoq va vergullarni tekshiring.` } };
  }
  const parsed = shape.safeParse(raw);
  if (!parsed.success) return { errors: { json: `JSON maydoni noto‘g‘ri: ${parsed.error.issues[0].path.join(".") || "savol"}. Maydon turi va tuzilishini tekshiring.` } };
  // Position always comes from the exam, including when the JSON buffer contains an old number.
  const data = { ...parsed.data, position };
  return { data, errors: validateQuestion(data, examId) };
}
export function canUseForm(q: QuestionInput): boolean {
  // Image-only options use the same labels and scoring parts as text options.
  if (isChoice(q.kind)) return q.parts.length === 1 && q.parts[0].label === "main" && q.parts[0].accepted.length <= 1 && q.options.map(o => o.label).join(",") === "A,B,C,D";
  if (q.kind === "short") return !q.options.length && q.parts.length === 1 && q.parts[0].label === "main";
  if (q.kind === "two_part") return !q.options.length && q.parts.length === 2 && q.parts.some(p => p.label === "A") && q.parts.some(p => p.label === "B");
  return q.parts.every(p => p.accepted.length <= 1 && (!p.accepted.length || q.options.some(o => o.label === p.accepted[0]))) && q.options.every(o => q.parts.some(p => p.accepted.includes(o.label))) && new Set(q.options.map(o => o.label)).size === q.options.length && new Set(q.parts.map(p => p.label)).size === q.parts.length;
}
export function switchKind(q: QuestionInput, kind: Kind): QuestionInput {
  const target = blankQuestion(q.position, kind);
  if (isChoice(q.kind) && isChoice(kind)) return { ...q, kind };
  const written = ["short", "two_part"].includes(q.kind) && ["short", "two_part"].includes(kind);
  return { ...target, text: q.text, topic: q.topic, passage_id: q.passage_id, image_paths: q.image_paths,
    parts: target.parts.map((p, i) => ({ ...p, ...(q.parts[i] ? { prompt: q.parts[i].prompt, weight: q.parts[i].weight, manual_review: q.parts[i].manual_review, case_sensitive: q.parts[i].case_sensitive, accepted: written ? q.parts[i].accepted : [] } : {}) })) };
}
export function losesData(q: QuestionInput, kind: Kind): boolean {
  const target = switchKind(q, kind);
  return (JSON.stringify(q.options) !== JSON.stringify(target.options) && q.options.some(o => o.text || o.image_path)) || q.kind === "matching" && q.parts.length > 0 || q.parts.some((p, i) => {
    const next = target.parts[i];
    if (!next) return q.parts.length > 1 || !!p.prompt || !!p.accepted.length || p.weight !== 1 || p.case_sensitive || p.manual_review || p.label !== "main";
    return p.accepted.length > 0 && JSON.stringify(p.accepted) !== JSON.stringify(next.accepted);
  });
}
export const draftKey = (examId: string, questionId: string | null) => `question-editor:${examId}:${questionId || "new"}`;
export function readDraft(examId: string, questionId: string | null): string | undefined {
  try { return localStorage.getItem(draftKey(examId, questionId)) ?? undefined; } catch { return undefined; }
}
