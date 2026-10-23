import { GraduationCap, ArrowRight, ShieldCheck } from "lucide-react";
import { useAuth } from "../hooks/auth";
import { ErrorBox, Loading } from "../components/ui";
export default function Login() {
  const { loading, error, devAuth, login } = useAuth();
  return (
    <div className="login-page">
      <div className="login-art">
        <div className="brand-icon">
          <GraduationCap size={36} />
        </div>
        <span className="eyebrow">MILLIY SERTIFIKAT</span>
        <h1>
          Bilimingizga
          <br />
          ishonch bilan.
        </h1>
        <p>
          Har bir mashq — katta maqsad sari kichik qadam.
          <br />
          Sinovlar, tahlillar va rivojlanish bir joyda.
        </p>
        <div className="login-seal">
          <ShieldCheck />
          O‘zbek tilidagi ta’lim platformasi
        </div>
      </div>
      <div className="login-form">
        <GraduationCap size={38} className="text-accent" />
        <h2>Xush kelibsiz!</h2>
        <p>Shaxsiy kabinetingizga kirib, tayyorgarlikni davom ettiring.</p>
        {error && <ErrorBox error={error} />}{" "}
        {loading ? (
          <Loading />
        ) : (
          <>
            <button
              className="button primary full"
              disabled={!window.Telegram?.WebApp?.initData}
              onClick={() => void login()}
            >
              Telegram orqali kirish
              <ArrowRight size={18} />
            </button>
            {!window.Telegram?.WebApp?.initData && (
              <p className="muted small">
                Ilovani Telegram botidagi «Ilovani ochish» tugmasi orqali
                oching.
              </p>
            )}
            {devAuth && (
              <div className="dev-login">
                <span className="eyebrow">MAHALLIY ISHLAB CHIQISH</span>
                <p>Sinov hisobini tanlang</p>
                {["student", "teacher", "admin"].map((role, i) => (
                  <button
                    className="button secondary full"
                    key={role}
                    onClick={() => void login(role)}
                  >
                    {["Talaba", "O‘qituvchi", "Administrator"][i]} sifatida
                    kirish
                    <ArrowRight size={16} />
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        <small className="muted">
          Norasmiy imtihonlarga tayyorgarlik platformasi
        </small>
      </div>
    </div>
  );
}
