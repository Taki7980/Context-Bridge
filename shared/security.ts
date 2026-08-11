import { LIMITS, utf8Bytes } from "./context-pack.ts";

export type FindingSeverity = "critical" | "warning" | "info";

export interface SecurityFinding {
  id: string;
  category: string;
  severity: FindingSeverity;
  start: number;
  end: number;
  maskedPreview: string;
  explanation: string;
  remediation: string;
}

interface Rule {
  category: string;
  severity: FindingSeverity;
  pattern: RegExp;
  explanation: string;
  remediation: string;
  validate?: (value: string) => boolean;
}

function rule(category: string, severity: FindingSeverity, pattern: RegExp, explanation: string, validate?: (value: string) => boolean): Rule {
  return {
    category,
    severity,
    pattern,
    explanation,
    remediation: severity === "critical"
      ? "Redact or remove this value before any outbound action."
      : "Review, redact, or explicitly acknowledge this item.",
    ...(validate ? { validate } : {}),
  };
}

const criticalRules: Rule[] = [
  rule("private-key", "critical", /-----BEGIN (?:ENCRYPTED |OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----[\s\S]{0,100000}?-----END (?:ENCRYPTED |OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----/g, "A private-key block can grant account or server access."),
  rule("authorization-header", "critical", /\bAuthorization\s*:\s*(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,2048}/gi, "An authorization header contains reusable authentication material."),
  rule("jwt", "critical", /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g, "A JWT-like bearer token may authorize requests."),
  rule("openai-key", "critical", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g, "An OpenAI-style API key was detected."),
  rule("anthropic-key", "critical", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, "An Anthropic-style API key was detected."),
  rule("github-token", "critical", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g, "A GitHub access token was detected."),
  rule("gitlab-token", "critical", /\bglpat-[A-Za-z0-9_-]{20,}\b/g, "A GitLab access token was detected."),
  rule("aws-access-key", "critical", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "An AWS access-key identifier was detected."),
  rule("aws-secret-key", "critical", /\bAWS_SECRET_ACCESS_KEY\s*=\s*[^\s#]{20,}/gi, "An AWS secret access key was detected."),
  rule("google-api-key", "critical", /\bAIza[A-Za-z0-9_-]{30,}\b/g, "A Google API key was detected."),
  rule("slack-token", "critical", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g, "A Slack token was detected."),
  rule("stripe-secret", "critical", /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/g, "A Stripe secret key was detected."),
  rule("npm-token", "critical", /\bnpm_[A-Za-z0-9]{30,}\b/g, "An npm access token was detected."),
  rule("database-url", "critical", /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis):\/\/[^\s:/@]+:[^\s/@]+@[^\s]+/gi, "A database URL contains embedded credentials."),
  rule("secret-env", "critical", /\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|CREDENTIAL)[A-Z0-9_]*\s*=\s*["']?[^\s"'#]{6,}["']?/gi, "A secret-bearing environment variable was detected."),
  rule("oauth-secret", "critical", /\b(?:client_secret|refresh_token)\s*[:=]\s*["']?[A-Za-z0-9._~+\/-]{12,}["']?/gi, "OAuth credential material was detected."),
];

const warningRules: Rule[] = [
  rule("email", "warning", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/gi, "An email address may identify a person."),
  rule("phone", "warning", /(?<!\w)(?:\+?91[-\s]?)?[6-9]\d{9}(?!\w)/g, "A phone-number candidate may identify a person."),
  rule("aadhaar-candidate", "warning", /(?<!\d)(?:\d[ -]?){11}\d(?!\d)/g, "A 12-digit Aadhaar-like identifier was found. This is a heuristic match."),
  rule("pan-candidate", "warning", /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g, "An Indian PAN-like identifier was found. This is a heuristic match."),
  rule("ipv4", "warning", /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "An IP address may expose internal infrastructure.", (value) => value.split(".").every((part) => Number(part) <= 255)),
  rule("local-path", "warning", /(?:\b[A-Za-z]:\\(?:[^\s<>:"|?*]+\\)*[^\s<>:"|?*]*|\/(?:Users|home|root|workspace|srv|opt|var)\/[A-Za-z0-9._~\/-]+)/g, "An absolute local path may reveal usernames or project structure."),
  rule("repository-url", "warning", /\bhttps?:\/\/(?:github\.com|gitlab\.com|bitbucket\.org)\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\b/gi, "A repository URL may identify private business work."),
  rule("internal-host", "warning", /\b(?:[a-z0-9-]+\.)+(?:internal|local|corp|lan)\b/gi, "An internal hostname may expose private infrastructure."),
];

const injectionRules: Rule[] = [
  rule("prompt-injection", "warning", /\b(?:ignore|disregard|override)\s+(?:all\s+)?(?:previous|prior|above|system|developer)\s+instructions?\b/gi, "Untrusted content appears to override higher-priority instructions."),
  rule("prompt-injection", "warning", /\b(?:reveal|print|show|leak|exfiltrate)\s+(?:the\s+)?(?:system prompt|developer message|secret|credential|token)s?\b/gi, "Untrusted content asks for protected instructions or data."),
  rule("prompt-injection", "warning", /\b(?:call|invoke|use)\s+(?:a\s+|the\s+)?(?:tool|browser|shell|terminal|api)\b/gi, "Untrusted content appears to request an external action."),
  rule("prompt-injection", "warning", /\b(?:you are now|system message|developer message)\s*:/gi, "Untrusted content may be impersonating an authoritative role."),
  rule("prompt-injection", "warning", /\b(?:base64|decode this|hidden instruction|zero[- ]width)\b/gi, "Untrusted content may contain encoded or obfuscated instructions."),
];

function luhn(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function preview(category: string, length: number): string {
  return "[MASKED " + category + " · " + length + " characters]";
}

function addRuleMatches(text: string, ruleValue: Rule, findings: SecurityFinding[]): void {
  const pattern = new RegExp(ruleValue.pattern.source, ruleValue.pattern.flags);
  for (const match of text.matchAll(pattern)) {
    const value = match[0];
    const start = match.index;
    if (start === undefined || (ruleValue.validate && !ruleValue.validate(value))) continue;
    findings.push({
      id: ruleValue.category + ":" + start + ":" + value.length,
      category: ruleValue.category,
      severity: ruleValue.severity,
      start,
      end: start + value.length,
      maskedPreview: preview(ruleValue.category, value.length),
      explanation: ruleValue.explanation,
      remediation: ruleValue.remediation,
    });
  }
}

function customPatternFindings(text: string, blockedPatterns: string[]): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const rawPattern of blockedPatterns.slice(0, 50)) {
    const pattern = rawPattern.trim().slice(0, 200);
    if (!pattern) continue;
    let start = text.toLocaleLowerCase().indexOf(pattern.toLocaleLowerCase());
    while (start >= 0) {
      findings.push({
        id: "custom-pattern:" + start + ":" + pattern.length,
        category: "custom-blocked-pattern",
        severity: "warning",
        start,
        end: start + pattern.length,
        maskedPreview: preview("custom pattern", pattern.length),
        explanation: "This matches a private name, domain, or path configured by the user.",
        remediation: "Review, redact, or explicitly acknowledge this item.",
      });
      start = text.toLocaleLowerCase().indexOf(pattern.toLocaleLowerCase(), start + pattern.length);
    }
  }
  return findings;
}

export function scanText(text: string, options: { trust?: "user" | "agent" | "web"; blockedPatterns?: string[] } = {}): SecurityFinding[] {
  if (utf8Bytes(text) > LIMITS.captureBytes) throw new Error("Security scan input exceeds the 1 MiB limit");
  const findings: SecurityFinding[] = [];
  for (const item of [...criticalRules, ...warningRules]) addRuleMatches(text, item, findings);
  const cardPattern = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;
  for (const match of text.matchAll(cardPattern)) {
    if (match.index !== undefined && luhn(match[0])) {
      findings.push({
        id: "payment-card:" + match.index + ":" + match[0].length,
        category: "payment-card",
        severity: "warning",
        start: match.index,
        end: match.index + match[0].length,
        maskedPreview: preview("payment card", match[0].length),
        explanation: "A payment-card candidate passed a checksum validation.",
        remediation: "Redact unless this value is essential and safe to share.",
      });
    }
  }
  if (options.trust === "agent" || options.trust === "web") {
    for (const item of injectionRules) addRuleMatches(text, item, findings);
  }
  findings.push(...customPatternFindings(text, options.blockedPatterns ?? []));
  const unique = new Map(findings.map((finding) => [finding.category + ":" + finding.start + ":" + finding.end, finding]));
  return [...unique.values()].sort((a, b) => a.start - b.start || severityRank(b.severity) - severityRank(a.severity));
}

function severityRank(severity: FindingSeverity): number {
  return severity === "critical" ? 3 : severity === "warning" ? 2 : 1;
}

export function hasCriticalFindings(findings: readonly SecurityFinding[]): boolean {
  return findings.some((finding) => finding.severity === "critical");
}

export function redactFindings(text: string, findings: readonly SecurityFinding[], severities: readonly FindingSeverity[] = ["critical", "warning"]): string {
  const chosen = findings.filter((finding) => severities.includes(finding.severity)).sort((a, b) => b.start - a.start);
  let output = text;
  let lastStart = Number.POSITIVE_INFINITY;
  for (const finding of chosen) {
    if (finding.end > lastStart) continue;
    output = output.slice(0, finding.start) + "[REDACTED:" + finding.category.toUpperCase() + "]" + output.slice(finding.end);
    lastStart = finding.start;
  }
  return output;
}
