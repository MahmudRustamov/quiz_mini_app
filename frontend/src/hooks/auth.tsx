import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, post } from "../services/api";
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
  const login = async (account?: string) => {
    setError("");
    setLoading(true);
    try {
      const tg = window.Telegram?.WebApp;
      if (account || tg?.initData) {
        const session = account
          ? await post<{ access_token: string }>("/auth/dev", { account })
          : await post<{ access_token: string }>("/auth/telegram", {
              init_data: tg?.initData,
            });
        sessionStorage.setItem("access_token", session.access_token);
      }
      setUser(await api<User>("/me"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kirishda xatolik");
      setUser(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    api<{ dev_auth: boolean }>("/config")
      .then((c) => setDevAuth(c.dev_auth))
      .catch(() =>
        setError("API bilan aloqa yo‘q. Backendni ishga tushiring."),
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
    if (sessionStorage.getItem("access_token") || tg?.initData) void login();
    else setLoading(false);
    const expired = () => {
      setUser(null);
      client.clear();
    };
    window.addEventListener("session-expired", expired);
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
    <Context.Provider value={{ user, loading, error, devAuth, login, logout }}>
      {children}
    </Context.Provider>
  );
}
export const useAuth = () => useContext(Context);
