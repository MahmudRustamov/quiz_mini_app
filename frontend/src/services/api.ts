// Vite replaces this value at build time. Never use localhost in a deployed build.
export const API_URL = (
  import.meta.env.VITE_API_URL?.trim() ||
  (import.meta.env.DEV ? "http://localhost:8000" : "")
).replace(/\/+$/, "");

type ErrorCode =
  "network" | "http" | "non_json" | "invalid_json" | "configuration";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public submitted = false,
    public code: ErrorCode = "http",
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isNgrokDevelopmentUrl(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl);
    return [".ngrok-free.dev", ".ngrok-free.app", ".ngrok.io"].some((suffix) =>
      hostname.endsWith(suffix),
    );
  } catch {
    return false;
  }
}

export function requestHeaders(
  baseUrl: string,
  options: RequestInit = {},
): Headers {
  const headers = new Headers(options.headers);
  const token = sessionStorage.getItem("access_token");
  if (token && !headers.has("Authorization"))
    headers.set("Authorization", `Bearer ${token}`);
  if (
    options.body &&
    !(options.body instanceof FormData) &&
    !headers.has("Content-Type")
  )
    headers.set("Content-Type", "application/json");
  if (isNgrokDevelopmentUrl(baseUrl))
    headers.set("ngrok-skip-browser-warning", "true");
  return headers;
}

function failure(
  path: string,
  method: string,
  status: number,
  code: ErrorCode,
  message: string,
  submitted = false,
): ApiError {
  // Deliberately exclude bodies, headers, query strings, tokens and exception objects.
  const endpoint = `/api${path.split(/[?#]/, 1)[0]}`;
  console.warn("[api] request_failed", { method, endpoint, status, code });
  return new ApiError(
    status,
    `${method} ${endpoint}: ${message}`,
    submitted,
    code,
  );
}

/** Shared transport for JSON, protected images and downloads. */
export async function apiFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const method = (options.method || "GET").toUpperCase();
  if (!API_URL) {
    throw failure(
      path,
      method,
      0,
      "configuration",
      "VITE_API_URL sozlanmagan. Frontendni to‘g‘ri API manzili bilan qayta joylashtiring.",
    );
  }
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api${path}`, {
      ...options,
      headers: requestHeaders(API_URL, options),
    });
  } catch {
    throw failure(
      path,
      method,
      0,
      "network",
      "Serverga ulanib bo‘lmadi. Internet, API manzili va CORS sozlamalarini tekshiring.",
    );
  }
  if (response.status === 401) {
    sessionStorage.removeItem("access_token");
    window.dispatchEvent(new Event("session-expired"));
  }
  if (!response.ok) {
    const error: { detail?: unknown; submitted?: unknown } = await response
      .json()
      .catch(() => ({}));
    throw failure(
      path,
      method,
      response.status,
      "http",
      typeof error.detail === "string"
        ? error.detail
        : `Server xatosi (${response.status}).`,
      error.submitted === true,
    );
  }
  if (
    response.headers.get("content-type")?.toLowerCase().includes("text/html")
  ) {
    throw failure(
      path,
      method,
      response.status,
      "non_json",
      "API o‘rniga HTML sahifa qaytdi. API manzili yoki tunnel javobini tekshiring.",
    );
  }
  return response;
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await apiFetch(path, options);
  const method = (options.method || "GET").toUpperCase();
  const contentType =
    response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() || "";
  if (contentType !== "application/json" && !contentType.endsWith("+json")) {
    throw failure(
      path,
      method,
      response.status,
      "non_json",
      "Server JSON javobini qaytarmadi. API manzilini tekshiring.",
    );
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw failure(
      path,
      method,
      response.status,
      "invalid_json",
      "Server javobini o‘qib bo‘lmadi. Qayta urinib ko‘ring.",
    );
  }
}
export const post = <T>(path: string, body: unknown = {}) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
export const put = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "PUT", body: JSON.stringify(body) });
export async function download(path: string, filename: string) {
  const response = await apiFetch(path);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
