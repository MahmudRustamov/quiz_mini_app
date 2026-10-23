import { test, expect, type Page } from "@playwright/test";
import type { Exam, ImportDoc, Question } from "../src/types";
import { blankQuestion, newPart, type QuestionInput } from "../src/pages/teacher/questionModel";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0S8AAAAASUVORK5CYII=", "base64");
const choice = (position: number, kind: "reading" | "image" | "single"): Question => ({
  ...blankQuestion(position, kind), id: `q${position}`, text: `${kind} savol`, passage_id: kind === "reading" ? "p1" : null,
  image_paths: kind === "image" ? ["preview-exam/question.png"] : [],
  options: blankQuestion(position, kind).options.map(o => ({ ...o, text: o.label === "A" ? "" : `${o.label} matn`, image_path: o.label === "A" ? "preview-exam/option.png" : null })),
  parts: [{ ...newPart(), id: `part${position}`, accepted: kind === "reading" ? [] : ["C"] }],
});
async function setup(page: Page, student = false) {
  const exam: Exam = { id: "preview-exam", title: "Ko‘rish sinovi", subject: "Til", description: "", duration_minutes: 60, question_count: 2, status: student ? "published" : "draft", certificate_thresholds: {}, essay_required: false, expert_count: 1, answer_released: false, results_published: false };
  let questions = [choice(1, "reading"), choice(2, "image")];
  let passages = [{ id: "p1", title: "Mavjud matn", text: "Talaba o‘qiydigan matn" }];
  const documents: ImportDoc[] = [{ id: "doc1", source_name: "Manba.pdf", extracted: { verification_required: true, pages: [1, 2].map(page => ({ page, text: `PDF matni ${page}`, two_columns: false, scanned: false, page_image: `preview-exam/page${page}.png`, images: [], warnings: [] })) } }];
  const writes: { path: string; body: unknown }[] = [], responses: { answers: Record<string, string> }[] = [];
  await page.route("https://telegram.org/js/telegram-web-app.js*", route => route.fulfill({ contentType: "application/javascript", body: "" }));
  await page.addInitScript(() => sessionStorage.setItem("access_token", "preview-fixture"));
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    let body: unknown = [];
    if (path.startsWith("/api/assets/")) { await route.fulfill({ contentType: "image/png", body: PNG }); return; }
    if (method !== "GET" && method !== "OPTIONS") writes.push({ path, body: request.postDataJSON() });
    if (path === "/api/config") body = { dev_auth: false };
    else if (path === "/api/me") body = { id: "user", name: "Sinov", role: student ? "student" : "teacher", active: true, telegram_id: 1234, avatar_url: null };
    else if (path === "/api/teacher/exams/preview-exam") body = { ...exam, questions, passages };
    else if (path.endsWith("/imports")) body = documents;
    else if (path.includes("/passages/") && method === "DELETE") {
      const id = path.split("/").at(-1)!;
      if (questions.some(q => q.passage_id === id)) { await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ detail: "Matn savollarda ishlatilgan. Avval savollarni yangilang." }) }); return; }
      passages = passages.filter(p => p.id !== id); body = { ok: true };
    } else if (path.endsWith("/passages") && method === "POST") {
      const passage = { ...request.postDataJSON(), id: `p${passages.length + 1}` }; passages.push(passage); body = passage;
    } else if (path.includes("/questions/") && method === "PUT") {
      const payload = request.postDataJSON() as QuestionInput, id = path.split("/").at(-1)!;
      const saved = { ...payload, id, parts: payload.parts.map((p, i) => ({ ...p, id: `${id}-part${i}` })) };
      questions = questions.map(q => q.id === id ? saved : q); body = saved;
    } else if (path.includes("/responses/") && method === "PUT") { const saved = request.postDataJSON(); responses.push(saved); body = { ...saved, revision: responses.length }; }
    else if (path === "/api/attempts/preview-attempt") body = { id: "preview-attempt", exam_id: exam.id, status: "in_progress", started_at: new Date().toISOString(), deadline: new Date(Date.now() + 3600000).toISOString(), server_now: new Date().toISOString(), responses: [], essay_text: "", exam: { ...exam, passages, questions: questions.map(q => ({ ...q, parts: q.parts.map(({ accepted, ...p }) => p) })) } };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  return { writes, responses };
}

