import { test, expect, type APIRequestContext } from "@playwright/test";
const backend = "http://localhost:8000/api";
async function login(request: APIRequestContext, account: string) {
  const response = await request.post(`${backend}/auth/dev`, {
    data: { account },
  });
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  return { Authorization: `Bearer ${data.access_token}` };
}
test("student autosaves, resumes and submits a real examination", async ({
  page,
  request,
}, testInfo) => {
  const teacher = await login(request, "teacher");
  const title = `E2E tekshiruvi ${testInfo.project.name} ${Date.now()}`;
  const created = await request.post(`${backend}/teacher/exams`, {
    headers: teacher,
    data: {
      title,
      description:
        "Avtomatik brauzer tekshiruvi uchun aniq belgilangan vaqtinchalik sinov.",
      duration_minutes: 30,
    },
  });
  expect(created.ok()).toBeTruthy();
  const exam = await created.json();
  const questions = [
    {
      position: 1,
      kind: "single",
      text: "E2E: A variantini tanlang.",
      options: [
        { label: "A", text: "To‘g‘ri javob" },
        { label: "B", text: "Boshqa javob" },
      ],
      parts: [{ label: "main", accepted: ["A"] }],
    },
    {
      position: 2,
      kind: "two_part",
      text: "E2E: A va B qismlariga javob bering.",
      parts: [
        { label: "A", accepted: ["bir"] },
        { label: "B", accepted: ["ikki"] },
      ],
    },
  ];
  for (const question of questions) {
    const response = await request.post(
      `${backend}/teacher/exams/${exam.id}/questions`,
      { headers: teacher, data: question },
    );
    expect(response.ok()).toBeTruthy();
  }
  expect(
    (
      await request.post(`${backend}/teacher/exams/${exam.id}/publish`, {
        headers: teacher,
        data: { verified: true },
      })
    ).ok(),
  ).toBeTruthy();
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Talaba sifatida kirish" }).click();
  await expect(page.getByRole("heading", { name: /Salom/ })).toBeVisible();
  await page.goto("/exams");
  await page.getByRole("textbox", { name: "Sinov qidirish" }).fill(title);
  await page.getByRole("button", { name: "Testni boshlash" }).click();
  await page.getByRole("button", { name: "Boshlash", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "E2E: A variantini tanlang." }),
  ).toBeVisible();
  await page.getByLabel(/A.*To‘g‘ri javob/).check();
  await expect(page.getByText("Barcha javoblar saqlangan")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(/A.*To‘g‘ri javob/)).toBeChecked();
  await page
    .getByRole("button", { name: "Qayta ko‘rish", exact: true })
    .click();
  await page.getByRole("button", { name: "Keyingi", exact: true }).click();
  await page.getByRole("textbox", { name: "2-savol A javobi" }).fill("bir");
  await page.getByRole("textbox", { name: "2-savol B javobi" }).fill("ikki");
  await expect(page.getByText("Barcha javoblar saqlangan")).toBeVisible();
  await page.getByRole("button", { name: "Yakunlash", exact: true }).click();
  await page.getByRole("button", { name: "Tasdiqlash", exact: true }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("3.0 / 3.0 ball")).toBeVisible();
  await expect(
    page.getByText(/Javob kaliti o‘qituvchi ruxsatidan so‘ng ochiladi/),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  expect(consoleErrors).toEqual([]);
  await page.screenshot({
    path: `../data/qa-student-${testInfo.project.name}.png`,
    fullPage: true,
  });
  // Archive the explicitly identified test exam so it does not clutter the student catalogue.
  const admin = await login(request, "admin");
  expect(
    (
      await request.post(`${backend}/admin/exams/${exam.id}/release`, {
        headers: admin,
        data: { results_published: false, answer_released: true },
      })
    ).ok(),
  ).toBeTruthy();
});
test("teacher creates a draft and edits its answer key", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "O‘qituvchi sifatida kirish" })
    .click();
  await expect(page.getByRole("heading", { name: /Salom/ })).toBeVisible();
  await page.goto("/teacher");
  await page
    .getByRole("button", { name: "Yangi imtihon", exact: true })
    .click();
  const title = `E2E qoralama ${testInfo.project.name} ${Date.now()}`;
  await page.getByLabel("Imtihon nomi").fill(title);
  await page.getByRole("button", { name: "Qoralama yaratish" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  const content = {
    position: 1,
    kind: "short",
    text: "E2E: so‘zni yozing.",
    topic: "Tekshiruv",
    options: [],
    parts: [
      { label: "main", weight: 1, accepted: ["javob"], manual_review: true },
    ],
  };
  await page
    .getByRole("textbox", { name: "Savol tuzilishi" })
    .fill(JSON.stringify(content, null, 2));
  await page.getByRole("button", { name: "Savolni saqlash" }).click();
  await expect(page.getByText("Savol saqlandi", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /1 E2E: so‘zni yozing/ }).click();
  await expect(
    page.getByRole("textbox", { name: "Savol tuzilishi" }),
  ).toHaveValue(/javob/);
  await page.screenshot({
    path: `../data/qa-teacher-${testInfo.project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});
