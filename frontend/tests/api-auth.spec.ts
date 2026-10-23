import { test, expect, type Page } from "@playwright/test";

const session = "frontend-regression-session-only";
const initData = "frontend-regression-initdata-only";
const user = {
  id: "test-user",
  name: "Regression Student",
  role: "student",
  telegram_id: 1234,
  avatar_url: null,
  active: true,
};

async function prepare(page: Page, telegram = false, cachedToken = "") {
  await page.route("https://telegram.org/js/telegram-web-app.js*", (route) =>
    route.fulfill({ contentType: "application/javascript", body: "" }),
  );
  await page.addInitScript(
    ({ telegram, cachedToken, initData }) => {
      if (cachedToken) sessionStorage.setItem("access_token", cachedToken);
      if (telegram)
        window.Telegram = {
          WebApp: {
            initData,
            colorScheme: "light",
            themeParams: {},
            ready() {},
            expand() {},
            onEvent() {},
            offEvent() {},
          },
        };
    },
    { telegram, cachedToken, initData },
  );
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path === "/api/config" ? { dev_auth: false } : [];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

test("ngrok header is scoped to development domains and preserves caller headers", async ({
  page,
}) => {
  await prepare(page);
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { requestHeaders, isNgrokDevelopmentUrl } =
      await import("/src/services/api.ts");
    sessionStorage.setItem("access_token", "stored-fixture");
    const options = {
      method: "POST",
      headers: {
        Authorization: "Bearer caller-fixture",
        "Content-Type": "application/problem+json",
        "X-Custom": "keep",
      },
      body: "{}",
    };
    const ngrok = Object.fromEntries(
      requestHeaders("https://test.ngrok-free.dev", options),
    );
    const regular = Object.fromEntries(
      requestHeaders("https://api.example.com", options),
    );
    const upload = requestHeaders("https://test.ngrok-free.dev", {
      body: new FormData(),
    });
    return {
      ngrok,
      regular,
      uploadContentType: upload.get("content-type"),
      urls: [
        "https://test.ngrok-free.app",
        "https://test.ngrok.io",
        "https://evilngrok-free.dev",
        "https://test.ngrok-free.dev.attacker.example",
        "http://localhost:8000",
      ].map(isNgrokDevelopmentUrl),
    };
  });
  expect(result.ngrok["ngrok-skip-browser-warning"]).toBe("true");
  expect(result.ngrok.authorization).toBe("Bearer caller-fixture");
  expect(result.ngrok["content-type"]).toBe("application/problem+json");
  expect(result.ngrok["x-custom"]).toBe("keep");
  expect(result.regular["ngrok-skip-browser-warning"]).toBeUndefined();
  expect(result.uploadContentType).toBeNull();
  expect(result.urls).toEqual([true, true, false, false, false]);
});

test("Telegram login stores token then sends authenticated GET me and reaches dashboard", async ({
  page,
}) => {
  await prepare(page, true);
  const calls: string[] = [];
  let correctToken = false,
    bypass = false;
  await page.route("**/api/auth/telegram", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ init_data: initData });
    calls.push("login");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ access_token: session }),
    });
  });
  await page.route("**/api/me", async (route) => {
    calls.push("me");
    correctToken =
      route.request().headers().authorization === `Bearer ${session}`;
    bypass = route.request().headers()["ngrok-skip-browser-warning"] === "true";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(user),
    });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Salom/ })).toBeVisible();
  expect(calls).toEqual(["login", "me"]);
  expect(correctToken).toBe(true);
  const apiUrl = await page.evaluate(
    async () => (await import("/src/services/api.ts")).API_URL,
  );
  if (apiUrl.includes("ngrok-free.dev")) expect(bypass).toBe(true);
  expect(
    await page.evaluate(() => sessionStorage.getItem("access_token")),
  ).toBe(session);
  await expect(
    page.getByRole("button", { name: "Talaba sifatida kirish" }),
  ).toHaveCount(0);
});

test("valid saved session restores without resubmitting possibly stale Telegram initData", async ({
  page,
}) => {
  await prepare(page, true, session);
  let logins = 0;
  await page.route("**/api/auth/telegram", async (route) => {
    logins++;
    await route.abort();
  });
  await page.route("**/api/me", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(user),
    }),
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Salom/ })).toBeVisible();
  expect(logins).toBe(0);
});

