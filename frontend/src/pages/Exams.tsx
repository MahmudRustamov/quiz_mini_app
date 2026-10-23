import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, SlidersHorizontal } from "lucide-react";
import { api } from "../services/api";
import type { Exam, Attempt } from "../types";
import { Empty, ErrorBox, Loading, PageTitle } from "../components/ui";
import { ExamCard } from "../features/exams";
export default function Exams() {
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all");
  const exams = useQuery({
      queryKey: ["exams"],
      queryFn: () => api<Exam[]>("/exams"),
    }),
    attempts = useQuery({
      queryKey: ["attempts"],
      queryFn: () => api<Attempt[]>("/attempts"),
    });
  const filtered = (exams.data || [])
    .filter((e) =>
      `${e.title} ${e.subject}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
    )
    .filter(
      (e) =>
        filter === "all" ||
        (filter === "new"
          ? !attempts.data?.find((a) => a.exam_id === e.id)
          : attempts.data?.some(
              (a) => a.exam_id === e.id && a.status === filter,
            )),
    );
  return (
    <>
      <PageTitle
        eyebrow="BILIMINGIZNI SINANG"
        title="Sinov imtihonlari"
        description="O‘zingizga mos sinovni tanlang va tayyorgarlik darajangizni aniqlang."
      />
      <div className="filter-bar">
        <div className="tabs">
          {[
            ["all", "Barchasi"],
            ["new", "Boshlanmagan"],
            ["in_progress", "Jarayonda"],
            ["submitted", "Yakunlangan"],
          ].map(([v, l]) => (
            <button
              key={v}
              className={filter === v ? "selected" : ""}
              onClick={() => setFilter(v)}
            >
              {l}
            </button>
          ))}
        </div>
        <label className="search-box">
          <Search size={18} />
          <input
            aria-label="Sinov qidirish"
            placeholder="Sinov qidirish…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {exams.error || attempts.error ? (
        <ErrorBox error={exams.error || attempts.error} />
      ) : exams.isLoading || attempts.isLoading ? (
        <Loading />
      ) : filtered.length ? (
        <div className="exam-grid">
          {filtered.map((e) => (
            <ExamCard
              key={e.id}
              exam={e}
              attempt={attempts.data?.find((a) => a.exam_id === e.id)}
            />
          ))}
        </div>
      ) : (
        <div className="panel">
          <Empty
            title="Sinovlar topilmadi"
            description="E’lon qilingan imtihonlar shu sahifada ko‘rinadi. Qidiruv yoki filtrni o‘zgartirib ko‘ring."
          />
        </div>
      )}
      <div className="info-note">
        <SlidersHorizontal size={19} />
        <p>
          Savol turlari va ball og‘irliklari har bir imtihon uchun alohida
          belgilanadi.
        </p>
      </div>
    </>
  );
}
