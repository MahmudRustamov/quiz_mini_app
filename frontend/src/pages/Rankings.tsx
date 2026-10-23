import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { api } from "../services/api";
import type { Exam, Attempt } from "../types";
import { Empty, ErrorBox, Loading, PageTitle, fmt } from "../components/ui";
export default function Rankings() {
  const [exam, setExam] = useState("");
  const exams = useQuery({
      queryKey: ["exams"],
      queryFn: () => api<Exam[]>("/exams"),
    }),
    attempts = useQuery({
      queryKey: ["attempts"],
      queryFn: () => api<Attempt[]>("/attempts"),
    });
  const options = new Map<string, string>();
  exams.data?.forEach((e) => options.set(e.id, e.title));
  attempts.data?.forEach((a) =>
    options.set(a.exam_id, a.exam_title || "Imtihon"),
  );
  const selected = exam || [...options.keys()][0];
  const q = useQuery({
    queryKey: ["rankings", selected],
    queryFn: () =>
      api<{
        rows: {
          name: string;
          is_me: boolean;
          raw_percentage: number;
          final_score: number | null;
          grade: string | null;
        }[];
        message: string;
      }>(`/rankings?exam_id=${selected}`),
    enabled: !!selected,
  });
  return (
    <>
      <PageTitle
        eyebrow="BIRGA RIVOJLANAMIZ"
        title="Reyting"
        description="Natijalarni solishtiring va yangi maqsadlar qo‘ying."
        action={
          <div className="subject-icon">
            <Trophy size={28} />
          </div>
        }
      />
      <label className="field ranking-select">
        Imtihonni tanlang
        <select
          value={selected || ""}
          onChange={(e) => setExam(e.target.value)}
        >
          <option value="" disabled>
            Imtihon tanlang
          </option>
          {[...options].map(([id, title]) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
        </select>
      </label>
      {q.isLoading ? (
        <Loading />
      ) : q.error || exams.error || attempts.error ? (
        <ErrorBox error={q.error || exams.error || attempts.error} />
      ) : q.data?.rows.length ? (
        <div className="panel table-scroll">
          <p className="table-caption">{q.data.message}</p>
          <table>
            <thead>
              <tr>
                <th>O‘rin</th>
                <th>Talaba</th>
                <th>Xom natija</th>
                <th>Yakuniy ball</th>
                <th>Daraja</th>
              </tr>
            </thead>
            <tbody>
              {q.data.rows.map((row, i) => (
                <tr className={row.is_me ? "my-rank" : ""} key={i}>
                  <td>
                    <span className={`rank-number rank-${i + 1}`}>
                      {i < 3 ? <Trophy size={17} /> : i + 1}
                    </span>
                  </td>
                  <td>
                    {row.name}
                    {row.is_me && <small className="text-accent"> · Siz</small>}
                  </td>
                  <td>{fmt(row.raw_percentage)}%</td>
                  <td>{fmt(row.final_score, 2)}</td>
                  <td>{row.grade || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel">
          <Empty
            title="Reyting hali shakllanmadi"
            description={
              q.data?.message ||
              "Imtihon natijalari e’lon qilingach, reyting shu yerda paydo bo‘ladi."
            }
          />
        </div>
      )}
    </>
  );
}
