import assert from "node:assert/strict";
import test from "node:test";
import { captureVisibleConversation, insertProviderText, resolveProvider } from "../../extension/src/providers/registry.ts";

test("resolveProvider always returns generic", () => {
  assert.equal(resolveProvider("https://chatgpt.com/c/fixture").id, "generic");
});

test("provider capture uses generic CSS selectors", () => {
  installBrowserFakes("chatgpt.com", [
    { innerText: "Visible user message", getClientRects: () => [{}], contains: () => false },
    { innerText: "Visible assistant response", getClientRects: () => [{}], contains: () => false }
  ], "");
  const text = "Visible user message\n\nVisible assistant response";
  assert.deepEqual(captureVisibleConversation("generic"), {
    ok: true,
    text,
    characters: text.length,
  });
});

test("provider capture fails nicely on empty text", () => {
  installBrowserFakes("chatgpt.com", [], "   ");
  assert.deepEqual(captureVisibleConversation("generic"), {
    ok: false,
    error: "No visible conversation content found on this page",
  });
});

test("provider insertion modifies exactly one composer and never emits submit gestures", () => {
  const events: string[] = [];
  class FakeTextArea {
    _value = "";
    get value() { return this._value; }
    set value(value: string) { this._value = value; }
    getClientRects() { return [{}]; }
    hasAttribute() { return false; }
    dispatchEvent(event: Event) { events.push(event.type); return true; }
  }
  Object.defineProperty(globalThis, "HTMLTextAreaElement", { configurable: true, value: FakeTextArea });
  Object.defineProperty(globalThis, "InputEvent", { configurable: true, value: class extends Event { constructor(type: string) { super(type); } } });
  const composer = new FakeTextArea();
  installBrowserFakes("chatgpt.com", [composer], "");
  const result = insertProviderText("generic", "Reviewed context only");
  assert.deepEqual(result, { ok: true, insertedCharacters: 21 });
  assert.equal(composer.value, "Reviewed context only");
  assert.deepEqual(events, ["input", "change"]);
});

function installBrowserFakes(hostname: string, nodes: unknown[], innerText: string): void {
  Object.defineProperty(globalThis, "location", { configurable: true, value: { hostname } });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { 
      querySelectorAll: () => nodes,
      querySelector: () => null,
      body: { innerText }
    },
  });
  Object.defineProperty(globalThis, "getComputedStyle", {
    configurable: true,
    value: () => ({ visibility: "visible" }),
  });
}
