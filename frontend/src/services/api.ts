export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public submitted = false,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = sessionStorage.getItem("access_token");
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const response = await fetch(`${API_URL}/api${path}`, {
    ...options,
    headers,
  });
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ detail: "Server bilan bog‘lanib bo‘lmadi" }));
    const message =
      typeof error.detail === "string"
        ? error.detail
        : "Kiritilgan ma’lumotlarni tekshiring";
    if (response.status === 401) {
      sessionStorage.removeItem("access_token");
      window.dispatchEvent(new Event("session-expired"));
    }
    throw new ApiError(response.status, message, Boolean(error.submitted));
  }
  return response.json() as Promise<T>;
}
export const post = <T>(path: string, body: unknown = {}) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
export const put = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "PUT", body: JSON.stringify(body) });
export async function download(path: string, filename: string) {
  const response = await fetch(`${API_URL}/api${path}`, {
    headers: {
      Authorization: `Bearer ${sessionStorage.getItem("access_token")}`,
    },
  });
  if (!response.ok) throw new Error("Yuklab bo‘lmadi");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