test("reading form creates passages, preserves keys, previews locally and shows referenced-passage conflicts", async ({ page }) => {
  const { writes } = await setup(page); await page.goto("/teacher/exams/preview-exam");
  await page.getByRole("button", { name: "1 reading savol", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Forma", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("radio", { name: "C", exact: true }).check();
  await page.getByRole("button", { name: "Matnni o‘chirish", exact: true }).click();
  await page.getByRole("button", { name: "Matnni o‘chirishni tasdiqlash" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Matn savollarda" })).toBeVisible();
  await page.getByText("Yangi o‘qish matni", { exact: true }).click();
  await page.getByLabel("Matn nomi", { exact: true }).fill("Yangi manba");
  await page.getByLabel("Matn", { exact: true }).fill("Yangi o‘qish matni mazmuni");
  await page.getByRole("button", { name: "Matnni saqlash", exact: true }).click();
  await expect(page.getByLabel("O‘qish matni", { exact: true })).toHaveValue("p2");
  const before = writes.length;
  await page.getByRole("tab", { name: "Ko‘rish", exact: true }).click();
  const preview = page.getByRole("region", { name: "O‘quvchi ko‘rinishi" });
  await expect(preview).toContainText("Yangi o‘qish matni mazmuni");
  await preview.getByRole("radio").nth(1).check(); await page.keyboard.press("Enter");
  expect(writes).toHaveLength(before);
  await page.getByRole("tab", { name: "JSON", exact: true }).click();
  const payload = JSON.parse(await page.getByLabel("Savol tuzilishi", { exact: true }).inputValue());
  expect(payload.parts[0].accepted).toEqual(["C"]); expect(payload.passage_id).toBe("p2");
  await page.getByRole("button", { name: "Savolni saqlash", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Savol saqlandi");
  expect(writes.at(-1)!.body).toEqual(payload);
  await page.reload(); await page.getByRole("button", { name: "1 reading savol", exact: true }).click();
  await expect(page.getByLabel("O‘qish matni", { exact: true })).toHaveValue("p2");
});

test("PDF pages sit beside the same editor; missing keys update locally and publication stays manual", async ({ page }, testInfo) => {
  const { writes } = await setup(page); await page.goto("/teacher/exams/preview-exam");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("Javob kaliti yo‘q", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "1 reading savol", exact: true }).click();
  await expect(page.getByAltText("1-sahifa")).toHaveAttribute("src", /^blob:/);
  await page.getByLabel("Savol matni", { exact: true }).fill("PDFdan tekshirilgan savol");
  await page.getByLabel("PDF sahifasi", { exact: true }).selectOption("doc1:2");
  await expect(page.getByAltText("2-sahifa")).toHaveAttribute("src", /^blob:/);
  await expect(page.getByLabel("Savol matni", { exact: true })).toHaveValue("PDFdan tekshirilgan savol");
  await page.getByRole("radio", { name: "B", exact: true }).check();
  await expect(page.getByText("Javob kaliti yo‘q", { exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "Ko‘rish", exact: true }).click();
  await expect(page.getByRole("region", { name: "O‘quvchi ko‘rinishi" })).toContainText("Talaba o‘qiydigan matn");
  await page.getByRole("region", { name: "O‘quvchi ko‘rinishi" }).getByRole("radio").nth(2).check();
  expect(writes).toEqual([]);
  await page.locator(".pdf-review-layout").scrollIntoViewIfNeeded();
  const source = await page.getByLabel("PDF manbasi").boundingBox(), editor = await page.getByRole("form", { name: "Savol muharriri" }).boundingBox();
  if (testInfo.project.name === "desktop") expect(source!.x + source!.width).toBeLessThan(editor!.x);
  else expect(source!.y + source!.height).toBeLessThanOrEqual(editor!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("pdf-review-preview.png"), fullPage: true });
  await page.getByRole("button", { name: "Savolni saqlash", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Savol saqlandi");
  expect(writes).toHaveLength(1); expect(writes[0].path).toBe("/api/teacher/exams/preview-exam/questions/q1");
  expect((writes[0].body as QuestionInput).parts[0].accepted).toEqual(["B"]);
});

test("image form previews existing question/option images using the shared student renderer", async ({ page }) => {
  const { writes } = await setup(page); await page.goto("/teacher/exams/preview-exam");
  await page.getByRole("button", { name: "2 image savol", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Forma", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByAltText("Savol rasmlari 1")).toBeVisible();
  await page.getByRole("tab", { name: "Ko‘rish", exact: true }).click();
  await expect(page.getByAltText("2-savol rasmi")).toHaveAttribute("src", /^blob:/);
  await page.getByRole("button", { name: "A variant rasmi — kattalashtirish", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible(); await page.keyboard.press("Escape");
  const preview = page.getByRole("region", { name: "O‘quvchi ko‘rinishi" });
  await expect(preview.getByRole("radio").first()).not.toBeChecked();
  await preview.getByRole("radio").first().check(); expect(writes).toEqual([]);
  await page.getByRole("tab", { name: "JSON", exact: true }).click();
  expect(JSON.parse(await page.getByLabel("Savol tuzilishi", { exact: true }).inputValue()).parts[0].accepted).toEqual(["C"]);
});

test("the actual student session retains reading passages, image choices and answer saving after extraction", async ({ page }) => {
  const { responses } = await setup(page, true); await page.goto("/exam/preview-attempt");
  await expect(page.getByText("Talaba o‘qiydigan matn", { exact: true })).toBeVisible();
  await page.getByRole("radio").nth(1).check();
  await expect.poll(() => responses.length).toBe(1); expect(responses[0].answers).toEqual({ main: "B" });
  await page.getByRole("button", { name: "Keyingi", exact: true }).click();
  await expect(page.getByAltText("2-savol rasmi")).toBeVisible();
  await page.getByRole("radio").nth(2).check();
  await expect.poll(() => responses.length).toBe(2); expect(responses[1].answers).toEqual({ main: "C" });
});