test("expired saved session refreshes once through Telegram", async ({
  page,
}) => {
  await prepare(page, true, "expired-fixture");
  let meCalls = 0,
    loginCalls = 0;
  await page.route("**/api/me", async (route) => {
    meCalls++;
    const expired =
      route.request().headers().authorization === "Bearer expired-fixture";
    await route.fulfill({
      status: expired ? 401 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        expired ? { detail: "Sessiya muddati tugadi" } : user,
      ),
    });
  });
  await page.route("**/api/auth/telegram", async (route) => {
    loginCalls++;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ access_token: session }),
    });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Salom/ })).toBeVisible();
  expect(meCalls).toBe(2);
  expect(loginCalls).toBe(1);
});

test("failed GET me is visible at the login screen and logs metadata only", async ({
  page,
}) => {
  await prepare(page, true);
  const logs: string[] = [];
  page.on("console", (event) => {
    if (event.text().startsWith("[api]") || event.text().startsWith("[auth]"))
      logs.push(event.text());
  });
  await page.route("**/api/auth/telegram", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ access_token: session }),
    }),
  );
  await page.route("**/api/me", (route) => route.abort("failed"));
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("GET /api/me");
  await expect(page.getByRole("alert")).toContainText("CORS");
  expect(logs.some((line) => line.includes("current_user"))).toBe(true);
  expect(logs.join(" ")).not.toContain(session);
  expect(logs.join(" ")).not.toContain(initData);
});

test("HTML warning, malformed JSON, HTTP errors and 401 retain useful semantics", async ({
  page,
}) => {
  await prepare(page);
  await page.goto("/");
  await page.route("**/api/probe*", async (route) => {
    const kind = new URL(route.request().url()).searchParams.get("kind");
    if (kind === "html")
      await route.fulfill({
        contentType: "text/html",
        body: "<html>ngrok warning fixture</html>",
      });
    else if (kind === "json")
      await route.fulfill({ contentType: "application/json", body: "{broken" });
    else if (kind === "unauthorized")
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: '{"detail":"Expired"}',
      });
    else
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: '{"detail":"Already submitted","submitted":true}',
      });
  });
  const result = await page.evaluate(async () => {
    const { api, ApiError } = await import("/src/services/api.ts");
    sessionStorage.setItem("access_token", "expired-fixture");
    let expired = 0;
    window.addEventListener("session-expired", () => expired++);
    const errors = [];
    for (const kind of ["html", "json", "conflict", "unauthorized"]) {
      try {
        await api(`/probe?kind=${kind}`);
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        errors.push({
          code: error.code,
          status: error.status,
          submitted: error.submitted,
          message: error.message,
        });
      }
    }
    return { errors, expired, token: sessionStorage.getItem("access_token") };
  });
  expect(result.errors.map((e) => e.code)).toEqual([
    "non_json",
    "invalid_json",
    "http",
    "http",
  ]);
  expect(result.errors[2].submitted).toBe(true);
  expect(result.errors[3].status).toBe(401);
  expect(
    result.errors.every((e) => e.message.startsWith("GET /api/probe:")),
  ).toBe(true);
  expect(result.expired).toBe(1);
  expect(result.token).toBeNull();
});

test("download shares ngrok bypass and Authorization handling", async ({
  page,
}) => {
  await prepare(page);
  await page.goto("/");
  let authorization = "",
    bypass = "";
  await page.route("**/api/export", async (route) => {
    authorization = route.request().headers().authorization || "";
    bypass = route.request().headers()["ngrok-skip-browser-warning"] || "";
    await route.fulfill({
      contentType: "text/csv",
      body: "student,score\nFixture,1\n",
    });
  });
  await page.evaluate(async () => {
    sessionStorage.setItem("access_token", "download-fixture");
    const { download } = await import("/src/services/api.ts");
    await download("/export", "regression.csv");
  });
  expect(authorization).toBe("Bearer download-fixture");
  const apiUrl = await page.evaluate(
    async () => (await import("/src/services/api.ts")).API_URL,
  );
  if (apiUrl.includes("ngrok-free.dev")) expect(bypass).toBe("true");
});
