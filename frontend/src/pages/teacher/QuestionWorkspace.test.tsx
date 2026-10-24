import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, post, put } from "../../services/api";
import type { Exam, Question } from "../../types";
import * as model from "./questionModel";
import QuestionWorkspace from "./QuestionWorkspace";

vi.mock("../../services/api", () => ({ api: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock("../../components/ui", async importOriginal => ({ ...await importOriginal<typeof import("../../components/ui")>(), ProtectedImage: ({ path, alt }: { path: string; alt: string }) => <img src={`/assets/${path}`} alt={alt} /> }));
const examBase: Exam = { id: "order-exam", title: "Tartib sinovi", subject: "Til", description: "", duration_minutes: 60, question_count: 5, status: "draft", certificate_thresholds: {}, essay_required: false, expert_count: 1, answer_released: false, results_published: false };
const makeQuestions = (count: number): Question[] => Array.from({ length: count }, (_, i) => ({
  ...model.blankQuestion(i + 1, "short"), id: `q${i + 1}`, text: `Savol ${i + 1}`, topic: `Mavzu ${i + 1}`,
  parts: [{ ...model.newPart(), id: `p${i + 1}`, accepted: [`javob ${i + 1}`] }],
}));
function setup(count = 5, status = "draft") {
  let records = makeQuestions(count), serial = 0;
  const refresh = vi.fn<() => Promise<void>>();
  vi.mocked(post).mockImplementation(async (_path, body) => {
    const payload = body as model.QuestionInput;
    if (records.some(q => q.position === payload.position)) throw new Error("Bu savol raqami mavjud");
    const saved: Question = { ...payload, id: `copy${++serial}`, parts: payload.parts.map((p, i) => ({ ...p, id: `new-part-${i}` })) };
    records = [...records, saved]; return saved;
  });
  vi.mocked(put).mockImplementation(async (path, body) => {
    if (!path.endsWith("/questions/order")) throw new Error("Only full-list ordering is expected");
    const ids = (body as { question_ids: string[] }).question_ids;
    if (ids.length !== records.length || new Set(ids).size !== records.length || ids.some(id => !records.some(q => q.id === id))) throw new Error("Incomplete order");
    records = ids.map((id, i) => ({ ...records.find(q => q.id === id)!, position: i + 1 })); return { question_ids: ids };
  });
  function Harness() {
    const [exam, setExam] = useState({ ...examBase, status, questions: records, question_count: count });
    refresh.mockImplementation(async () => { setExam({ ...examBase, status, questions: records, question_count: records.length }); });
    return <QuestionWorkspace exam={exam} onRefresh={refresh} />;
  }
  const view = render(<Harness />);
  return { ...view, user: userEvent.setup(), rows: () => records, refresh };
}
async function fillNew(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText("Savol turi"), "short");
  await user.type(screen.getByLabelText("Savol matni"), "Yangi savol");
  await user.click(screen.getByRole("button", { name: "+ Javob (main)" }));
  await user.type(screen.getByLabelText("1-javob (main)"), "yangi javob");
}
const orderCalls = () => vi.mocked(put).mock.calls.map(([path, body]) => ({ path, body }));
beforeEach(() => { vi.resetAllMocks(); });

describe("question positioning inside the existing workspace", () => {
  it("owns image uploads, sends multipart FormData, and autosaves the returned path without saving a question", async () => {
    const { user } = setup(); vi.mocked(api).mockResolvedValueOnce({ path: "order-exam/upload.png" });
    const file = new File(["png"], "diagram.png", { type: "image/png" });
    await user.selectOptions(screen.getByLabelText("Savol turi"), "image");
    await user.upload(screen.getByLabelText("A variant rasmi: PNG yuklash"), file);
    expect(api).toHaveBeenCalledTimes(1);
    const [path, options] = vi.mocked(api).mock.calls[0];
    expect(path).toBe("/teacher/exams/order-exam/images"); expect(options?.method).toBe("POST");
    expect(options?.body).toBeInstanceOf(FormData); expect((options!.body as FormData).get("file")).toBe(file);
    expect(post).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(model.draftKey(examBase.id, null))!).options[0].image_path).toBe("order-exam/upload.png");
    await user.click(screen.getByRole("button", { name: "A variant rasmi: 1-rasmni olib tashlash" }));
    expect(JSON.parse(localStorage.getItem(model.draftKey(examBase.id, null))!).options[0].image_path).toBeNull();
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("shows upload failures without losing the question draft or sending a question write", async () => {
    const { user } = setup(); vi.mocked(api).mockRejectedValueOnce(new Error("Faqat PNG formatidagi rasm yuklang"));
    await user.type(screen.getByLabelText("Savol matni"), "Saqlansin");
    await user.upload(screen.getByLabelText("Savol rasmlari: PNG yuklash"), new File(["bad"], "false.png", { type: "image/png" }));
    await waitFor(() => expect(screen.getAllByRole("alert").some(el => el.textContent?.includes("Faqat PNG"))).toBe(true));
    expect(screen.getByLabelText("Savol matni")).toHaveValue("Saqlansin");
    expect(post).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Savol rasmlari: PNG yuklash")).toBeEnabled();
  });
  it.each([false, true])("inserts %s below the anchor only after an explicit valid save at the free end slot", async after => {
    const { user, rows } = setup();
    await user.click(screen.getByRole("button", { name: "2 Savol 2" }));
    await user.click(screen.getByRole("button", { name: after ? "+ Pastiga" : "+ Yuqorisiga" }));
    expect(post).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
    await fillNew(user); expect(post).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Savolni saqlash" }));
    await screen.findByText("Savol saqlandi");
    expect(vi.mocked(post).mock.calls[0][1]).toMatchObject({ position: 6, kind: "short", text: "Yangi savol" });
    const ids = after ? ["q1", "q2", "copy1", "q3", "q4", "q5"] : ["q1", "copy1", "q2", "q3", "q4", "q5"];
    expect(orderCalls()).toEqual([{ path: "/teacher/exams/order-exam/questions/order", body: { question_ids: ids } }]);
    expect(vi.mocked(post).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(put).mock.invocationCallOrder[0]);
    expect(rows().map(q => q.id)).toEqual(ids);
    expect(screen.getByLabelText("Savol matni")).toHaveValue("Yangi savol");
    expect(localStorage.getItem(`${model.draftKey(examBase.id, null)}:placement`)).toBeNull();
  });

  it("arrow moves send one complete list and retain the selected question's draft by id", async () => {
    const original = model.encode({ ...model.toInput(makeQuestions(5)[2]), text: "Qurilmadagi qoralama" });
    localStorage.setItem(model.draftKey(examBase.id, "q3"), original);
    const { user } = setup(); await user.click(screen.getByRole("button", { name: "3 Savol 3" }));
    await user.click(screen.getByRole("button", { name: "3-savolni yuqoriga ko‘chirish" }));
    await screen.findByText("Savollar tartibi saqlandi");
    expect(orderCalls()[0].body).toEqual({ question_ids: ["q1", "q3", "q2", "q4", "q5"] });
    expect(screen.getByLabelText("Savol matni")).toHaveValue("Qurilmadagi qoralama");
    expect(localStorage.getItem(model.draftKey(examBase.id, "q3"))).toBe(original);
    await user.click(screen.getByRole("button", { name: "2-savolni pastga ko‘chirish" }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(orderCalls()[1].body).toEqual({ question_ids: ["q1", "q2", "q3", "q4", "q5"] });
    expect(post).not.toHaveBeenCalled(); expect(api).not.toHaveBeenCalled();
  });

  it("moves question 40 to slot 3 and then slot 48 with Enter/blur", async () => {
    const { user, rows } = setup(50);
    await user.click(screen.getByRole("button", { name: "40 Savol 40" }));
    const input = screen.getByLabelText("40-savolni ko‘chirish manzili");
    await user.clear(input); await user.type(input, "3"); await user.keyboard("{Enter}");
    await screen.findByText("Savollar tartibi saqlandi");
    const first = makeQuestions(50).map(q => q.id); first.splice(39, 1); first.splice(2, 0, "q40");
    expect(orderCalls()[0].body).toEqual({ question_ids: first }); expect(rows()[2].id).toBe("q40");
    const moved = screen.getByLabelText("3-savolni ko‘chirish manzili");
    fireEvent.change(moved, { target: { value: "48" } }); fireEvent.blur(moved);
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    const second = first.filter(id => id !== "q40"); second.splice(47, 0, "q40");
    expect(orderCalls()[1].body).toEqual({ question_ids: second }); expect(rows()[47].id).toBe("q40");
  });

  it.each([["0", 1], ["6", 5], ["abc", 3], ["3", 3], ["2.5", 3], ["", 3]])("clamps or ignores target %s", async (raw, final) => {
    const { user, rows } = setup(); await user.click(screen.getByRole("button", { name: "3 Savol 3" }));
    const input = screen.getByLabelText("3-savolni ko‘chirish manzili");
    fireEvent.change(input, { target: { value: raw } }); fireEvent.blur(input);
    if (final === 3) expect(put).not.toHaveBeenCalled(); else await screen.findByText("Savollar tartibi saqlandi");
    expect(rows()[final - 1].id).toBe("q3");
  });

  it("duplicates only the stored question and selects the copy, retaining original and new local drafts", async () => {
    const source = model.toInput(makeQuestions(5)[1]), draft = model.encode({ ...source, text: "Saqlanmagan matn" });
    localStorage.setItem(model.draftKey(examBase.id, "q2"), draft);
    localStorage.setItem(model.draftKey(examBase.id, null), "unfinished-new-buffer");
    const { user } = setup(); await user.click(screen.getByRole("button", { name: "2 Savol 2" }));
    expect(screen.getByLabelText("Savol matni")).toHaveValue("Saqlanmagan matn");
    await user.click(screen.getByRole("button", { name: "Nusxa" }));
    await screen.findByText("Savol nusxasi yaratildi");
    expect(post).toHaveBeenCalledExactlyOnceWith("/teacher/exams/order-exam/questions", { ...source, position: 6 });
    expect(orderCalls()[0].body).toEqual({ question_ids: ["q1", "q2", "copy1", "q3", "q4", "q5"] });
    expect(screen.getByLabelText("Savol matni")).toHaveValue("Savol 2");
    expect(localStorage.getItem(model.draftKey(examBase.id, "q2"))).toBe(draft);
    expect(localStorage.getItem(model.draftKey(examBase.id, "copy1"))).toBeNull();
    expect(localStorage.getItem(model.draftKey(examBase.id, null))).toBe("unfinished-new-buffer");
  });

  it("recovers a failed second step without creating a second copy", async () => {
    const { user, rows } = setup();
    vi.mocked(put).mockRejectedValueOnce(new Error("Tarmoq xatosi"));
    await user.click(screen.getByRole("button", { name: "2 Savol 2" }));
    await user.click(screen.getByRole("button", { name: "Nusxa" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Savol oxirida saqlandi"));
    expect(rows().at(-1)?.id).toBe("copy1");
    await user.click(screen.getByRole("button", { name: "Joylashni qayta urinish" }));
    await screen.findByText("Savol joylashuvi saqlandi");
    expect(post).toHaveBeenCalledTimes(1); expect(put).toHaveBeenCalledTimes(2);
    expect(rows().map(q => q.id)).toEqual(["q1", "q2", "copy1", "q3", "q4", "q5"]);
  });

  it("hides new order controls outside drafts and disables all of them while busy", async () => {
    const { user, unmount } = setup(5, "published"); await user.click(screen.getByRole("button", { name: "2 Savol 2" }));
    expect(screen.queryByLabelText("Savol joylashuvi")).not.toBeInTheDocument(); unmount();
    setup(); vi.mocked(put).mockImplementationOnce(() => new Promise(() => {}));
    await user.click(screen.getByRole("button", { name: "2 Savol 2" }));
    await user.click(screen.getByRole("button", { name: "2-savolni yuqoriga ko‘chirish" }));
    for (const name of ["+ Pastiga", "+ Yuqorisiga", "Nusxa", "2-savolni pastga ko‘chirish"]) expect(screen.getByRole("button", { name })).toBeDisabled();
    expect(screen.getByLabelText("2-savolni ko‘chirish manzili")).toBeDisabled();
  });

  it("validates each rail question once per buffer change and skips validation for selection-only renders", async () => {
    const spy = vi.spyOn(model, "inspectBuffer"), unchanged = model.encode(model.toInput(makeQuestions(50)[1]));
    const { user } = setup(50); spy.mockClear();
    await user.click(screen.getByRole("button", { name: "1 Savol 1" }));
    expect(spy.mock.calls.filter(([buffer]) => buffer === unchanged)).toHaveLength(0);
    await user.type(screen.getByLabelText("Savol matni"), "x");
    expect(spy.mock.calls.filter(([buffer]) => buffer === unchanged)).toHaveLength(1);
    spy.mockRestore();
  });
});
