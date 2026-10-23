import { test, expect, type Page } from "@playwright/test";
import type { Question } from "../src/types";
import type { QuestionInput, Kind } from "../src/pages/teacher/questionModel";

// API fixtures isolate authoring from Telegram and retain saved records across page reloads.
async function setup(page: Page) {
  const exam = { id: "editor-exam", title: "Savol muharriri sinovi", subject: "Ona tili", description: "", duration_minutes: 90, status: "draft", certificate_thresholds: { "A+": 70, A: 65, "B+": 60, B: 55, "C+": 50, C: 46 }, essay_required: false, expert_count: 1, answer_released: false, results_published: false };
  let questions: Question[] = [];
  const writes: { method: string; payload: QuestionInput }[] = [];
  await page.route("https://telegram.org/js/telegram-web-app.js*", route => route.fulfill({ contentType: "application/javascript", body: "" }));
  await page.addInitScript(() => sessionStorage.setItem("access_token", "editor-fixture"));
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let body: unknown = [];
    if (["POST", "PUT"].includes(request.method()) && path.includes("/questions")) {
      const payload = request.postDataJSON() as QuestionInput;
      writes.push({ method: request.method(), payload });
      const id = request.method() === "POST" ? `q${questions.length + 1}` : path.split("/").at(-1)!;
      const saved: Question = { ...payload, id, parts: payload.parts.map((p, i) => ({ ...p, id: `part-${id}-${i}` })) };
      questions = request.method() === "POST" ? [...questions, saved] : questions.map(q => q.id === id ? saved : q);
      body = saved;
    } else if (path === "/api/config") body = { dev_auth: false };
    else if (path === "/api/me") body = { id: "teacher", name: "O‘qituvchi", role: "teacher", active: true, telegram_id: 1234, avatar_url: null };
    else if (path === "/api/teacher/exams/editor-exam") body = { ...exam, questions, question_count: questions.length, passages: [] };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  return { writes, add: (q: Question) => { questions.push(q); } };
}

