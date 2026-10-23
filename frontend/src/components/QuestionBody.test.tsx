import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import QuestionBody, { type QuestionBodyData } from "./QuestionBody";

vi.mock("./ui", async importOriginal => ({ ...await importOriginal<typeof import("./ui")>(), ProtectedImage: ({ alt }: { alt: string }) => <img alt={alt} /> }));
const choice: QuestionBodyData = {
  position: 3, kind: "single", topic: "Til", text: "Tanlang", image_paths: ["exam/q.png"],
  options: [{ label: "A", text: "Birinchi" }, { label: "B", text: "", image_path: "exam/b.png" }],
  parts: [{ label: "main", prompt: "", weight: 2 }],
};
function setup(question: QuestionBodyData) {
  const answer = vi.fn();
  function Harness() {
    const [answers, setAnswers] = useState<Record<string, string>>({ unrelated: "retained" });
    return <QuestionBody question={question} answers={answers} onAnswer={value => { answer(value); setAnswers(value); }} passage={{ id: "p", title: "Manba", text: "O‘qish matni" }} />;
  }
  render(<Harness />); return { user: userEvent.setup(), answer };
}
describe("shared student question renderer", () => {
  it.each(["single", "reading", "image"] as const)("renders %s passage, question and option images, and controlled choices", async kind => {
    const { user, answer } = setup({ ...choice, kind });
    expect(screen.getByText("O‘qish matni")).toBeVisible();
    expect(screen.getByAltText("3-savol rasmi")).toBeVisible();
    expect(screen.getByAltText("B variant rasmi")).toBeVisible();
    await user.click(screen.getAllByRole("radio")[1]);
    expect(answer).toHaveBeenLastCalledWith({ unrelated: "retained", main: "B" });
    expect(screen.getAllByRole("radio")[1]).toBeChecked();
    expect(screen.getByText("2 ball")).toBeVisible();
  });
  it("uses per-left-item matching answers and shows image-only option cards", async () => {
    const { user, answer } = setup({ ...choice, kind: "matching", parts: [{ label: "left-id", prompt: "Chap", weight: 3 }] });
    expect(screen.getByLabelText("Moslashtirish variantlari")).toHaveTextContent("Birinchi");
    // Shown by served position, because the stored label pairs with its own left item.
    expect(screen.getByAltText("2 variant rasmi")).toBeVisible();
    const select = screen.getByLabelText("Chap uchun javob");
    expect(select).not.toHaveTextContent("B.");
    expect(select).toHaveTextContent("1. Birinchi");
    // The submitted value stays the stored label, so grading is unaffected.
    await user.selectOptions(select, "B");
    expect(answer).toHaveBeenLastCalledWith({ unrelated: "retained", "left-id": "B" });
  });
  it.each(["short", "two_part"] as const)("preserves separate written answers for %s", async kind => {
    const parts = kind === "short" ? [{ label: "main", prompt: "", weight: 1 }] : [{ label: "A", prompt: "Birinchi", weight: 1 }, { label: "B", prompt: "Ikkinchi", weight: 2 }];
    const { user, answer } = setup({ ...choice, kind, options: [], parts });
    await user.type(screen.getByLabelText(`3-savol ${parts[0].label} javobi`), "bir");
    if (kind === "two_part") await user.type(screen.getByLabelText("3-savol B javobi"), "ikki");
    expect(answer).toHaveBeenLastCalledWith({ unrelated: "retained", [parts[0].label]: "bir", ...(kind === "two_part" ? { B: "ikki" } : {}) });
  });
});
