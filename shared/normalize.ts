export interface ProtectedSpan {
  start: number;
  end: number;
  value: string;
  kind: "code" | "url" | "path" | "command" | "error" | "identifier";
}

const protectedPatterns: Array<{ kind: ProtectedSpan["kind"]; pattern: RegExp }> = [
  { kind: "code", pattern: /\x60{3}[^\n]*\n[\s\S]*?\x60{3}/g },
  { kind: "code", pattern: /\x60[^\x60\n]+\x60/g },
  { kind: "url", pattern: /https?:\/\/[^\s<>"')\]]+/g },
  { kind: "path", pattern: /(?:\b[A-Za-z]:\\(?:[^\s<>:"|?*]+\\)*[^\s<>:"|?*]*|\/(?:[A-Za-z0-9._~-]+\/)+[A-Za-z0-9._~-]+)/g },
  { kind: "identifier", pattern: /\b(?:[a-f0-9]{7,40}|#[0-9]+|PR\s*#?\d+|v?\d+\.\d+(?:\.\d+)?(?:-[A-Za-z0-9.-]+)?)\b/gi },
  { kind: "command", pattern: /^(?:\$\s+|npm |pnpm |yarn |git |docker |kubectl |curl )[^\n]+$/gm },
  { kind: "error", pattern: /^(?:Error|TypeError|ReferenceError|SyntaxError|RangeError|npm ERR!|fatal:|Traceback)[^\n]*(?:\n\s+at [^\n]+)*/gm },
];

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n").toWellFormed();
}

export function findProtectedSpans(input: string): ProtectedSpan[] {
  const text = normalizeLineEndings(input);
  const candidates: ProtectedSpan[] = [];
  for (const { kind, pattern } of protectedPatterns) {
    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
      if (match.index === undefined) continue;
      candidates.push({ start: match.index, end: match.index + match[0].length, value: match[0], kind });
    }
  }
  candidates.sort((a, b) => a.start - b.start || b.end - a.end);
  const output: ProtectedSpan[] = [];
  for (const span of candidates) {
    const previous = output.at(-1);
    if (previous && span.start < previous.end) continue;
    output.push(span);
  }
  return output;
}

export function normalizeText(input: string): string {
  const text = normalizeLineEndings(input);
  const spans = findProtectedSpans(text);
  let cursor = 0;
  let output = "";
  for (const span of spans) {
    const rawProse = text.slice(cursor, span.start);
    const normalizedProse = normalizeProse(rawProse);
    output += normalizedProse;
    if (/[^\s]$/.test(normalizedProse) && /[\t ]$/.test(rawProse) && /^\S/.test(span.value)) output += " ";
    output += span.value;
    cursor = span.end;
  }
  output += normalizeProse(text.slice(cursor));
  return output.replace(/\n{4,}/g, "\n\n\n").trim();
}

function normalizeProse(text: string): string {
  return text.normalize("NFC").replace(/[\t ]+$/gm, "").replace(/[\t ]{2,}/g, " ");
}

export function deduplicateParagraphs(text: string): string[] {
  const { protectedText, values } = replaceProtectedSpans(text);
  const paragraphs = protectedText.split(/\n\s*\n/).map((value) => deduplicateLines(value).trim()).filter(Boolean);
  const seen = new Set<string>();
  const output: string[] = [];
  for (const paragraph of paragraphs) {
    const key = paragraph.replace(/\s+/g, " ").trim().toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(restoreProtectedSpans(paragraph, values));
  }
  return output;
}

function replaceProtectedSpans(text: string): { protectedText: string; values: string[] } {
  const spans = findProtectedSpans(text);
  const values: string[] = [];
  let cursor = 0;
  let protectedText = "";
  for (const span of spans) {
    protectedText += text.slice(cursor, span.start);
    const index = values.push(span.value) - 1;
    protectedText += "\uE000CB_PROTECTED_" + index + "\uE001";
    cursor = span.end;
  }
  protectedText += text.slice(cursor);
  return { protectedText, values };
}

function restoreProtectedSpans(text: string, values: string[]): string {
  return text.replace(/\uE000CB_PROTECTED_(\d+)\uE001/g, (_match, rawIndex: string) => values[Number(rawIndex)] ?? "");
}

function deduplicateLines(paragraph: string): string {
  const lines = paragraph.split("\n");
  const seen = new Set<string>();
  return lines.filter((line) => {
    if (line.includes("\uE000CB_PROTECTED_")) return true;
    const key = line.replace(/\s+/g, " ").trim().toLocaleLowerCase();
    if (key.length < 40 || !seen.has(key)) {
      if (key.length >= 40) seen.add(key);
      return true;
    }
    return false;
  }).join("\n");
}
