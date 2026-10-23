import { NavLink, Outlet, Link } from "react-router-dom";
import {
  BookOpen,
  ChartNoAxesCombined,
  ChevronRight,
  GraduationCap,
  House,
  Moon,
  Settings2,
  ShieldCheck,
  Sun,
  Trophy,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "../hooks/auth";
const nav = [
  { to: "/", label: "Bosh sahifa", icon: House },
  { to: "/exams", label: "Testlar", icon: BookOpen },
  { to: "/results", label: "Natijalar", icon: ChartNoAxesCombined },
  { to: "/rankings", label: "Reyting", icon: Trophy },
  { to: "/profile", label: "Profil", icon: UserRound },
];
export function Brand() {
  return (
    <Link to="/" className="brand">
      <span className="brand-icon">
        <GraduationCap size={25} />
      </span>
      <span>
        Milliy
        <span className="brand-second">
          Sertifikat<span className="brand-dot">.</span>
        </span>
      </span>
    </Link>
  );
}
export default function Layout() {
  const { user } = useAuth();
  const [dark, setDark] = useState(
    document.documentElement.dataset.theme === "dark",
  );
  const toggle = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("theme", next);
    setDark(!dark);
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="nav-caption">SHAXSIY KABINET</div>
        <nav>
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                isActive ? "nav-item active" : "nav-item"
              }
            >
              <Icon size={20} />
              <span>{label}</span>
              <ChevronRight size={15} className="nav-chevron" />
            </NavLink>
          ))}
          {user?.role !== "student" && (
            <NavLink to="/teacher" className="nav-item teacher-nav">
              <Settings2 size={20} />
              <span>O‘qituvchi paneli</span>
            </NavLink>
          )}
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={22} />
          <strong>Har bir sinov — bir qadam</strong>
          <p>
            Bilimingizni sinang. Natijangizni kuzating. Maqsadingizga
            yaqinlashing.
          </p>
        </div>
        <div className="sidebar-footer">
          <span className="live-dot" />
          Milliy Sertifikat platformasi<span>v1.0</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="mobile-brand">
            <Brand />
          </div>
          <div className="breadcrumb">
            Shaxsiy kabinet <ChevronRight size={14} />
            <span>O‘quv platformasi</span>
          </div>
          <div className="topbar-actions">
            <span className="platform-tag">
              <span className="live-dot" /> Bilim sari birga
            </span>
            <button
              className="icon-button"
              aria-label={dark ? "Yorug‘ mavzu" : "Qorong‘i mavzu"}
              onClick={toggle}
            >
              {dark ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <Link to="/profile" className="top-profile">
              <div className="avatar">{user?.name[0]}</div>
              <div>
                <strong>{user?.name}</strong>
                <small>
                  {user?.role === "student" ? "Talaba" : "O‘qituvchi"}
                </small>
              </div>
            </Link>
          </div>
        </header>
        <main>
          <Outlet />
        </main>
        <footer className="main-footer">
          <span>© {new Date().getFullYear()} Milliy Sertifikat</span>
          <span>Bilimingizga ishonch bilan.</span>
          <span>Norasmiy sinov platformasi</span>
        </footer>
      </div>
      <nav className="bottom-nav">
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === "/"}>
            <Icon size={21} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
