/**
 * Generic provider registry - one extension for all AI platforms.
 * Uses native browser text capture to automatically grab visible conversation.
 */

export interface ProviderEntry {
  id: string;
  name: string;
  trust: "agent" | "web";
}

export const GENERIC_PROVIDER: ProviderEntry = {
  id: "generic",
  name: "AI Assistant",
  trust: "web",
};

export function resolveProvider(urlValue: string): ProviderEntry {
  return GENERIC_PROVIDER;
}

export function isKnownProvider(urlValue: string): boolean {
  return false;
}

export function captureVisibleConversation(
  provider: ProviderEntry | string,
  documentValue: Document = document,
  hostname = typeof location === "undefined" ? "" : location.hostname
): { ok: boolean; text?: string; error?: string; characters?: number } {
  // Use generic selectors to target conversation nodes and avoid sidebars/navigation
  const captureSelectors = [
    // Modern semantic chat tags and common generic wrappers
    "main [class*='message-content']", "main [class*='chat-message']", "main [class*='message-text']",
    "[class*='message-content']", "[class*='MessageContent']", "[class*='chat-message']", "[class*='ChatMessage']",
    "[class*='message-text']", "[class*='MessageText']", "[class*='response-text']", "[class*='ResponseText']",
    "[class*='assistant-message']", "[class*='AssistantMessage']", "[class*='ai-message']", "[class*='AiMessage']",
    "[class*='bot-message']", "[class*='BotMessage']", "[class*='human-message']", "[class*='HumanMessage']",
    "[class*='user-message']", "[class*='UserMessage']",
    // Data attributes
    "[data-role='assistant']", "[data-role='user']", "[data-message-role]", "[data-author-role]",
    "[data-testid^='conversation-turn']", "[data-testid^='user-message']", "[data-testid='assistant-message']",
    "user-query", "model-response", "message-content",
    // Fallbacks
    "article[class*='message']", "article[class*='Message']",
    "main article p", "main p", "[role='main'] p", "article p"
  ];

  const candidates = captureSelectors
    .flatMap((sel) => [...documentValue.querySelectorAll(sel)])
    .filter((node) => {
      const el = node as HTMLElement;
      return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
    });

  // Remove nodes that are children of other matched nodes to avoid duplication
  const nodes = candidates.filter((node) => !candidates.some((parent) => parent !== node && parent.contains(node)));

  const unique = [...new Set(nodes.map((n) => ((n as HTMLElement).innerText ?? n.textContent ?? "").trim()).filter(Boolean))];
  const text = unique.join("\n\n");
  
  if (!text) {
    // Ultimate fallback if no selectors matched but we need something
    const fallbackText = (documentValue.querySelector("main") as HTMLElement)?.innerText;
    if (fallbackText?.trim()) {
       const bytes = new TextEncoder().encode(fallbackText).byteLength;
       if (bytes > 1_048_576) return { ok: false, error: "Visible conversation exceeds the 1 MiB limit", characters: fallbackText.length };
       return { ok: true, text: fallbackText, characters: fallbackText.length };
    }
    return { ok: false, error: "No visible conversation content found on this page" };
  }

  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > 1_048_576) return { ok: false, error: "Visible conversation exceeds the 1 MiB limit", characters: text.length };

  return { ok: true, text, characters: text.length };
}

export function insertProviderText(
  provider: ProviderEntry | string,
  text: string,
  documentValue: Document = document,
  hostname = typeof location === "undefined" ? "" : location.hostname
): { ok: boolean; insertedCharacters?: number; error?: string } {
  const insertSelectors = [
    "textarea[placeholder*='message' i]",
    "textarea[placeholder*='ask' i]",
    "textarea[placeholder*='chat' i]",
    "textarea[placeholder*='type' i]",
    "[contenteditable='true'][data-placeholder]",
    "[contenteditable='true'][placeholder]",
    "[contenteditable='true'][class*='editor']",
    "[contenteditable='true'][class*='input']",
    "[contenteditable='true'][class*='composer']",
    "[contenteditable='true'][class*='message']",
    "textarea",
  ];

  const candidates = insertSelectors
    .flatMap((sel) => [...documentValue.querySelectorAll(sel)])
    .filter((node) => {
      const el = node as HTMLElement;
      return el.getClientRects().length > 0 && !el.hasAttribute("disabled");
    });

  const unique = [...new Set(candidates)];
  if (unique.length === 0) return { ok: false, error: "No composer input found on this page" };
  const target = unique[0] as HTMLTextAreaElement | HTMLElement;

  if (target instanceof HTMLTextAreaElement) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
    descriptor?.set?.call(target, text);
  } else {
    target.focus();
    target.textContent = text;
  }

  target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  target.dispatchEvent(new Event("change", { bubbles: true }));

  return { ok: true, insertedCharacters: text.length };
}
