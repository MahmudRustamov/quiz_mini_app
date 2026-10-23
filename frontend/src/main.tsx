import React from "react";
import ReactDOM from "react-dom/client";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./hooks/auth";
import Layout from "./components/Layout";
import { Empty, Loading } from "./components/ui";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Exams from "./pages/Exams";
import ExamSession from "./pages/ExamSession";
import Results, { ResultDetail } from "./pages/Results";
import Rankings from "./pages/Rankings";
import Profile from "./pages/Profile";
const Teacher = React.lazy(() => import("./pages/Teacher"));
const ExamEditor = React.lazy(() =>
  import("./pages/Teacher").then((m) => ({ default: m.ExamEditor })),
);
const Assessment = React.lazy(() =>
  import("./pages/Teacher").then((m) => ({ default: m.Assessment })),
);
const Students = React.lazy(() =>
  import("./pages/Teacher").then((m) => ({ default: m.Students })),
);
const RubricManager = React.lazy(() =>
  import("./pages/Teacher").then((m) => ({ default: m.RubricManager })),
);
const AuditPage = React.lazy(() =>
  import("./pages/Teacher").then((m) => ({ default: m.AuditPage })),
);
import "./styles.css";
const savedTheme = localStorage.getItem("theme");
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 20000, refetchOnWindowFocus: true },
  },
});
function TeacherOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return user?.role === "student" ? <Navigate to="/" replace /> : children;
}
function App() {
  const { user, loading } = useAuth();
  const location = useLocation();
  React.useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);
  if (loading) return <Loading />;
  if (!user) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="exams" element={<Exams />} />
        <Route path="exam/:id" element={<ExamSession />} />
        <Route path="results" element={<Results />} />
        <Route path="results/:id" element={<ResultDetail />} />
        <Route path="rankings" element={<Rankings />} />
        <Route path="profile" element={<Profile />} />
        <Route
          path="teacher"
          element={
            <TeacherOnly>
              <Teacher />
            </TeacherOnly>
          }
        />
        <Route
          path="teacher/exams/:id"
          element={
            <TeacherOnly>
              <ExamEditor />
            </TeacherOnly>
          }
        />
        <Route
          path="teacher/attempts/:id"
          element={
            <TeacherOnly>
              <Assessment />
            </TeacherOnly>
          }
        />
        <Route
          path="teacher/students"
          element={
            <TeacherOnly>
              <Students />
            </TeacherOnly>
          }
        />
        <Route
          path="teacher/rubrics"
          element={
            <TeacherOnly>
              <RubricManager />
            </TeacherOnly>
          }
        />
        <Route
          path="teacher/audit"
          element={
            <TeacherOnly>
              <AuditPage />
            </TeacherOnly>
          }
        />
        <Route
          path="*"
          element={
            <Empty
              title="Sahifa topilmadi"
              description="Menyu orqali kerakli sahifaga o‘ting."
            />
          }
        />
      </Route>
    </Routes>
  );
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <React.Suspense fallback={<Loading />}>
            <App />
          </React.Suspense>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
