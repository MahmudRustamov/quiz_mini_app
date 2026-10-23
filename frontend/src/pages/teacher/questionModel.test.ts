import { describe, expect, it } from "vitest";
import { blankQuestion, canUseForm, encode, inspectBuffer, losesData, newPart, switchKind, toInput, validateQuestion, type QuestionInput } from "./questionModel";
const valid = (): QuestionInput => ({ ...blankQuestion(1, "short"), text: "Savol", parts: [{ ...newPart(), accepted: ["javob"] }] });
describe("client schema and publication readiness", () => {
  it("retains image-only options through reopen, JSON parsing, form selection and duplication payload conversion", () => {
    const q = { ...blankQuestion(1), text: "Rasm", options: blankQuestion(1).options.map(o => ({ ...o, image_path: `exam/${o.label}.png` })), parts: [{ ...newPart(), accepted: ["A"] }] };
    expect(validateQuestion(q, "exam")).toEqual({}); expect(canUseForm(q)).toBe(true);
    expect(inspectBuffer(encode(q), 1, "exam").data).toEqual(q);
    expect(toInput({ ...q, id: "q1", parts: q.parts.map(p => ({ ...p, id: "p1" })) })).toEqual(q);
    expect(losesData(q, "short")).toBe(true);
    q.options[0].image_path = "other-exam/A.png";
    expect(validateQuestion(q, "exam")["options.0.image_path"]).toBeTruthy();
  });
  it.each(["", "   "])("requires text or image and rejects invalid image paths for option text '%s'", text => {
    const q = valid(); q.options = [{ label: "A", text, image_path: null }];
    expect(validateQuestion(q)["options.0.text"]).toBeTruthy();
    q.options[0].image_path = "exam/photo.png"; expect(validateQuestion(q)).toEqual({});
    q.options[0].image_path = "exam/../photo.png"; expect(validateQuestion(q)["options.0.image_path"]).toBeTruthy();
    q.options[0].image_path = "exam/photo.svg"; expect(validateQuestion(q)["options.0.image_path"]).toBeTruthy();
  });
  it("accepts a complete written question", () => expect(validateQuestion(valid())).toEqual({}));
  it.each([
    ["text", (q: QuestionInput) => { q.text = " "; }],
    ["text", (q: QuestionInput) => { q.text = "x".repeat(50001); }],
    ["topic", (q: QuestionInput) => { q.topic = "x".repeat(101); }],
    ["parts.0.weight", (q: QuestionInput) => { q.parts[0].weight = 101; }],
    ["parts.0.weight", (q: QuestionInput) => { q.parts[0].weight = 0; }],
    ["parts.0.weight", (q: QuestionInput) => { q.parts[0].weight = Infinity; }],
    ["parts.0.label", (q: QuestionInput) => { q.parts[0].label = "x".repeat(31); }],
    ["parts.0.prompt", (q: QuestionInput) => { q.parts[0].prompt = "x".repeat(10001); }],
    ["parts.0.accepted", (q: QuestionInput) => { q.parts[0].accepted = []; }],
    ["parts.0.accepted", (q: QuestionInput) => { q.parts[0].accepted = [" "]; }],
    ["parts.0.accepted", (q: QuestionInput) => { q.parts[0].accepted = Array(101).fill("a"); }],
    ["parts", (q: QuestionInput) => { q.parts.push({ ...q.parts[0] }); }],
    ["parts", (q: QuestionInput) => { q.parts = []; }],
    ["parts", (q: QuestionInput) => { q.kind = "two_part"; }],
    ["options", (q: QuestionInput) => { q.options = [{ label: "A", text: "a", image_path: null }, { label: "A", text: "b", image_path: null }]; }],
    ["options.0.text", (q: QuestionInput) => { q.options = [{ label: "A", text: "", image_path: null }]; }],
    ["parts.0.accepted", (q: QuestionInput) => { q.kind = "single"; q.options = [{ label: "A", text: "a", image_path: null }]; }],
    ["position", (q: QuestionInput) => { q.position = 501; }],
    ["image_paths", (q: QuestionInput) => { q.image_paths = Array(21).fill("exam/a.png"); }],
  ])("rejects an invalid %s", (path, mutate) => { const q = valid(); mutate(q); expect(validateQuestion(q)).toHaveProperty(path); });
  it("allows independent matching parts but rejects multiple choice parts", () => {
    const q = valid(); q.kind = "matching"; q.options = [{ label: "R1", text: "O‘ng", image_path: null }];
    q.parts = [{ ...newPart("p1"), prompt: "Chap", accepted: ["R1"] }, { ...newPart("p2"), prompt: "Chap2", accepted: ["R1"] }];
    expect(validateQuestion(q)).toEqual({}); q.kind = "single"; expect(validateQuestion(q).parts).toBeTruthy();
  });
  it("does not silently discard complex imported option/part structures", () => {
    const q = valid(); q.kind = "single"; q.options = [{ label: "A", text: "Bitta", image_path: null }]; expect(canUseForm(q)).toBe(false);
    q.kind = "matching"; q.parts[0].accepted = ["A", "B"]; expect(canUseForm(q)).toBe(false);
  });
  it("retains topic, passage, images and written answers across compatible switches", () => {
    const q = { ...valid(), topic: "Grammatika", passage_id: "p1", image_paths: ["exam/image.png"] };
    const switched = switchKind(q, "two_part");
    expect(switched).toMatchObject({ topic: q.topic, passage_id: q.passage_id, image_paths: q.image_paths, parts: [{ ...q.parts[0], label: "A" }, newPart("B")] });
  });
  it("switches blank defaults freely but confirms before dropping pairs, keys or extra parts", () => {
    expect(losesData(blankQuestion(1), "matching")).toBe(false);
    const q = valid(); expect(losesData(q, "matching")).toBe(true);
    expect(losesData(blankQuestion(1, "two_part"), "short")).toBe(true);
    expect(losesData({ ...blankQuestion(1, "matching"), parts: [newPart("p1")] }, "short")).toBe(true);
  });
  it("returns a readable shape error without throwing or altering the raw buffer", () => {
    const buffer = '{"position":1,"kind":"short","text":7}'; expect(inspectBuffer(buffer, 1).errors.json).toContain("text");
    expect(inspectBuffer(encode(valid()), 7).data?.position).toBe(7);
  });
});


describe("reading/image choice model", () => {
  it.each(["single", "reading", "image"] as const)("keeps %s forms, JSON and API conversion lossless", kind => {
    const q = { ...blankQuestion(1, kind), text: "Tanlang", passage_id: "p1", options: blankQuestion(1, kind).options.map(o => ({ ...o, image_path: `exam/${o.label}.png` })), parts: [{ ...newPart(), accepted: ["B"] }] };
    expect(canUseForm(q)).toBe(true); expect(validateQuestion(q, "exam")).toEqual({});
    expect(inspectBuffer(encode(q), 1, "exam").data).toEqual(q);
    expect(toInput({ ...q, id: "q1", parts: q.parts.map(p => ({ ...p, id: "p1" })) })).toEqual(q);
    for (const next of ["single", "reading", "image"] as const) {
      expect(losesData(q, next)).toBe(false); expect(switchKind(q, next)).toEqual({ ...q, kind: next });
    }
    q.parts[0].accepted = ["missing"];
    expect(validateQuestion(q)["parts.0.accepted"]).toBeTruthy();
    q.parts.push(newPart("extra")); expect(validateQuestion(q).parts).toBeTruthy();
    expect(canUseForm(q)).toBe(false);
  });
});
