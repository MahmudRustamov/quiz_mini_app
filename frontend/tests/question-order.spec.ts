import { test, expect, type Page } from "@playwright/test";
import type { Question } from "../src/types";
import type { QuestionInput } from "../src/pages/teacher/questionModel";

async function setup(page: Page, count = 5, failPlacement = false) {
  const exam = { id: "order-exam", title: "Savol tartibi sinovi", subject: "Til", description: "", duration_minutes: 90, status: "draft", certificate_thresholds: {}, essay_required: false, expert_count: 1, answer_released: false, results_published: false };
  let questions: Question[] = Array.from({ length: count }, (_, i) => ({ id: `q${i + 1}`, position: i + 1, kind: "short", text: `Savol ${i + 1}`, topic: "Umumiy", passage_id: null, image_paths: [], options: [], parts: [{ id: `p${i + 1}`, label: "main", prompt: "", weight: 1, accepted: ["javob"], manual_review: false, case_sensitive: false }] }));
  const writes: { method: string; path: string; body: QuestionInput | { question_ids: string[] } }[] = [];
  await page.route("https://telegram.org/js/telegram-web-app.js*", route => route.fulfill({ contentType: "application/javascript", body: "" }));
  await page.addInitScript(() => sessionStorage.setItem("access_token", "question-order-fixture"));
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    let body: unknown = [];
    if (["POST", "PUT"].includes(method) && path.includes("/questions")) {
      const payload = request.postDataJSON(); writes.push({ method, path, body: payload });
      if (path.endsWith("/questions/order")) {
        if (failPlacement) { failPlacement = false; await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Tartibni saqlab bo‘lmadi" }) }); return; }
        const ids: string[] = payload.question_ids;
        expect(ids).toHaveLength(questions.length); expect(new Set(ids).size).toBe(questions.length);
        expect(ids.every(id => questions.some(q => q.id === id))).toBe(true);
        questions = ids.map((id, i) => ({ ...questions.find(q => q.id === id)!, position: i + 1 })); body = payload;
      } else {
        expect(method).toBe("POST"); expect(payload.position).toBe(questions.length + 1);
        const id = `q${questions.length + 1}`, saved: Question = { ...payload, id, parts: payload.parts.map((p: QuestionInput["parts"][number], i: number) => ({ ...p, id: `${id}-p${i}` })) };
        questions = [...questions, saved]; body = saved;
      }
    } else if (path === "/api/config") body = { dev_auth: false };
    else if (path === "/api/me") body = { id: "teacher", name: "O‘qituvchi", role: "teacher", active: true, telegram_id: 1234, avatar_url: null };
    else if (path === "/api/teacher/exams/order-exam") body = { ...exam, questions, question_count: questions.length, passages: [] };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  return { writes, rows: () => questions };
}
async function newShort(page: Page, text: string) {
  await page.getByLabel("Savol turi", { exact: true }).selectOption("short");
  await page.getByLabel("Savol matni", { exact: true }).fill(text);
  await page.getByRole("button", { name: "+ Javob (main)", exact: true }).click();
  await page.getByLabel("1-javob (main)", { exact: true }).fill("javob");
  await page.getByRole("button", { name: "Savolni saqlash", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Savol saqlandi");
}

const openMenu = (page: Page, position: number) => page.getByRole("button", { name: `${position}-savol amallari`, exact: true }).click();
test("insert above/below, duplicate and arrow moves retain drafts and send complete orders", async ({ page }, testInfo) => {
  const { writes, rows } = await setup(page); await page.goto("/teacher/exams/order-exam");
  await page.getByRole("button", { name: "2 Savol 2", exact: true }).click();
  await openMenu(page, 2); await page.getByRole("button", { name: "Yuqorisiga qo‘shish", exact: true }).click();
  expect(writes).toEqual([]); await newShort(page, "Kiritilgan savol");
  expect(rows().map(q => q.id)).toEqual(["q1", "q6", "q2", "q3", "q4", "q5"]);
  await page.getByLabel("Savol matni", { exact: true }).fill("Saqlanmagan matn");
  const draft = await page.evaluate(() => localStorage.getItem("question-editor:order-exam:q6"));
  await openMenu(page, 2); await page.getByRole("button", { name: "Nusxa", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Savol nusxasi yaratildi");
  expect(rows().map(q => q.id)).toEqual(["q1", "q6", "q7", "q2", "q3", "q4", "q5"]);
  await expect(page.getByLabel("Savol matni", { exact: true })).toHaveValue("Kiritilgan savol");
  expect(await page.evaluate(() => localStorage.getItem("question-editor:order-exam:q6"))).toBe(draft);
  expect(await page.evaluate(() => localStorage.getItem("question-editor:order-exam:q7"))).toBeNull();
  await openMenu(page, 3); await page.getByRole("button", { name: "3-savolni pastga ko‘chirish", exact: true }).click();
  await expect(page.getByRole("button", { name: "4-savol amallari", exact: true })).toBeEnabled();
  expect(rows().map(q => q.id)).toEqual(["q1", "q6", "q2", "q7", "q3", "q4", "q5"]);
  await openMenu(page, 4); await page.getByRole("button", { name: "4-savolni yuqoriga ko‘chirish", exact: true }).click();
  await expect(page.getByRole("button", { name: "3-savol amallari", exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("question-order.png"), fullPage: true });
  await openMenu(page, 3); await page.getByRole("button", { name: "Pastiga qo‘shish", exact: true }).click();
  await page.reload(); await expect(page.getByText(/Yangi savol 3-savoldan keyin/)).toBeVisible();
  await newShort(page, "Pastdagi savol");
  expect(rows().map(q => q.id)).toEqual(["q1", "q6", "q7", "q8", "q2", "q3", "q4", "q5"]);
  expect(writes.map(w => w.method)).toEqual(["POST", "PUT", "POST", "PUT", "PUT", "PUT", "POST", "PUT"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("long jumps, target clamping and reload preserve the selected question's draft", async ({ page }) => {
  const { writes, rows } = await setup(page, 50); await page.goto("/teacher/exams/order-exam");
  await page.getByRole("button", { name: "40 Savol 40", exact: true }).click();
  await page.getByLabel("Savol matni", { exact: true }).fill("Mahalliy qoralama");
  await openMenu(page, 40);
  const target = page.getByLabel("40-savolni ko‘chirish manzili", { exact: true });
  await target.fill("3"); await target.press("Enter");
  await expect(page.getByRole("button", { name: "3-savol amallari", exact: true })).toBeEnabled(); expect(rows()[2].id).toBe("q40");
  await openMenu(page, 3); await page.getByLabel("3-savolni ko‘chirish manzili", { exact: true }).fill("48");
  await page.getByRole("button", { name: "3-savolni shu o‘ringa ko‘chirish", exact: true }).click();
  await expect(page.getByRole("button", { name: "48-savol amallari", exact: true })).toBeEnabled(); expect(rows()[47].id).toBe("q40");
  await page.reload(); await page.getByRole("button", { name: "48 Savol 40", exact: true }).click();
  await expect(page.getByLabel("Savol matni", { exact: true })).toHaveValue("Mahalliy qoralama");
  await openMenu(page, 48);
  await page.getByLabel("48-savolni ko‘chirish manzili", { exact: true }).fill("0");
  await page.getByLabel("48-savolni ko‘chirish manzili", { exact: true }).press("Enter");
  await expect(page.getByRole("button", { name: "1-savol amallari", exact: true })).toBeEnabled(); expect(rows()[0].id).toBe("q40");
  await openMenu(page, 1);
  await page.getByLabel("1-savolni ko‘chirish manzili", { exact: true }).fill("51");
  await page.getByLabel("1-savolni ko‘chirish manzili", { exact: true }).press("Enter");
  await expect(page.getByRole("button", { name: "50-savol amallari", exact: true })).toBeEnabled(); expect(rows()[49].id).toBe("q40");
  // Typing a slot and clicking away cancels it: nothing is sent.
  await openMenu(page, 50);
  const last = page.getByLabel("50-savolni ko‘chirish manzili", { exact: true }); await last.fill(""); await last.pressSequentially("abc");
  await page.getByLabel("Savol matni", { exact: true }).click(); expect(writes).toHaveLength(4);
  expect(writes.every(w => w.path.endsWith("/questions/order"))).toBe(true);
});

test("failed placement is retryable without duplicating the appended question", async ({ page }) => {
  const { writes, rows } = await setup(page, 5, true); await page.goto("/teacher/exams/order-exam");
  await page.getByRole("button", { name: "2 Savol 2", exact: true }).click();
  await openMenu(page, 2); await page.getByRole("button", { name: "Nusxa", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Savol oxirida saqlandi");
  expect(rows().at(-1)?.id).toBe("q6");
  await page.getByRole("button", { name: "Joylashni qayta urinish", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Savol joylashuvi saqlandi");
  expect(rows().map(q => q.id)).toEqual(["q1", "q2", "q6", "q3", "q4", "q5"]);
  expect(writes.map(w => w.method)).toEqual(["POST", "PUT", "PUT"]);
});
