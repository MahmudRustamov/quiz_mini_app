import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import QuestionEditor from "./QuestionEditor";
import { blankQuestion, encode, newPart, type Kind, type QuestionInput, type UploadImage } from "./questionModel";

vi.mock("../../components/ui", async importOriginal => ({ ...await importOriginal<typeof import("../../components/ui")>(), ProtectedImage: ({ path, alt }: { path: string; alt: string }) => <img src={`/assets/${path}`} alt={alt} /> }));

function setup(kind: Kind = "single", initial?: QuestionInput, onUpload?: UploadImage) {
  const save = vi.fn().mockResolvedValue(undefined);
  function Harness() {
    const [buffer, setBuffer] = useState(encode(initial || blankQuestion(3, kind)));
    return <QuestionEditor buffer={buffer} position={3} editing={false} editable busy={false} onChange={setBuffer} onSave={save} onUpload={onUpload} />;
  }
  render(<Harness />);
  return { user: userEvent.setup(), save };
}
async function common(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Savol matni"), "Savol matni?");
  await user.clear(screen.getByLabelText("Mavzu")); await user.type(screen.getByLabelText("Mavzu"), "Tilshunoslik");
}
const shared = { position: 3, text: "Savol matni?", topic: "Tilshunoslik", passage_id: null, image_paths: [] };

