import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { IntakeForm } from "../components/IntakeForm";
import { parseIntakeForm, type IntakeAnswers } from "../lib/intake";

describe("client-side student intake switching", () => {
  it("remounts native selects A→B→A and keeps saves/reloads separate without copying unedited answers", async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://example.test/intake" });
    const oldWindow = globalThis.window;
    const oldDocument = globalThis.document;
    const oldAct = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    const container = dom.window.document.getElementById("root")!;
    let root = createRoot(container);
    const stored = new Map<string, IntakeAnswers>();
    const action = async (_form: FormData) => {};
    const show = async (id: string) => {
      await act(async () => { root.render(createElement(IntakeForm, {
        studentId: id, studentName: id, answers: stored.get(id) ?? {}, isDemo: false, action,
      })); });
      return container.querySelector("form") as HTMLFormElement;
    };
    const select = (name: string) => container.querySelector(`select[name="${name}"]`) as HTMLSelectElement;
    const save = () => {
      // This is the browser's submitted FormData, including the currently displayed select values.
      const browserData = new dom.window.FormData(container.querySelector("form")!);
      const data = new FormData();
      for (const [key, value] of browserData.entries()) data.set(key, String(value));
      stored.set(String(data.get("studentId")), parseIntakeForm(data));
    };
    try {
      const aForm = await show("student-A");
      assert.equal(select("housing").value, "ask_later");
      select("housing").value = "on_campus";
      select("visits").value = "yes";
      save();
      assert.equal(stored.get("student-A")?.housing, "on_campus");

      const bForm = await show("student-B"); // in-app route update, no hard reload
      assert.notEqual(bForm, aForm, "changing student must replace the dirty native form");
      assert.equal(select("housing").value, "ask_later");
      assert.equal(select("visits").value, "ask_later");
      assert.equal((bForm.elements.namedItem("studentId") as HTMLInputElement).value, "student-B");
      save(); // even a save without edits must not copy A's choices into B
      assert.equal(stored.get("student-B")?.housing, "ask_later");
      assert.equal(stored.get("student-B")?.visits, "ask_later");

      await show("student-A");
      assert.equal(select("housing").value, "on_campus");
      assert.equal(select("visits").value, "yes");
      select("visits").value = "no";
      save();
      await show("student-B");
      assert.equal(select("visits").value, "ask_later");
      select("housing").value = "commuter";
      save();

      await act(async () => root.unmount());
      root = createRoot(container); // full reload from persisted rows
      await show("student-A");
      assert.equal(select("housing").value, "on_campus");
      assert.equal(select("visits").value, "no");
      await show("student-B");
      assert.equal(select("housing").value, "commuter");
      assert.equal(select("visits").value, "ask_later");
      assert.equal(stored.get("student-A")?.housing, "on_campus");
      assert.equal(stored.get("student-B")?.housing, "commuter");
    } finally {
      await act(async () => root.unmount());
      Object.assign(globalThis, { window: oldWindow, document: oldDocument, IS_REACT_ACT_ENVIRONMENT: oldAct });
      dom.window.close();
    }
  });
});
