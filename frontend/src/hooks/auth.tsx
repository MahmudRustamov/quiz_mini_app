import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, post, ApiError } from "../services/api";
import type { User } from "../types";
interface TelegramApp {
  initData: string;
  colorScheme: "light" | "dark";
  themeParams: Record<string, string>;
  ready: () => void;
  expand: () => void;
  onEvent: (name: string, cb: () => void) => void;
  offEvent: (name: string, cb: () => void) => void;
}
declare global {
  interface Window {
    Telegram?: { WebApp: TelegramApp };
  }
}
interface Auth {
  user: User | null;
  loading: boolean;
  error: string;
  devAuth: boolean;
  login: (account?: string) => Promise<void>;
  logout: () => Promise<void>;
}
const Context = createContext<Auth>(null!);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [devAuth, setDevAuth] = useState(false);
  const client = useQueryClient();
  const inFlight = useRef<Promise<void> | null>(null);
  const [configError, setConfigError] = useState("");
  const login = (account?: string): Promise<void> => {
    // React StrictMode may run startup twice. Share the same authentication chain.
    if (inFlight.current) return inFlight.current;
    const work = async () => {
      setError("");
      setLoading(true);
      let stage = "restore_session";
      try {
        const initData = window.Telegram?.WebApp?.initData;
        if (!account && sessionStorage.getItem("access_token")) {
          try {
            setUser(await api<User>("/me"));
            return;
          } catch (e) {
            // Only an expired/rejected session should trigger fresh Telegram auth.
            if (!(e instanceof ApiError) || e.status !== 401 || !initData)
              throw e;
          }
        }
        stage = account ? "development_login" : "telegram_login";
        if (!account && !initData) {
          throw new Error(
            "Ilovani Telegram botidagi «Ilovani ochish» tugmasi orqali oching.",
          );
        }
        const session = account
          ? await post<{ access_token: string }>("/auth/dev", { account })
          : await post<{ access_token: string }>("/auth/telegram", {
              init_data: initData,
            });
        if (
          typeof session.access_token !== "string" ||
          !session.access_token.trim()
        ) {
          throw new Error("Server sessiya tokenini qaytarmadi.");
        }
        stage = "store_session";
        sessionStorage.setItem("access_token", session.access_token);
        stage = "current_user";
        setUser(await api<User>("/me"));
      } catch (e) {
        // Log metadata only, never the exception, response or Telegram payload.
        console.warn("[auth] login_failed", {
          stage,
          status: e instanceof ApiError ? e.status : 0,
          code: e instanceof ApiError ? e.code : "client_error",
        });
        setError(e instanceof Error ? e.message : "Kirishda xatolik");
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    const task = work();
    inFlight.current = task;
    void task.finally(() => {
      if (inFlight.current === task) inFlight.current = null;
    });
    return task;
  };
  useEffect(() => {
    api<{ dev_auth: boolean }>("/config")
      .then((c) => setDevAuth(c.dev_auth))
      .catch((e: unknown) =>
        setConfigError(
          e instanceof Error ? e.message : "API sozlamalarini yuklab bo‘lmadi.",
        ),
      );
    const tg = window.Telegram?.WebApp;
    tg?.ready();
    tg?.expand();
    const theme = () => {
      if (!localStorage.getItem("theme"))
        document.documentElement.dataset.theme = tg?.colorScheme || "light";
    };
    theme();
    tg?.onEvent("themeChanged", theme);
    const expired = () => {
      setUser(null);
      client.clear();
    };
    window.addEventListener("session-expired", expired);
    if (sessionStorage.getItem("access_token") || tg?.initData) void login();
    else setLoading(false);
    return () => {
      tg?.offEvent("themeChanged", theme);
      window.removeEventListener("session-expired", expired);
    };
  }, []);
  const logout = async () => {
    await post("/auth/logout");
    sessionStorage.removeItem("access_token");
    setUser(null);
    client.clear();
  };
  return (
    <Context.Provider
      value={{
        user,
        loading,
        error: error || configError,
        devAuth,
        login,
        logout,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useAuth = () => useContext(Context);