describe("question forms and exact API payloads", () => {
  it("offers option images only for picture questions, or when an option already has one", () => {
    const upload = vi.fn();
    const first = setup("single", undefined, upload);
    expect(screen.queryByLabelText("A variant rasmi: PNG yuklash")).toBeNull();
    expect(screen.getByLabelText("Savol rasmlari: PNG yuklash")).toBeInTheDocument();
    cleanup(); void first;
    setup("image", undefined, upload);
    for (const label of ["A", "B", "C", "D"]) expect(screen.getByLabelText(`${label} variant rasmi: PNG yuklash`)).toBeInTheDocument();
    cleanup();
    // A plain test that already carries an option image must not hide data students will see.
    const legacy = blankQuestion(3);
    setup("single", { ...legacy, options: legacy.options.map((o, i) => i ? o : { ...o, image_path: "exam/old.png" }) }, upload);
    expect(screen.getByLabelText("A variant rasmi: PNG yuklash")).toBeInTheDocument();
  });
  it("saves image-only choices and question images, synchronizes JSON, and validates removal", async () => {
    const initial = { ...blankQuestion(3, "image"), text: "Rasmni tanlang", options: blankQuestion(3).options.map((o, i) => ({ ...o, text: i ? `${o.label} matn` : "" })), parts: [{ ...newPart(), accepted: ["A"] }] };
    const upload = vi.fn().mockResolvedValueOnce("exam/question.png").mockResolvedValueOnce("exam/option.png");
    const { user, save } = setup("image", initial, upload);
    await user.upload(screen.getByLabelText("Savol rasmlari: PNG yuklash"), new File(["png"], "question.png", { type: "image/png" }));
    expect(screen.getByRole("button", { name: "Savolni saqlash" })).toBeDisabled();
    await user.upload(screen.getByLabelText("A variant rasmi: PNG yuklash"), new File(["png"], "option.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: "Savolni saqlash" }));
    expect(save).toHaveBeenCalledExactlyOnceWith({ ...initial, image_paths: ["exam/question.png"], options: initial.options.map((o, i) => i ? o : { ...o, image_path: "exam/option.png" }) });
    await user.click(screen.getByRole("tab", { name: "JSON" }));
    expect(JSON.parse((screen.getByLabelText("Savol tuzilishi") as HTMLTextAreaElement).value).options[0].image_path).toBe("exam/option.png");
    await user.click(screen.getByRole("tab", { name: "Forma" }));
    await user.click(screen.getByRole("button", { name: "A variant rasmi: 1-rasmni olib tashlash" }));
    expect(screen.getByRole("button", { name: "Savolni saqlash" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Savol rasmlari: 1-rasmni olib tashlash" }));
    expect(screen.queryByAltText("Savol rasmlari 1")).not.toBeInTheDocument();
  });

  it("uploads an image-only matching option while preserving the left-hand part label", async () => {
    const initial = { ...blankQuestion(3, "matching"), text: "Moslang", parts: [{ ...newPart("left-id"), prompt: "Chap" }] };
    const { user, save } = setup("matching", initial, vi.fn().mockResolvedValue("exam/right.png"));
    await user.upload(screen.getByLabelText("left-id mos variant rasmi: PNG yuklash"), new File(["png"], "right.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: "Savolni saqlash" }));
    expect(save).toHaveBeenCalledExactlyOnceWith({ ...initial, options: [{ label: "R1", text: "", image_path: "exam/right.png" }], parts: [{ ...initial.parts[0], accepted: ["R1"] }] });
  });
  it("selects a single answer and saves exactly QuestionInput", async () => {
    const { user, save } = setup(); await common(user);
    for (const label of ["A", "B", "C", "D"]) await user.type(screen.getByLabelText(`${label} variant`), `${label} matn`);
    await user.click(screen.getByRole("radio", { name: "C" }));
    await user.click(screen.getByRole("button", { name: "Savolni saqlash" }));
    expect(save).toHaveBeenCalledExactlyOnceWith({ ...shared, kind: "single", options: ["A", "B", "C", "D"].map(label => ({ label, text: `${label} matn`, image_path: null })), parts: [{ ...newPart(), accepted: ["C"] }] });
    expect(screen.getByLabelText("Javob kaliti")).toHaveTextContent("main: C");
  });

  it("adds/removes matching rows, retaining surviving labels and translating to options/parts", async () => {
    const { user, save } = setup("matching"); await common(user);
    await user.click(screen.getByRole("button", { name: "+ Juftlik" }));
    await user.click(screen.getByRole("button", { name: "+ Juftlik" }));
    await user.type(screen.getByLabelText("Chap matn (p1)"), "Birinchi");
    await user.type(screen.getByLabelText("Mos o‘ng matn (p1)"), "Bir");
    await user.type(screen.getByLabelText("Chap matn (p2)"), "Ikkinchi");
    await user.type(screen.getByLabelText("Mos o‘ng matn (p2)"), "Ikki");
    await user.click(screen.getByRole("button", { name: "p1 juftligini o‘chirish" }));
    expect(screen.getByLabelText("Chap matn (p2)")).toHaveValue("Ikkinchi");
    await user.click(screen.getByRole("button", { name: "Savolni saqlash" }));
    expect(save).toHaveBeenCalledExactlyOnceWith({ ...shared, kind: "matching", options: [{ label: "R2", text: "Ikki", image_path: null }], parts: [{ ...newPart("p2"), prompt: "Ikkinchi", accepted: ["R2"] }] });
  });

  it("repairs an incomplete matching key in the form without replacing its part label", async () => {
    const initial = { ...blankQuestion(3, "matching"), text: "Moslang", parts: [{ ...newPart("left-id"), prompt: "Chap" }] };
    const { user, save } = setup("matching", initial);
    await user.type(screen.getByLabelText("Mos o‘ng matn (left-id)"), "O‘ng");
    await user.click(screen.getByRole("button", { name: "Savolni saqlash" }));
    expect(save).toHaveBeenCalledExactlyOnceWith({ ...initial, options: [{ label: "R1", text: "O‘ng", image_path: null }], parts: [{ ...initial.parts[0], accepted: ["R1"] }] });
  });

  it("keeps accepted written answers verbatim and preserves review/case flags", async () => {
    const { user, save } = setup("short"); await common(user);
    await user.click(screen.getByRole("button", { name: "+ Javob (main)" }));
    await user.type(screen.getByLabelText("1-javob (main)"), " O‘zbekiston ");
    await user.click(screen.getByRole("button", { name: "+ Javob (main)" }));
    await user.type(screen.getByLabelText("2-javob (main)"), "Uzbekistan");
    await user.click(screen.getByLabelText("Katta-kichik harfni farqlash"));
    await user.click(screen.getByLabelText("Qo‘lda tekshirish (main)"));
    await user.click(screen.getByRole("button", { name: "Savolni saqlash" }));
    expect(save).toHaveBeenCalledExactlyOnceWith({ ...shared, kind: "short", options: [], parts: [{ ...newPart(), accepted: [" O‘zbekiston ", "Uzbekistan"], case_sensitive: true, manual_review: true }] });
  });

  it("validates A/B independently and sends uppercase part labels with separate keys and weights", async () => {
    const { user, save } = setup("two_part"); await common(user);
    await user.type(screen.getByLabelText("A qism matni"), "Birinchi qism");
    await user.type(screen.getByLabelText("B qism matni"), "Ikkinchi qism");
    await user.click(screen.getByRole("button", { name: "+ Javob (A)" })); await user.type(screen.getByLabelText("1-javob (A)"), "bir");
    fireEvent.change(screen.getByLabelText("Vazn (A)"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Vazn (B)"), { target: { value: "0" } });
    expect(within(screen.getByRole("group", { name: "B qism" })).getAllByRole("alert")).toHaveLength(2);
    fireEvent.submit(screen.getByRole("form", { name: "Savol muharriri" })); expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Vazn (B)"), { target: { value: "3" } });
    await user.click(screen.getByLabelText("Qo‘lda tekshirish (B)"));
    await user.click(screen.getByRole("button", { name: "Savolni saqlash" }));
    expect(save).toHaveBeenCalledExactlyOnceWith({ ...shared, kind: "two_part", options: [], parts: [
      { ...newPart("A"), prompt: "Birinchi qism", accepted: ["bir"], weight: 2 },
      { ...newPart("B"), prompt: "Ikkinchi qism", weight: 3, manual_review: true },
    ] });
  });

  it("confirms destructive switching, cancels safely, then renders only the target form", async () => {
    const { user } = setup(); await user.type(screen.getByLabelText("A variant"), "Saqlansin");
    await user.selectOptions(screen.getByLabelText("Savol turi"), "matching");
    await user.click(screen.getByRole("button", { name: "Bekor qilish" }));
    expect(screen.getByLabelText("A variant")).toHaveValue("Saqlansin");
    await user.selectOptions(screen.getByLabelText("Savol turi"), "matching");
    await user.click(screen.getByRole("button", { name: "O‘zgartirish" }));
    expect(screen.queryByLabelText("A variant")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Juftlik" })).toBeVisible();
  });

  it("synchronizes JSON both ways, preserves invalid text and reports an Uzbek error with position", async () => {
    const { user, save } = setup("short"); await common(user);
    await user.click(screen.getByRole("tab", { name: "JSON" }));
    const json = screen.getByLabelText("Savol tuzilishi");
    expect(JSON.parse((json as HTMLTextAreaElement).value).topic).toBe("Tilshunoslik");
    fireEvent.change(json, { target: { value: "{\n\"text\": !!!" } });
    expect(json).toHaveValue("{\n\"text\": !!!"); expect(screen.getByRole("alert")).toHaveTextContent(/JSON sintaksisi.*qator.*ustun.*belgi/);
    expect(screen.queryByText(/Unexpected token/)).not.toBeInTheDocument();
    fireEvent.submit(screen.getByRole("form")); expect(save).not.toHaveBeenCalled();
    fireEvent.change(json, { target: { value: encode({ ...blankQuestion(99, "short"), text: "JSON matni", parts: [{ ...newPart(), accepted: ["javob"] }] }) } });
    await user.click(screen.getByRole("tab", { name: "Forma" }));
    expect(screen.getByLabelText("Savol matni")).toHaveValue("JSON matni");
    await user.click(screen.getByRole("button", { name: "Savolni saqlash" }));
    expect(save.mock.calls[0][0].position).toBe(3);
  });

  it.each(["reading", "image"] as const)("edits %s in the choice form, preserving passage, images, and option-label keys", async kind => {
    const initial = { ...blankQuestion(3, kind), text: "O‘qing", passage_id: "passage-1", image_paths: ["exam/q.png"], options: blankQuestion(3, kind).options.map(o => ({ ...o, text: o.label })), parts: [{ ...newPart(), accepted: ["A"] }] };
    const { user, save } = setup(kind, initial);
    expect(screen.getByRole("tab", { name: "Forma" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("A variant")).toHaveValue("A");
    expect(screen.getByAltText("Savol rasmlari 1")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Savolni saqlash" }));
    expect(save).toHaveBeenCalledExactlyOnceWith(initial);
  });
});


describe("client-only preview", () => {
  it.each(["single", "reading", "image", "matching", "short", "two_part"] as const)("previews %s without changing keys or saving answers", async kind => {
    const initial = { ...blankQuestion(3, kind), text: "Tekshiring", options: ["single", "reading", "image", "matching"].includes(kind) ? [{ label: "A", text: "Birinchi", image_path: null }, { label: "B", text: "Ikkinchi", image_path: null }] : [], parts: (kind === "matching" ? [newPart("left")] : blankQuestion(3, kind).parts).map(p => ({ ...p, accepted: ["A"] })) };
    const { user, save } = setup(kind, initial);
    await user.click(screen.getByRole("tab", { name: "Ko‘rish" }));
    const preview = screen.getByRole("region", { name: "O‘quvchi ko‘rinishi" });
    expect(preview).not.toHaveTextContent("Javob kaliti");
    if (kind === "matching") await user.selectOptions(within(preview).getByRole("combobox"), "B");
    else if (initial.options.length) {
      await user.click(within(preview).getAllByRole("radio")[1]);
      await user.keyboard("{Enter}");
    } else await user.type(within(preview).getAllByRole("textbox")[0], "Sinov javobi");
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole("tab", { name: "JSON" }));
    expect(JSON.parse((screen.getByLabelText("Savol tuzilishi") as HTMLTextAreaElement).value)).toEqual(initial);
    await user.click(screen.getByRole("tab", { name: "Ko‘rish" }));
    if (initial.options.length && kind !== "matching") expect(screen.getAllByRole("radio")[1]).toBeChecked();
  });
});
