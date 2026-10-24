import { test, expect, type Page } from "@playwright/test";
import type { Question } from "../src/types";
import type { QuestionInput } from "../src/pages/teacher/questionModel";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAGAAAABACAIAAABqVuVZAAAAlklEQVR4nO3YsQmAMBRF0Qzg0s7hbI5gae8IIdjcwIFXX5JT/nG/z9KO61za7v2x+wcAAWr3AQECBAhQuA8IECBAgMJ9QIB+AtUeVOsDAgQIEKBwHxAgQIAAhfuAAAECBCjcdzCbDBAgQIAAhfuAAAECBCjcBwQIECBA4b6D2WSAAAECBCjcBwQIECBA4T4gQIAAAQr3P7Cp1rP9dKocAAAAAElFTkSuQmCC", "base64");
const uploadFile = (name: string) => ({ name, mimeType: "image/png", buffer: PNG });
async function setup(page: Page, student = false) {
  const exam = { id: "images-exam", title: "Rasmli variantlar sinovi", subject: "Til", description: "", duration_minutes: 60, status: student ? "published" : "draft", certificate_thresholds: {}, essay_required: false, expert_count: 1, answer_released: false, results_published: false };
  const part = { id: "part1", label: "main", prompt: "", weight: 1, accepted: ["A"], case_sensitive: false, manual_review: false };
  let questions: Question[] = student ? [
    { id: "q1", position: 1, kind: "single", text: "Rasmli savol", topic: "Umumiy", passage_id: null, image_paths: ["images-exam/question.png"], options: [{ label: "A", text: "", image_path: "images-exam/option.png" }, { label: "B", text: "Matnli variant", image_path: null }], parts: [part] },
    { id: "q2", position: 2, kind: "matching", text: "Rasmni moslang", topic: "Umumiy", passage_id: null, image_paths: [], options: [{ label: "R1", text: "", image_path: "images-exam/matching.png" }], parts: [{ ...part, id: "part2", label: "p1", prompt: "Chap matn", accepted: ["R1"] }] },
  ] : [];
  let uploadCount = 0;
  const writes: { method: string; body: QuestionInput | { question_ids: string[] } }[] = [], responses: { answers: Record<string, string>; question_id: string }[] = [];
  const files = new Set(["images-exam/question.png", "images-exam/option.png", "images-exam/matching.png"]);
  const assets: string[] = [];
  await page.route("https://telegram.org/js/telegram-web-app.js*", route => route.fulfill({ contentType: "application/javascript", body: "" }));
  await page.addInitScript(() => sessionStorage.setItem("access_token", "images-fixture"));
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    let body: unknown = [];
    if (path.startsWith("/api/assets/")) {
      expect(request.headers().authorization).toBe("Bearer images-fixture"); assets.push(path);
      await route.fulfill({ status: files.has(path.slice("/api/assets/".length)) ? 200 : 404, contentType: "image/png", body: PNG }); return;
    }
    if (path.endsWith("/images") && method === "POST") {
      expect(request.headers()["content-type"]).toContain("multipart/form-data; boundary=");
      expect(request.headers().authorization).toBe("Bearer images-fixture");
      if (!request.postDataBuffer()!.includes(PNG.subarray(0, 8))) {
        await route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ detail: "Faqat PNG formatidagi rasm yuklang" }) }); return;
      }
      const imagePath = `images-exam/upload-${++uploadCount}.png`; files.add(imagePath); body = { path: imagePath };
    } else if (["POST", "PUT"].includes(method) && path.includes("/questions")) {
      const payload = request.postDataJSON(); writes.push({ method, body: payload });
      if (path.endsWith("/order")) questions = (payload.question_ids as string[]).map((id, i) => ({ ...questions.find(q => q.id === id)!, position: i + 1 }));
      else {
        const id = method === "POST" ? `q${questions.length + 1}` : path.split("/").at(-1)!;
        const saved: Question = { ...payload, id, parts: payload.parts.map((p: QuestionInput["parts"][number], i: number) => ({ ...p, id: `${id}-part${i}` })) };
        questions = method === "POST" ? [...questions, saved] : questions.map(q => q.id === id ? saved : q); body = saved;
      }
    } else if (path === "/api/config") body = { dev_auth: false };
    else if (path === "/api/me") body = { id: "user", name: "Sinov", role: student ? "student" : "teacher", active: true, telegram_id: 1234, avatar_url: null };
    else if (path === "/api/teacher/exams/images-exam") body = { ...exam, questions, question_count: questions.length, passages: [] };
    else if (path.includes("/responses/") && method === "PUT") { responses.push({ ...request.postDataJSON(), question_id: path.split("/").at(-1)! }); body = { revision: responses.length }; }
    else if (path === "/api/attempts/image-attempt") body = { id: "image-attempt", exam_id: exam.id, status: "in_progress", started_at: new Date().toISOString(), deadline: new Date(Date.now() + 3600000).toISOString(), server_now: new Date().toISOString(), responses: [], essay_text: "", exam: { ...exam, question_count: questions.length, passages: [], questions: questions.map(q => ({ ...q, parts: q.parts.map(({ accepted, ...p }) => p) })) } };
    else if (path === "/api/attempts/image-attempt/result") body = {
      exam_title: exam.title, submitted_at: new Date().toISOString(), label: "Xom natija", correct: 2, incorrect: 0, unanswered: 0, pending_parts: 0,
      raw_score: 2, maximum: 2, raw_percentage: 100, essay_required: false, essay_ready: true, expert_count: 1, assessed_experts: 0,
      theta: null, theta_se: null, z: null, t: null, final_score: null, grade: null, calibration_id: null, reference: null, scoring_version: null, answer_released: false,
      topics: [{ topic: "Umumiy", score: 2, maximum: 2 }], review: questions.map(q => ({ ...q, parts: q.parts.map(({ accepted, ...p }) => p), answers: responses.find(r => r.question_id === q.id)?.answers || {}, grades: q.parts.map(p => ({ part_id: p.id, score: 1, maximum: 1, status: "correct" })) })),
    };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  return { writes, responses, assets };
}

