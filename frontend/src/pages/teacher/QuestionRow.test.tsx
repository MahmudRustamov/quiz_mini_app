import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Question } from "../../types";
import { blankQuestion, newPart } from "./questionModel";
import QuestionRow, { type QuestionRowProps } from "./QuestionRow";

const question = (position: number, kind: "single" | "short" = "single"): Question => ({
  ...blankQuestion(position, kind), id: `q${position}`, text: `Savol ${position}`, topic: "Morfologiya",
  parts: [{ ...newPart(), id: `p${position}`, accepted: ["A"] }],
});
function setup(over: Partial<QuestionRowProps> = {}) {
  const handlers = { onSelect: vi.fn(), onMoveValueChange: vi.fn(), onMoveTo: vi.fn(), onInsert: vi.fn(), onDuplicate: vi.fn(), onDelete: vi.fn() };
  const props: QuestionRowProps = { question: question(2), count: 5, active: false, ready: true, flagMissingKey: false, editable: true, busy: false, full: false, moveValue: "2", ...handlers, ...over };
  // The slot input is controlled by the workspace, so the harness keeps its value like the real parent does.
  function Harness() {
    const [value, setValue] = useState(props.moveValue);
    return <><QuestionRow {...props} moveValue={value} onMoveValueChange={next => { handlers.onMoveValueChange(next); setValue(next); }} /><button>tashqarida</button></>;
  }
  render(<Harness />);
  return { user: userEvent.setup(), ...handlers };
}
const trigger = () => screen.getByRole("button", { name: "2-savol amallari" });
const menu = () => screen.queryByRole("group", { name: "2-savol amallari" });

describe("question row", () => {
  it("shows a readable type name, the topic and the status instead of controls", () => {
    setup();
    expect(screen.getByText("A/B/C/D test · Morfologiya")).toBeVisible();
    expect(screen.getByText("Tayyor")).toBeVisible();
    expect(screen.queryByText("single")).toBeNull();
    expect(menu()).toBeNull();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
  });

  it("opens from the three-dot button, moves focus inside, and Escape closes it and returns focus", async () => {
    const { user } = setup();
    await user.click(trigger());
    expect(menu()).toBeInTheDocument(); expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(menu()!.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(menu()).toBeNull(); expect(trigger()).toHaveFocus();
  });

  it("closes when the user clicks elsewhere, and the button toggles it", async () => {
    const { user } = setup();
    await user.click(trigger()); await user.click(screen.getByRole("button", { name: "tashqarida" }));
    expect(menu()).toBeNull();
    await user.click(trigger()); expect(menu()).toBeInTheDocument();
    await user.click(trigger()); expect(menu()).toBeNull();
  });

  it.each([
    ["Yuqorisiga qo‘shish", "onInsert", [false]], ["Pastiga qo‘shish", "onInsert", [true]],
    ["Nusxa", "onDuplicate", []], ["2-savolni o‘chirish", "onDelete", []],
    ["2-savolni yuqoriga ko‘chirish", "onMoveTo", ["1"]], ["2-savolni pastga ko‘chirish", "onMoveTo", ["3"]],
  ] as const)("%s runs once and closes the menu", async (name, handler, args) => {
    const handlers = setup(); await handlers.user.click(trigger());
    await handlers.user.click(screen.getByRole("button", { name }));
    expect(handlers[handler]).toHaveBeenCalledExactlyOnceWith(...args);
    expect(menu()).toBeNull();
  });

  it("cannot move the first question up or the last question down", async () => {
    const first = setup({ question: question(1) }); await first.user.click(screen.getByRole("button", { name: "1-savol amallari" }));
    expect(screen.getByRole("button", { name: "1-savolni yuqoriga ko‘chirish" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "1-savolni pastga ko‘chirish" })).toBeEnabled();
  });
  it("disables moving the last question down", async () => {
    const { user } = setup({ question: question(5) }); await user.click(screen.getByRole("button", { name: "5-savol amallari" }));
    expect(screen.getByRole("button", { name: "5-savolni pastga ko‘chirish" })).toBeDisabled();
  });

  it("applies a typed slot on Enter and closes", async () => {
    const { user, onMoveTo } = setup(); await user.click(trigger());
    const input = screen.getByLabelText("2-savolni ko‘chirish manzili");
    fireEvent.change(input, { target: { value: "4" } });
    await user.type(input, "{Enter}");
    expect(onMoveTo).toHaveBeenCalledExactlyOnceWith("4"); expect(menu()).toBeNull();
  });
  it("applies a typed slot with the confirm button, which is the only way on a keypad without Enter", async () => {
    const { user, onMoveTo } = setup(); await user.click(trigger());
    fireEvent.change(screen.getByLabelText("2-savolni ko‘chirish manzili"), { target: { value: "5" } });
    await user.click(screen.getByRole("button", { name: "2-savolni shu o‘ringa ko‘chirish" }));
    expect(onMoveTo).toHaveBeenCalledExactlyOnceWith("5"); expect(menu()).toBeNull();
  });
  it("cancels a typed slot when the user clicks away or leaves the field", async () => {
    const { user, onMoveTo } = setup(); await user.click(trigger());
    const input = screen.getByLabelText("2-savolni ko‘chirish manzili");
    fireEvent.change(input, { target: { value: "5" } }); fireEvent.blur(input);
    await user.click(screen.getByRole("button", { name: "tashqarida" }));
    expect(menu()).toBeNull(); expect(onMoveTo).not.toHaveBeenCalled();
  });

  it("disables insert and copy when the exam is full but still allows moving and deleting", async () => {
    const { user } = setup({ full: true }); await user.click(trigger());
    for (const name of ["Yuqorisiga qo‘shish", "Pastiga qo‘shish", "Nusxa"]) expect(screen.getByRole("button", { name })).toBeDisabled();
    expect(screen.getByRole("button", { name: "2-savolni o‘chirish" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "2-savolni pastga ko‘chirish" })).toBeEnabled();
  });

  it("has no actions for a published exam, and is inert while a request is running", () => {
    setup({ editable: false });
    expect(screen.queryByRole("button", { name: /savol amallari/ })).toBeNull();
    expect(screen.getByRole("button", { name: "2 Savol 2" })).toBeEnabled();
  });
  it("disables selection and the menu while busy", () => {
    setup({ busy: true });
    expect(trigger()).toBeDisabled(); expect(screen.getByRole("button", { name: "2 Savol 2" })).toBeDisabled();
  });

  it("flags a missing answer key only when asked to, and marks the active row", () => {
    setup({ flagMissingKey: true, ready: false, active: true });
    expect(screen.getByText("Javob kaliti yo‘q")).toBeVisible(); expect(screen.getByText("Tekshiruv kerak")).toBeVisible();
    expect(screen.getByRole("button", { name: "2 Savol 2" })).toHaveAttribute("aria-current", "true");
  });
});
