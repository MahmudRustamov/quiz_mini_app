import { Link } from "react-router-dom";
import { GraduationCap, LogOut, Settings2, ShieldCheck } from "lucide-react";
import { useAuth } from "../hooks/auth";
import { PageTitle, ErrorBox, Pill } from "../components/ui";
import { useState } from "react";
export default function Profile() {
  const { user, logout } = useAuth();
  const [error, setError] = useState("");
  return (
    <>
      <PageTitle
        eyebrow="SHAXSIY KABINET"
        title="Mening profilim"
        description="Hisobingiz va platformadagi rolingiz."
      />
      <div className="panel profile-card">
        <div className="large-avatar">{user?.name[0]}</div>
        <h2>{user?.name}</h2>
        <Pill>
          {user?.role === "admin"
            ? "Administrator"
            : user?.role === "teacher"
              ? "O‘qituvchi"
              : "Talaba"}
        </Pill>
        <dl>
          <div>
            <dt>Telegram ID</dt>
            <dd>{user?.telegram_id}</dd>
          </div>
          <div>
            <dt>Hisob holati</dt>
            <dd className="text-accent">
              <ShieldCheck size={16} />
              Faol
            </dd>
          </div>
          <div>
            <dt>Platforma</dt>
            <dd>
              <GraduationCap size={16} />
              Milliy Sertifikat
            </dd>
          </div>
        </dl>
        {user?.role !== "student" && (
          <Link className="button primary full" to="/teacher">
            <Settings2 size={18} />
            O‘qituvchi paneli
          </Link>
        )}
        {error && <ErrorBox error={error} />}
        <button
          className="button secondary full"
          onClick={() => void logout().catch((e) => setError(e.message))}
        >
          <LogOut size={18} />
          Hisobdan chiqish
        </button>
        <p className="muted small">
          Platforma natijalari norasmiy sinov uchun mo‘ljallangan.
        </p>
      </div>
    </>
  );
}