for (const kind of ["single", "matching", "short", "two_part"] as Kind[]) {
  test(`${kind}: create → edit → reopen keeps fields and keys`, async ({ page }, testInfo) => {
    const { writes } = await setup(page); await page.goto("/teacher/exams/editor-exam");
    await page.getByLabel("Savol turi", { exact: true }).selectOption(kind);
    await page.getByLabel("Savol matni", { exact: true }).fill(`${kind} savol`);
    await page.getByLabel("Mavzu", { exact: true }).fill("Grammatika");
    if (kind === "single") {
      for (const label of ["A", "B", "C", "D"]) await page.getByLabel(`${label} variant`, { exact: true }).fill(`${label} matn`);
      await page.getByRole("radio", { name: "B", exact: true }).check();
    } else if (kind === "matching") {
      for (let i = 1; i <= 2; i++) {
        await page.getByRole("button", { name: "+ Juftlik", exact: true }).click();
        await page.getByLabel(`Chap matn (p${i})`, { exact: true }).fill(`Chap ${i}`);
        await page.getByLabel(`Mos o‘ng matn (p${i})`, { exact: true }).fill(`O‘ng ${i}`);
      }
    } else {
      for (const label of kind === "two_part" ? ["A", "B"] : ["main"]) {
        if (kind === "two_part") await page.getByLabel(`${label} qism matni`, { exact: true }).fill(`${label} topshiriq`);
        await page.getByRole("button", { name: `+ Javob (${label})`, exact: true }).click();
        await page.getByLabel(`1-javob (${label})`, { exact: true }).fill(`${label} javob`);
      }
    }
    expect(writes).toEqual([]);
    await page.getByRole("button", { name: "Savolni saqlash", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Savol saqlandi");
    expect(writes[0].payload.position).toBe(1); expect(writes[0].payload.kind).toBe(kind);
    await expect(page.getByLabel("Savollar holati")).toHaveText("1 tayyor · 0 tekshiruv kerak");
    await page.getByLabel("Savol matni", { exact: true }).fill(`${kind} tahrir`);
    await page.getByRole("button", { name: "Savolni saqlash", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Savol saqlandi");
    expect(writes.map(w => w.method)).toEqual(["POST", "PUT"]);
    await page.reload();
    await page.getByRole("button", { name: `1 ${kind} tahrir`, exact: true }).click();
    await expect(page.getByLabel("Savol matni", { exact: true })).toHaveValue(`${kind} tahrir`);
    await expect(page.getByLabel("Mavzu", { exact: true })).toHaveValue("Grammatika");
    if (testInfo.project.name === "desktop") {
      const box = await page.getByLabel("Javob kaliti", { exact: true }).boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    }
    if (kind === "single") await page.screenshot({ path: testInfo.outputPath("question-editor.png"), fullPage: true });
    await page.getByRole("tab", { name: "JSON", exact: true }).click();
    expect(JSON.parse(await page.getByLabel("Savol tuzilishi", { exact: true }).inputValue())).toEqual(writes[1].payload);
    await page.locator(".question-editor").scrollIntoViewIfNeeded();
    const keyBox = await page.getByLabel("Javob kaliti", { exact: true }).boundingBox();
    await page.locator(".question-editor-body").evaluate(el => { el.scrollTop = el.scrollHeight; });
    expect(await page.getByLabel("Javob kaliti", { exact: true }).boundingBox()).toEqual(keyBox);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("incomplete and invalid JSON drafts survive reload without sending writes", async ({ page }) => {
  const { writes } = await setup(page); await page.goto("/teacher/exams/editor-exam");
  await page.getByLabel("Savol matni", { exact: true }).fill("Tugallanmagan savol");
  await expect(page.getByRole("button", { name: "Savolni saqlash", exact: true })).toBeDisabled();
  await page.reload(); await expect(page.getByLabel("Savol matni", { exact: true })).toHaveValue("Tugallanmagan savol");
  await page.getByRole("tab", { name: "JSON", exact: true }).click();
  await page.getByLabel("Savol tuzilishi", { exact: true }).fill('{"text": !!!');
  await page.reload(); await expect(page.getByLabel("Savol tuzilishi", { exact: true })).toHaveValue('{"text": !!!');
  await expect(page.getByRole("alert")).toContainText("JSON sintaksisi noto‘g‘ri");
  expect(writes).toEqual([]);
});

test("readiness uses unsaved buffers and reading questions preserve passage and images", async ({ page }) => {
  const fixture = await setup(page);
  fixture.add({ id: "q1", position: 1, kind: "reading", text: "Matnni o‘qing", topic: "O‘qish", passage_id: "passage-1", image_paths: ["editor-exam/pdf.png"], options: [{ label: "A", text: "Javob" }], parts: [{ id: "p1", label: "main", prompt: "", weight: 1, accepted: ["A"], manual_review: false, case_sensitive: false }] });
  await page.route("**/api/assets/**", route => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0S8AAAAASUVORK5CYII=", "base64") }));
  await page.goto("/teacher/exams/editor-exam");
  await expect(page.getByLabel("Savollar holati")).toHaveText("1 tayyor · 0 tekshiruv kerak");
  await page.getByRole("button", { name: "1 Matnni o‘qing", exact: true }).click();
  await expect(page.getByRole("tab", { name: "JSON", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByAltText("Savol rasmlari 1")).toBeVisible();
  const json = page.getByLabel("Savol tuzilishi", { exact: true });
  const data = JSON.parse(await json.inputValue()); expect(data.passage_id).toBe("passage-1"); expect(data.image_paths).toEqual(["editor-exam/pdf.png"]);
  await json.fill(JSON.stringify({ ...data, text: "" }));
  await expect(page.getByLabel("Savollar holati")).toHaveText("0 tayyor · 1 tekshiruv kerak");
  await page.reload(); await page.getByRole("button", { name: "1 Matnni o‘qing", exact: true }).click();
  expect(JSON.parse(await json.inputValue()).text).toBe(""); expect(fixture.writes).toEqual([]);
});