test("question and image-only choice upload, zoom, reopen, duplicate and removal preserve data", async ({ page }, testInfo) => {
  const { writes } = await setup(page); await page.goto("/teacher/exams/images-exam");
  await page.getByLabel("Savol turi", { exact: true }).selectOption("image");
  await page.getByLabel("Savol matni", { exact: true }).fill("Rasmli savol");
  for (const label of ["B", "C", "D"]) await page.getByLabel(`${label} variant`, { exact: true }).fill(`${label} matn`);
  await page.getByRole("radio", { name: "A", exact: true }).check();
  await page.getByLabel("Savol rasmlari: PNG yuklash", { exact: true }).setInputFiles({ name: "false.png", mimeType: "image/png", buffer: Buffer.from("not a PNG") });
  await expect(page.getByRole("alert").filter({ hasText: "Faqat PNG" })).toBeVisible();
  await expect(page.getByLabel("Savol matni", { exact: true })).toHaveValue("Rasmli savol");
  await page.getByLabel("Savol rasmlari: PNG yuklash", { exact: true }).setInputFiles(uploadFile("question.png"));
  await expect(page.getByAltText("Savol rasmlari 1")).toBeVisible();
  await page.getByLabel("A variant rasmi: PNG yuklash", { exact: true }).setInputFiles(uploadFile("option.png"));
  await expect(page.getByAltText("A variant rasmi 1")).toBeVisible(); expect(writes).toEqual([]);
  await page.getByRole("button", { name: "A variant rasmi 1 — kattalashtirish", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible(); await page.getByRole("button", { name: "Kattalashtirish", exact: true }).click();
  await expect(page.getByText("150%", { exact: true })).toBeVisible(); await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Savolni saqlash", exact: true }).click(); await expect(page.getByRole("status")).toContainText("Savol saqlandi");
  const payload = writes[0].body as QuestionInput; expect(payload.image_paths).toEqual(["images-exam/upload-1.png"]);
  expect(payload.options[0]).toEqual({ label: "A", text: "", image_path: "images-exam/upload-2.png" });
  await page.reload(); await page.getByRole("button", { name: "1 Rasmli savol", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Forma", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByAltText("A variant rasmi 1")).toHaveAttribute("src", /^blob:/);
  await page.getByRole("button", { name: "Nusxa", exact: true }).click(); await expect(page.getByRole("status")).toContainText("Savol nusxasi yaratildi");
  expect((writes[1].body as QuestionInput).options[0]).toEqual(payload.options[0]);
  await page.getByRole("button", { name: "A variant rasmi: 1-rasmni olib tashlash", exact: true }).click();
  await expect(page.getByRole("button", { name: "Savolni saqlash", exact: true })).toBeDisabled();
  await page.getByLabel("A variant", { exact: true }).fill("Matnli o‘rinbosar");
  await page.getByRole("button", { name: "Savol rasmlari: 1-rasmni olib tashlash", exact: true }).click();
  await page.getByRole("button", { name: "Savolni saqlash", exact: true }).click(); await expect(page.getByRole("status")).toContainText("Savol saqlandi");
  const last = writes.at(-1)!.body as QuestionInput; expect(last.options[0].image_path).toBeNull(); expect(last.image_paths).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("image-editor.png"), fullPage: true });
});

test("matching image-only right items retain labels after save and reopen", async ({ page }) => {
  const { writes } = await setup(page); await page.goto("/teacher/exams/images-exam");
  await page.getByLabel("Savol turi", { exact: true }).selectOption("matching");
  await page.getByLabel("Savol matni", { exact: true }).fill("Rasmni moslang");
  await page.getByRole("button", { name: "+ Juftlik", exact: true }).click();
  await page.getByLabel("Chap matn (p1)", { exact: true }).fill("Chap matn");
  await page.getByLabel("p1 mos variant rasmi: PNG yuklash", { exact: true }).setInputFiles(uploadFile("right.png"));
  await expect(page.getByAltText("p1 mos variant rasmi 1")).toBeVisible();
  await page.getByRole("button", { name: "Savolni saqlash", exact: true }).click(); await expect(page.getByRole("status")).toContainText("Savol saqlandi");
  const payload = writes[0].body as QuestionInput; expect(payload.options).toEqual([{ label: "R1", text: "", image_path: "images-exam/upload-1.png" }]);
  expect(payload.parts[0]).toMatchObject({ label: "p1", prompt: "Chap matn", accepted: ["R1"] });
  await page.reload(); await page.getByRole("button", { name: "1 Rasmni moslang", exact: true }).click();
  await expect(page.getByAltText("p1 mos variant rasmi 1")).toBeVisible(); await expect(page.getByLabel("Chap matn (p1)", { exact: true })).toHaveValue("Chap matn");
});

test("students can zoom and select image-only choices and matching images, then see them in review", async ({ page }, testInfo) => {
  const { responses, assets } = await setup(page, true); await page.goto("/exam/image-attempt");
  await expect(page.getByAltText("A variant rasmi")).toHaveAttribute("src", /^blob:/);
  const radio = page.getByRole("radio").first(); await expect(radio).not.toBeChecked();
  await page.getByRole("button", { name: "A variant rasmi — kattalashtirish", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible(); await page.keyboard.press("Escape"); await expect(radio).not.toBeChecked();
  await page.locator(".answer-option").first().click({ position: { x: 20, y: 20 } }); await expect(radio).toBeChecked();
  await expect.poll(() => responses.length).toBe(1); expect(responses[0].answers).toEqual({ main: "A" });
  await page.getByRole("button", { name: "Keyingi", exact: true }).click(); await expect(page.getByAltText("1 variant rasmi")).toBeVisible();
  // The student sees served positions and the left-hand text; the stored label stays the value.
  await page.getByLabel("Chap matn uchun javob", { exact: true }).selectOption("R1"); await expect.poll(() => responses.length).toBe(2);
  expect(responses[1].answers).toEqual({ p1: "R1" });
  await page.goto("/results/image-attempt"); await page.locator(".review-item").first().locator("summary").click();
  await expect(page.getByAltText("A variant rasmi")).toBeVisible(); await page.locator(".review-item").nth(1).locator("summary").click();
  await expect(page.getByAltText("R1 variant rasmi")).toBeVisible();
  expect(assets).toContain("/api/assets/images-exam/option.png"); expect(assets).toContain("/api/assets/images-exam/matching.png");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("image-review.png"), fullPage: true });
});
