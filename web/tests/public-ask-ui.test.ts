import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import PublicAskForm from "../app/ask/PublicAskForm";

function typeIn(dom: JSDOM, textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(textarea, value);
  textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  textarea.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}

describe("public Ask form accessibility and failure recovery", () => {
  it("shows a useful answer offline, refuses research, validates blanks, and surfaces a processing failure", async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://example.test/ask" });
    const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch,
      act: (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT };
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true,
      fetch: () => { throw new Error("Network unavailable"); } });
    const container = dom.window.document.getElementById("root")!;
    const root = createRoot(container);
    const submit = async () => act(async () => { container.querySelector("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
    const input = (value: string) => act(async () => typeIn(dom, container.querySelector("textarea")!, value));
    try {
      await act(async () => root.render(createElement(PublicAskForm)));
      const textarea = container.querySelector("textarea")!;
      assert.equal(textarea.getAttribute("aria-describedby"), "public-question-help");
      assert.ok(container.querySelector('button[type="submit"]'));
      await submit();
      assert.match(container.querySelector('[role="alert"]')?.textContent ?? "", /Please enter a general question/);
      assert.equal(textarea.getAttribute("aria-invalid"), "true");
      await input("What does Campus Passage do and how do I start?");
      await submit();
      assert.equal(container.querySelector('[role="alert"]')?.textContent, undefined);
      assert.match(container.querySelector('[role="status"]')?.textContent ?? "", /organizes college steps[\s\S]*verify your email/i);
      assert.match(container.querySelector('[role="status"]')?.textContent ?? "", /Public Campus Passage FAQ/);
      await input("When is Harvard's application deadline?");
      await submit();
      assert.match(container.querySelector('[role="status"]')?.textContent ?? "", /Outside public Ask scope/);
      assert.ok(container.querySelector('a[href="/login?next=%2Fonboarding"]'));
      assert.doesNotMatch(container.textContent ?? "", /Harvard's application deadline is/);
      await act(async () => root.render(createElement(PublicAskForm, { answerQuestion: () => { throw new Error("private data"); } })));
      await input("What is Campus Passage?");
      await submit();
      assert.match(container.querySelector('[role="alert"]')?.textContent ?? "", /could not answer right now/i);
      assert.doesNotMatch(container.textContent ?? "", /private data/);
      assert.equal(container.querySelector('[role="status"]'), null);
    } finally {
      await act(async () => root.unmount());
      Object.assign(globalThis, { window: previous.window, document: previous.document, fetch: previous.fetch,
        IS_REACT_ACT_ENVIRONMENT: previous.act });
      dom.window.close();
    }
  });
});
