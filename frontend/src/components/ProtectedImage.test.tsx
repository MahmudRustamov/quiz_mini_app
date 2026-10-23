import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { apiFetch } from "../services/api";
import { ProtectedImage } from "./ui";
vi.mock("../services/api", () => ({ apiFetch: vi.fn() }));
const revoke = vi.fn();
const originalURL = URL;
beforeEach(() => {
  vi.stubGlobal("URL", class extends originalURL { static createObjectURL = vi.fn(() => "blob:protected-image"); static revokeObjectURL = revoke; });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); } });
  vi.mocked(apiFetch).mockReset().mockImplementation(async () => ({ ok: true, blob: async () => new Blob(["png"], { type: "image/png" }) }) as Response);
  revoke.mockClear();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal"); Reflect.deleteProperty(HTMLDialogElement.prototype, "close"); });

it("uses the authenticated transport once and reuses its blob for accessible zoom controls", async () => {
  const user = userEvent.setup(), { unmount } = render(<ProtectedImage path="exam/option.png" alt="A variant rasmi" />);
  const image = await screen.findByAltText("A variant rasmi"); expect(image).toHaveAttribute("src", "blob:protected-image");
  expect(apiFetch).toHaveBeenCalledExactlyOnceWith("/assets/exam/option.png");
  await user.click(screen.getByRole("button", { name: "A variant rasmi — kattalashtirish" }));
  expect(screen.getByRole("dialog")).toHaveAttribute("open");
  await user.click(screen.getByRole("button", { name: "Kattalashtirish" })); expect(screen.getByText("150%")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Kichraytirish" })); expect(screen.getByText("100%")).toBeVisible();
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true })); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(apiFetch).toHaveBeenCalledTimes(1); unmount(); expect(revoke).toHaveBeenCalledWith("blob:protected-image");
});

it("shows a readable failure and never renders an unprotected fallback URL", async () => {
  vi.mocked(apiFetch).mockRejectedValueOnce(new Error("fetch failed"));
  render(<ProtectedImage path="exam/option.png" alt="Rasm" />);
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Rasm yuklanmadi"));
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});

it("does not leak a blob URL when an image finishes loading after navigation", async () => {
  let finish!: (blob: Blob) => void;
  const blob = vi.fn(() => new Promise<Blob>(resolve => { finish = resolve; }));
  vi.mocked(apiFetch).mockResolvedValueOnce({ ok: true, blob } as unknown as Response);
  const { unmount } = render(<ProtectedImage path="exam/slow.png" alt="Rasm" />);
  await waitFor(() => expect(blob).toHaveBeenCalledTimes(1)); unmount();
  await act(async () => { finish(new Blob(["png"])); });
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
