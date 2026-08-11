import { compactText, cloneAsRevision } from "../../../shared/compact.ts";
import { approximateTokens, LIMITS, nowIso, parseContextPack, parseContextPackJson, sha256, uuid, type ContextPack, type TrustLevel } from "../../../shared/context-pack.ts";
import { createDelta } from "../../../shared/delta.ts";
import { POLICY_REVISION, POLICY_TEXT } from "../../../shared/policies.ts";
import { exportPublicJson, renderDelta, renderPack, type RenderResult } from "../../../shared/render.ts";
import { hasCriticalFindings, redactFindings, scanText, type SecurityFinding } from "../../../shared/security.ts";
import { DEFAULT_SETTINGS, type AuditEvent, type ListResult, type PackRecord, type PackSummary, type VaultSettings } from "../../../shared/vault.ts";
import type { ExtensionResponse } from "../messages.ts";

type ViewId = "captureView" | "securityView" | "editorView" | "previewView" | "packsView" | "settingsView" | "diagnosticsView";
type AppStatus = { setup: boolean; unlocked: boolean; version: string; permissions: string[]; bridgeBuild: boolean };
type CaptureResult = { text: string; title: string; url: string; capturedAt: string; trust: TrustLevel; provider?: string };

const views: ViewId[] = ["captureView", "securityView", "editorView", "previewView", "packsView", "settingsView", "diagnosticsView"];
const state = {
  status: undefined as AppStatus | undefined,
  settings: { ...DEFAULT_SETTINGS } as VaultSettings,
  sourceText: "",
  sourceCharacters: 0,
  sourceTrust: "user" as TrustLevel,
  sourceMeta: undefined as CaptureResult | undefined,
  sourceFindings: [] as SecurityFinding[],
  sourceWarningsAcknowledged: false,
  currentPack: undefined as ContextPack | undefined,
  persistedPack: undefined as ContextPack | undefined,
  currentRecord: undefined as PackRecord | undefined,
  artifacts: [] as ContextPack["artifacts"],
  dirty: false,
  previewMode: "full" as "full" | "delta",
  previewFormat: "markdown" as "markdown" | "json",
  previewText: "",
  previewRender: undefined as RenderResult | undefined,
  previewFindings: [] as SecurityFinding[],
  packSummaries: [] as PackSummary[],
};

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error("Missing interface element: " + id);
  return value as T;
}

const loadingView = element<HTMLElement>("loadingView");
const onboardingView = element<HTMLElement>("onboardingView");
const lockedView = element<HTMLElement>("lockedView");
const workspace = element<HTMLElement>("workspace");
const statusRail = element<HTMLElement>("statusRail");
const bottomNav = element<HTMLElement>("bottomNav");
const lockButton = element<HTMLButtonElement>("lockButton");
const manualInput = element<HTMLTextAreaElement>("manualInput");
const trustSelect = element<HTMLSelectElement>("trustSelect");
const draftTitle = element<HTMLInputElement>("draftTitle");
const reviewedSource = element<HTMLTextAreaElement>("reviewedSource");
const sourceWarningAck = element<HTMLInputElement>("sourceWarningAck");
const outboundPreview = element<HTMLTextAreaElement>("outboundPreview");
const outboundWarningAck = element<HTMLInputElement>("outboundWarningAck");
const exportFormat = element<HTMLSelectElement>("exportFormat");
const destinationLabel = element<HTMLInputElement>("destinationLabel");

void initialize();

async function initialize(): Promise<void> {
  bindEvents();
  try {
    const status = await send<AppStatus>("STATUS");
    state.status = status;
    element<HTMLElement>("diagVersion").textContent = status.version;
    element<HTMLElement>("permissionList").replaceChildren(...status.permissions.map(chip));
    loadingView.hidden = true;
    if (!status.setup) {
      onboardingView.hidden = false;
      return;
    }
    if (!status.unlocked) {
      lockedView.hidden = false;
      return;
    }
    await enterWorkspace();
  } catch (error) {
    loadingView.hidden = true;
    lockedView.hidden = false;
    toast(safeMessage(error), true);
  }
}

function bindEvents(): void {
  element<HTMLFormElement>("setupForm").addEventListener("submit", setupVault);
  element<HTMLFormElement>("unlockForm").addEventListener("submit", unlockVault);
  lockButton.addEventListener("click", lockVault);
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-reveal]")) button.addEventListener("click", togglePassword);
  element<HTMLInputElement>("setupPassphrase").addEventListener("input", updateStrength);
  manualInput.addEventListener("input", updateSourceCounts);
  trustSelect.addEventListener("change", () => { state.sourceTrust = trustSelect.value as TrustLevel; });
  element<HTMLButtonElement>("clearInputButton").addEventListener("click", clearSource);
  element<HTMLButtonElement>("captureSelectionButton").addEventListener("click", captureSelection);
  element<HTMLButtonElement>("providerCaptureButton").addEventListener("click", captureProvider);
  element<HTMLButtonElement>("reviewSourceButton").addEventListener("click", reviewSource);
  reviewedSource.addEventListener("input", () => {
    state.sourceText = reviewedSource.value;
    scanReviewedSource();
  });
  element<HTMLButtonElement>("redactCriticalButton").addEventListener("click", redactCriticalSource);
  sourceWarningAck.addEventListener("change", () => { state.sourceWarningsAcknowledged = sourceWarningAck.checked; updateSecurityContinue(); });
  element<HTMLButtonElement>("continueToEditorButton").addEventListener("click", buildDraft);
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-back]")) {
    button.addEventListener("click", () => showView(button.dataset.back as ViewId));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-nav]")) {
    button.addEventListener("click", () => navigate(button.dataset.nav as ViewId));
  }
  for (const id of editorInputIds()) element<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(id).addEventListener("input", markDirty);
  element<HTMLSelectElement>("policySelect").addEventListener("change", () => { markDirty(); updatePolicyEstimate(); });
  element<HTMLButtonElement>("savePackButton").addEventListener("click", () => void saveCurrentPack());
  element<HTMLButtonElement>("previewButton").addEventListener("click", () => void saveAndPreview());
  element<HTMLSelectElement>("revisionSelect").addEventListener("change", selectRevision);
  element<HTMLButtonElement>("fullModeButton").addEventListener("click", () => setPreviewMode("full"));
  element<HTMLButtonElement>("deltaModeButton").addEventListener("click", () => setPreviewMode("delta"));
  exportFormat.addEventListener("change", () => { state.previewFormat = exportFormat.value as "markdown" | "json"; void preparePreview(); });
  destinationLabel.addEventListener("input", () => { if (state.previewMode === "delta") void preparePreview(); });
  element<HTMLButtonElement>("selectPreviewButton").addEventListener("click", () => outboundPreview.select());
  element<HTMLButtonElement>("copyButton").addEventListener("click", copyReviewed);
  element<HTMLButtonElement>("insertButton").addEventListener("click", insertReviewed);
  element<HTMLButtonElement>("downloadButton").addEventListener("click", downloadReviewed);
  element<HTMLButtonElement>("activateButton").addEventListener("click", activateReviewed);
  outboundWarningAck.addEventListener("change", () => updateOutboundButtons());
  element<HTMLButtonElement>("newPackButton").addEventListener("click", startNewPack);
  element<HTMLInputElement>("packImportInput").addEventListener("change", importContextPack);
  element<HTMLInputElement>("packSearch").addEventListener("input", renderPacks);
  element<HTMLFormElement>("settingsForm").addEventListener("submit", saveSettings);
  element<HTMLButtonElement>("backupButton").addEventListener("click", exportBackup);
  element<HTMLInputElement>("backupInput").addEventListener("change", importBackup);
  element<HTMLFormElement>("passphraseForm").addEventListener("submit", changePassphrase);
  element<HTMLButtonElement>("deleteAllPacksButton").addEventListener("click", deleteAllPacks);
  element<HTMLButtonElement>("destroyVaultButton").addEventListener("click", destroyVault);
  element<HTMLButtonElement>("clearAuditButton").addEventListener("click", clearAudit);
  element<HTMLButtonElement>("revokeBridgeButton").addEventListener("click", revokeBridge);
  element<HTMLButtonElement>("setupMcpButton").addEventListener("click", setupMcpBridge);
  element<HTMLButtonElement>("checkMcpButton").addEventListener("click", checkMcpBridgeStatus);
  window.addEventListener("beforeunload", (event) => {
    if (state.dirty) event.preventDefault();
  });
  setInterval(() => void refreshStatus(), 30_000);
  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (message && typeof message === "object" && (message as Record<string, unknown>).type === "ACTIVE_TAB_CHANGED") {
      void detectActiveProvider();
    }
  });
}

async function enterWorkspace(): Promise<void> {
  onboardingView.hidden = true;
  lockedView.hidden = true;
  workspace.hidden = false;
  statusRail.hidden = false;
  bottomNav.hidden = false;
  lockButton.hidden = false;
  state.settings = await send<VaultSettings>("GET_SETTINGS");
  applySettingsToUi();
  setVaultUi(true);
  await loadPacks();
  showView("captureView");
  void detectActiveProvider();
}

async function setupVault(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const passphrase = element<HTMLInputElement>("setupPassphrase").value;
  const confirmation = element<HTMLInputElement>("setupConfirmation").value;
  const remember = element<HTMLInputElement>("setupRemember").checked;
  await withBusy(event.submitter as HTMLButtonElement, async () => {
    await send("SETUP_VAULT", { passphrase, confirmation, remember });
    toast("Encrypted vault created");
    await enterWorkspace();
  });
}

async function unlockVault(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const passphrase = element<HTMLInputElement>("unlockPassphrase").value;
  const remember = element<HTMLInputElement>("unlockRemember").checked;
  await withBusy(event.submitter as HTMLButtonElement, async () => {
    await send("UNLOCK", { passphrase, remember });
    element<HTMLInputElement>("unlockPassphrase").value = "";
    toast("Vault unlocked locally");
    await enterWorkspace();
  });
}

async function lockVault(): Promise<void> {
  await send("LOCK");
  workspace.hidden = true;
  statusRail.hidden = true;
  bottomNav.hidden = true;
  lockButton.hidden = true;
  lockedView.hidden = false;
  state.currentPack = undefined;
  state.persistedPack = undefined;
  state.currentRecord = undefined;
  state.previewText = "";
  setVaultUi(false);
}

async function refreshStatus(): Promise<void> {
  if (!workspace.hidden) {
    const status = await send<AppStatus>("STATUS").catch(() => undefined);
    if (status && !status.unlocked) await lockLocallyFromTimeout();
  }
}

async function lockLocallyFromTimeout(): Promise<void> {
  workspace.hidden = true;
  statusRail.hidden = true;
  bottomNav.hidden = true;
  lockButton.hidden = true;
  lockedView.hidden = false;
  setVaultUi(false);
  toast("Vault auto-locked after inactivity");
}

/** Proactively reads the active tab URL and shows the detected provider in the capture card. */
async function detectActiveProvider(): Promise<void> {
  try {
    const result = await send<{ provider: string; providerName: string } | null>("DETECT_PROVIDER").catch(() => null);
    const badge = document.getElementById("detectedProviderBadge");
    if (!badge) return;
    if (result && result.providerName && result.providerName !== "AI Assistant") {
      badge.textContent = result.providerName + " detected";
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  } catch {
    // Non-critical — silently ignore
  }
}

function togglePassword(event: Event): void {
  const button = event.currentTarget as HTMLButtonElement;
  const input = element<HTMLInputElement>(button.dataset.reveal ?? "");
  input.type = input.type === "password" ? "text" : "password";
  button.textContent = input.type === "password" ? "Show" : "Hide";
  button.setAttribute("aria-label", (input.type === "password" ? "Show" : "Hide") + " passphrase");
}

function updateStrength(): void {
  const value = element<HTMLInputElement>("setupPassphrase").value;
  let score = 0;
  if (value.length >= 12) score += 1;
  if (value.length >= 18) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value) && /[^\w\s]/.test(value)) score += 1;
  const bar = element<HTMLElement>("strengthBar");
  bar.style.transform = "scaleX(" + Math.min(1, score / 4) + ")";
  bar.style.background = score >= 3 ? "var(--success)" : score >= 2 ? "var(--warning)" : "var(--danger)";
  element<HTMLElement>("strengthText").textContent = score >= 3 ? "Strong phrase. Keep it somewhere only you control." : "Use 12+ characters; 18+ with mixed character types is stronger.";
}

function updateSourceCounts(): void {
  state.sourceText = manualInput.value;
  state.sourceCharacters = manualInput.value.length;
  element<HTMLElement>("sourceCharacters").textContent = manualInput.value.length.toLocaleString();
  element<HTMLElement>("sourceTokens").textContent = approximateTokens(manualInput.value).toLocaleString();
  element<HTMLElement>("inputSizeState").textContent = manualInput.value.length > 262_144 ? "Large input" : manualInput.value ? "Ready to scan" : "Ready";
  element<HTMLButtonElement>("reviewSourceButton").disabled = !manualInput.value.trim();
}

function clearSource(): void {
  manualInput.value = "";
  draftTitle.value = "";
  state.sourceMeta = undefined;
  updateSourceCounts();
  manualInput.focus();
}

async function captureSelection(): Promise<void> {
  await withBusy(element<HTMLButtonElement>("captureSelectionButton"), async () => {
    const result = await send<CaptureResult>("CAPTURE_SELECTION");
    applyCapture(result);
    toast("Selected text captured for local review");
  });
}

async function captureProvider(): Promise<void> {
  const button = element<HTMLButtonElement>("providerCaptureButton");
  button.disabled = true;
  try {
    const result = await send<CaptureResult>("CAPTURE_PROVIDER");
    applyCapture(result);
    toast("Conversation captured for local review");
  } catch (error) {
    toast(safeMessage(error), true);
  } finally {
    button.disabled = false;
  }
}

function applyCapture(result: CaptureResult): void {
  state.sourceMeta = result;
  manualInput.value = result.text;
  trustSelect.value = result.trust;
  state.sourceTrust = result.trust;
  draftTitle.value = result.title;
  updateSourceCounts();
  // Show detected provider badge
  const badge = document.getElementById("detectedProviderBadge");
  if (badge) {
    const name = (result as CaptureResult & { providerName?: string }).providerName;
    if (name && name !== "AI Assistant") {
      badge.textContent = name + " detected";
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }
  manualInput.focus();
}

function reviewSource(): void {
  if (!manualInput.value.trim()) return;
  state.sourceText = manualInput.value;
  state.sourceCharacters = manualInput.value.length;
  state.sourceTrust = trustSelect.value as TrustLevel;
  reviewedSource.value = state.sourceText;
  state.sourceWarningsAcknowledged = false;
  sourceWarningAck.checked = false;
  scanReviewedSource();
  showView("securityView");
}

function scanReviewedSource(): void {
  try {
    state.sourceFindings = scanText(state.sourceText, { trust: state.sourceTrust, blockedPatterns: state.settings.blockedPatterns });
    renderFindings(state.sourceFindings, element("findingsList"));
    const critical = state.sourceFindings.filter((finding) => finding.severity === "critical").length;
    const warnings = state.sourceFindings.filter((finding) => finding.severity === "warning").length;
    element<HTMLElement>("findingSummary").replaceChildren(
      summary("Critical", critical, "Must redact"),
      summary("Warnings", warnings, "Review"),
      summary("Input", approximateTokens(state.sourceText), "≈ tokens"),
    );
    const score = element<HTMLElement>("securityScore");
    score.textContent = critical ? "BLOCKED" : warnings ? "REVIEW" : "CLEAR";
    score.classList.toggle("blocked", critical > 0);
    element<HTMLElement>("noFindings").hidden = state.sourceFindings.length > 0;
    element<HTMLButtonElement>("redactCriticalButton").hidden = critical === 0;
    element<HTMLElement>("sourceWarningAckRow").hidden = warnings === 0;
    element<HTMLElement>("scanStatus").textContent = critical ? "Secrets blocked" : warnings ? "Warnings found" : "Scan clear";
    updateSecurityContinue();
  } catch (error) {
    element<HTMLButtonElement>("continueToEditorButton").disabled = true;
    toast("Scanner failed safely: " + safeMessage(error), true);
  }
}

function updateSecurityContinue(): void {
  const critical = hasCriticalFindings(state.sourceFindings);
  const warnings = state.sourceFindings.some((finding) => finding.severity === "warning");
  element<HTMLButtonElement>("continueToEditorButton").disabled = critical || (warnings && !sourceWarningAck.checked);
}

function redactCriticalSource(): void {
  state.sourceText = redactFindings(state.sourceText, state.sourceFindings, ["critical"]);
  reviewedSource.value = state.sourceText;
  manualInput.value = state.sourceText;
  updateSourceCounts();
  scanReviewedSource();
  toast("Critical secret candidates were fully redacted");
}

async function buildDraft(): Promise<void> {
  if (hasCriticalFindings(state.sourceFindings)) return;
  const warningCount = state.sourceFindings.filter((finding) => finding.severity === "warning").length;
  if (warningCount && !sourceWarningAck.checked) return;
  state.sourceWarningsAcknowledged = sourceWarningAck.checked;
  const title = draftTitle.value.trim() || state.sourceMeta?.title || "Untitled Context Pack";
  const provider = state.sourceMeta?.provider ?? (state.sourceMeta ? new URL(state.sourceMeta.url).hostname : "manual");
  const options = {
    provider,
    title,
    trust: state.sourceTrust,
    evidenceBudget: Math.min(32_000, state.settings.contextBudget),
    ...(state.sourceMeta?.url ? { url: state.sourceMeta.url } : {}),
  };
  let pack = await compactText(state.sourceText, options);
  if (state.settings.defaultExpiryDays > 0) {
    pack = parseContextPack({ ...pack, expiresAt: new Date(Date.now() + state.settings.defaultExpiryDays * 86_400_000).toISOString() });
  }
  state.currentPack = pack;
  state.persistedPack = undefined;
  state.currentRecord = undefined;
  state.artifacts = [...pack.artifacts];
  state.dirty = true;
  fillEditor(pack);
  showView("editorView");
}

function fillEditor(pack: ContextPack): void {
  element<HTMLInputElement>("editorPackTitle").value = pack.title;
  element<HTMLTextAreaElement>("editorGoal").value = pack.goal;
  element<HTMLTextAreaElement>("editorFacts").value = pack.facts.join("\n");
  element<HTMLTextAreaElement>("editorConstraints").value = pack.constraints.join("\n");
  element<HTMLTextAreaElement>("editorDecisions").value = pack.decisions.join("\n");
  element<HTMLTextAreaElement>("editorCompleted").value = pack.completed.join("\n");
  element<HTMLTextAreaElement>("editorBlockers").value = pack.blockers.join("\n");
  element<HTMLTextAreaElement>("editorUnresolved").value = pack.unresolved.join("\n");
  element<HTMLTextAreaElement>("editorNextActions").value = pack.nextActions.join("\n");
  element<HTMLTextAreaElement>("editorEvidence").value = pack.evidence.map((item) => item.text).join("\n\n");
  element<HTMLSelectElement>("editorSensitivity").value = pack.sensitivity;
  element<HTMLSelectElement>("policySelect").value = pack.policyProfile;
  element<HTMLInputElement>("editorExpiry").value = pack.expiresAt ? pack.expiresAt.slice(0, 10) : "";
  state.artifacts = [...pack.artifacts];
  renderArtifacts();
  renderRevisionOptions();
  updatePolicyEstimate();
}

function renderRevisionOptions(): void {
  const select = element<HTMLSelectElement>("revisionSelect");
  const revisions = state.currentRecord?.revisions ?? (state.currentPack ? [state.currentPack] : []);
  select.replaceChildren(...revisions.slice().reverse().map((pack) => {
    const option = document.createElement("option");
    option.value = String(pack.revision);
    option.textContent = "Revision " + pack.revision;
    option.selected = pack.revision === state.currentPack?.revision;
    return option;
  }));
  select.disabled = revisions.length < 2;
}

function selectRevision(): void {
  if (!state.currentRecord || !state.persistedPack) return;
  const revision = Number(element<HTMLSelectElement>("revisionSelect").value);
  const selected = state.currentRecord.revisions.find((item) => item.revision === revision);
  if (!selected) return;
  state.currentPack = selected;
  fillEditor(selected);
  state.dirty = selected.revision !== state.persistedPack.revision;
  updateDirtyUi();
  toast(selected.revision === state.persistedPack.revision ? "Current revision loaded" : "Older revision loaded. Saving creates a new current revision.");
}

function editorInputIds(): string[] {
  return ["editorPackTitle", "editorGoal", "editorFacts", "editorConstraints", "editorDecisions", "editorCompleted", "editorBlockers", "editorUnresolved", "editorNextActions", "editorEvidence", "editorSensitivity", "editorExpiry"];
}

function markDirty(): void {
  state.dirty = true;
  state.sourceWarningsAcknowledged = false;
  updateDirtyUi();
}

function updateDirtyUi(): void {
  element<HTMLElement>("dirtyPill").hidden = !state.dirty;
}

function syncPackFromEditor(): ContextPack {
  if (!state.currentPack) throw new Error("No draft pack is open");
  const sourceId = state.currentPack.sources[0]?.id;
  if (!sourceId) throw new Error("Pack has no source provenance");
  const expiresDate = element<HTMLInputElement>("editorExpiry").value;
  const evidence = splitBlocks(element<HTMLTextAreaElement>("editorEvidence").value).map((text) => ({ id: uuid(), sourceId, text }));
  const value = {
    ...state.currentPack,
    title: element<HTMLInputElement>("editorPackTitle").value.trim() || "Untitled Context Pack",
    goal: element<HTMLTextAreaElement>("editorGoal").value.trim(),
    facts: splitLines(element<HTMLTextAreaElement>("editorFacts").value),
    constraints: splitLines(element<HTMLTextAreaElement>("editorConstraints").value),
    decisions: splitLines(element<HTMLTextAreaElement>("editorDecisions").value),
    completed: splitLines(element<HTMLTextAreaElement>("editorCompleted").value),
    blockers: splitLines(element<HTMLTextAreaElement>("editorBlockers").value),
    unresolved: splitLines(element<HTMLTextAreaElement>("editorUnresolved").value),
    nextActions: splitLines(element<HTMLTextAreaElement>("editorNextActions").value),
    evidence,
    artifacts: state.artifacts,
    sensitivity: element<HTMLSelectElement>("editorSensitivity").value,
    policyProfile: element<HTMLSelectElement>("policySelect").value,
    ...(expiresDate ? { expiresAt: expiresDate + "T23:59:59.999Z" } : { expiresAt: undefined }),
  };
  const cleaned = { ...value } as Record<string, unknown>;
  if (!expiresDate) delete cleaned.expiresAt;
  return parseContextPack(cleaned);
}

async function saveCurrentPack(): Promise<ContextPack> {
  const edited = syncPackFromEditor();
  let packToSave = edited;
  if (state.persistedPack) {
    if (!state.dirty) return state.persistedPack;
    const updates = { ...edited } as Partial<ContextPack> & Record<string, unknown>;
    delete updates.revision;
    delete updates.parentRevision;
    delete updates.createdAt;
    delete updates.updatedAt;
    packToSave = cloneAsRevision(state.persistedPack, updates);
  }
  const rendered = renderPack(packToSave, { budget: state.settings.contextBudget });
  const findings = scanText(rendered.text + "\n" + exportPublicJson(packToSave), { trust: "agent", blockedPatterns: state.settings.blockedPatterns });
  if (hasCriticalFindings(findings)) {
    showView("previewView");
    state.currentPack = packToSave;
    await preparePreview();
    throw new Error("Critical secrets block encrypted save until they are redacted");
  }
  const warnings = findings.some((finding) => finding.severity === "warning");
  let acknowledged = state.sourceWarningsAcknowledged;
  if (warnings && !acknowledged) {
    acknowledged = window.confirm("This revision contains sensitive-data or prompt-injection warnings. Save it encrypted after reviewing those warnings?");
    if (!acknowledged) throw new Error("Save cancelled pending warning review");
  }
  const saved = await send<ContextPack>("SAVE_PACK", { pack: packToSave, acknowledgeWarnings: acknowledged });
  state.currentPack = saved;
  state.persistedPack = saved;
  state.currentRecord = await send<PackRecord>("GET_PACK_RECORD", { id: saved.id });
  state.dirty = false;
  state.sourceWarningsAcknowledged = acknowledged;
  updateDirtyUi();
  fillEditor(saved);
  await loadPacks();
  toast("Revision " + saved.revision + " saved encrypted");
  return saved;
}

async function saveAndPreview(): Promise<void> {
  await withBusy(element<HTMLButtonElement>("previewButton"), async () => {
    await saveCurrentPack();
    state.previewMode = "full";
    state.previewFormat = "markdown";
    exportFormat.value = "markdown";
    await preparePreview();
    showView("previewView");
  });
}

function renderArtifacts(): void {
  const container = element<HTMLElement>("artifactList");
  container.replaceChildren();
  for (const artifact of state.artifacts) {
    const row = document.createElement("div");
    row.className = "artifact";
    const badge = document.createElement("span");
    badge.className = "count-badge";
    badge.textContent = artifact.type;
    const code = document.createElement("code");
    code.textContent = artifact.value;
    code.title = artifact.value.slice(0, 200);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", "Remove " + artifact.type + " artifact");
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      state.artifacts = state.artifacts.filter((item) => item.id !== artifact.id);
      markDirty();
      renderArtifacts();
    });
    row.append(badge, code, remove);
    container.append(row);
  }
  element<HTMLElement>("artifactCount").textContent = String(state.artifacts.length);
  if (!state.artifacts.length) {
    const empty = document.createElement("small");
    empty.textContent = "No exact artifacts detected.";
    container.append(empty);
  }
}

function updatePolicyEstimate(): void {
  const profile = element<HTMLSelectElement>("policySelect").value as keyof typeof POLICY_TEXT;
  element<HTMLElement>("policyEstimate").textContent = profile === "off"
    ? "No policy will be added."
    : "Coding policy revision " + POLICY_REVISION + " · ≈ " + approximateTokens(POLICY_TEXT[profile]) + " tokens. Applied only when explicitly selected.";
}

function setPreviewMode(mode: "full" | "delta"): void {
  state.previewMode = mode;
  element<HTMLButtonElement>("fullModeButton").classList.toggle("active", mode === "full");
  element<HTMLButtonElement>("deltaModeButton").classList.toggle("active", mode === "delta");
  element<HTMLElement>("previewModeBadge").textContent = mode === "full" ? "Full" : "Delta";
  void preparePreview();
}

async function preparePreview(): Promise<void> {
  const pack = state.persistedPack ?? state.currentPack;
  if (!pack) return;
  let render: RenderResult;
  let exportValue: unknown = pack;
  if (state.previewMode === "delta") {
    const label = destinationLabel.value.trim();
    const destination = label ? state.currentRecord?.destinations[label] : undefined;
    if (!destination) {
      render = blockedPreview("Choose a destination label that has previously received this pack. A delta requires a known parent revision.");
    } else {
      const parent = await send<ContextPack>("GET_PACK", { id: pack.id, revision: destination.revision });
      const delta = createDelta(parent, pack);
      render = renderDelta(delta);
      exportValue = delta;
    }
  } else {
    render = renderPack(pack, { budget: state.settings.contextBudget });
  }
  const text = state.previewFormat === "json"
    ? JSON.stringify(exportValue, null, 2) + "\n"
    : render.text;
  state.previewRender = { ...render, text, characters: text.length, approximateTokens: approximateTokens(text) };
  state.previewText = text;
  state.previewFindings = scanText(text, { trust: "agent", blockedPatterns: state.settings.blockedPatterns });
  outboundPreview.value = text;
  outboundWarningAck.checked = false;
  renderFindings(state.previewFindings, element("outboundFindings"));
  const warnings = state.previewFindings.some((finding) => finding.severity === "warning");
  element<HTMLElement>("outboundWarningAckRow").hidden = !warnings;
  element<HTMLElement>("previewRevisionText").textContent = "Revision " + pack.revision + " · " + state.previewMode + " · " + state.previewFormat;
  updateMetrics(text);
  const critical = hasCriticalFindings(state.previewFindings);
  const alert = element<HTMLElement>("previewAlert");
  alert.hidden = !(render.blocked || critical);
  alert.textContent = critical ? "Critical secrets remain in the final output. Redact them in the editor before sharing." : render.reason ?? "";
  alert.classList.toggle("danger-notice", critical || render.blocked);
  element<HTMLElement>("scanStatus").textContent = critical ? "Secrets blocked" : warnings ? "Warnings found" : "Final scan clear";
  updateOutboundButtons();
}

function blockedPreview(reason: string): RenderResult {
  return { text: "# DELTA UNAVAILABLE\n\n" + reason, mode: "delta", characters: reason.length, approximateTokens: approximateTokens(reason), omittedEvidence: 0, blocked: true, reason };
}

function updateMetrics(text: string): void {
  const source = state.sourceCharacters || estimatePackSource(state.currentPack);
  element<HTMLElement>("metricSourceChars").textContent = source.toLocaleString();
  element<HTMLElement>("metricOutputChars").textContent = text.length.toLocaleString();
  element<HTMLElement>("metricOutputTokens").textContent = approximateTokens(text).toLocaleString();
  const reduction = source > 0 ? Math.round((1 - text.length / source) * 100) : 0;
  element<HTMLElement>("metricReduction").textContent = (reduction > 0 ? reduction : 0) + "%";
}

function updateOutboundButtons(): void {
  const warnings = state.previewFindings.some((finding) => finding.severity === "warning");
  const blocked = Boolean(state.previewRender?.blocked) || hasCriticalFindings(state.previewFindings) || (warnings && !outboundWarningAck.checked);
  for (const id of ["copyButton", "insertButton", "downloadButton", "activateButton"]) element<HTMLButtonElement>(id).disabled = blocked;
  if (state.status && !state.status.bridgeBuild) element<HTMLButtonElement>("activateButton").title = "Requires the separate bridge-enabled extension build";
}

async function approveOutbound(): Promise<string> {
  if (!state.previewText || state.previewRender?.blocked) throw new Error("The current output cannot be shared");
  if (hasCriticalFindings(state.previewFindings)) throw new Error("Critical secrets must be redacted");
  const warnings = state.previewFindings.some((finding) => finding.severity === "warning");
  if (warnings && !outboundWarningAck.checked) throw new Error("Review and acknowledge the outgoing warnings");
  const result = await send<{ digest: string; approved: boolean }>("VALIDATE_OUTBOUND", {
    text: state.previewText,
    trust: "agent",
    acknowledgeWarnings: outboundWarningAck.checked,
  });
  return result.digest;
}

async function copyReviewed(): Promise<void> {
  await withBusy(element<HTMLButtonElement>("copyButton"), async () => {
    await approveOutbound();
    try {
      await navigator.clipboard.writeText(state.previewText);
      toast("Reviewed context copied");
    } catch {
      outboundPreview.focus();
      outboundPreview.select();
      throw new Error("Clipboard access failed. The exact preview is selected for manual copying.");
    }
    await recordOutbound("copy");
  });
}

async function insertReviewed(): Promise<void> {
  await withBusy(element<HTMLButtonElement>("insertButton"), async () => {
    const pack = state.persistedPack;
    if (!pack) throw new Error("Save the pack before insertion");
    const digest = await approveOutbound();
    const result = await send<{ inserted: boolean; fallbackRequired?: boolean; reason?: string; insertedCharacters?: number; provider?: string; submitted?: boolean }>("INSERT_REVIEWED", {
      text: state.previewText,
      digest,
      packId: pack.id,
      revision: pack.revision,
      acknowledgeWarnings: outboundWarningAck.checked,
    });
    if (!result.inserted) {
      await navigator.clipboard.writeText(state.previewText);
      toast("Adapter failed safely; reviewed context copied instead");
    } else {
      toast("Inserted " + (result.insertedCharacters ?? 0).toLocaleString() + " characters without sending");
    }
    await recordOutbound("insert");
  });
}

async function downloadReviewed(): Promise<void> {
  await withBusy(element<HTMLButtonElement>("downloadButton"), async () => {
    await approveOutbound();
    const pack = state.persistedPack;
    if (!pack) throw new Error("Save the pack before download");
    const extension = state.previewFormat === "json" ? "json" : "md";
    downloadBlob(state.previewText, slug(pack.title) + "-r" + pack.revision + "." + extension, state.previewFormat === "json" ? "application/json" : "text/markdown");
    await recordOutbound("download");
  });
}

async function activateReviewed(): Promise<void> {
  await withBusy(element<HTMLButtonElement>("activateButton"), async () => {
    const pack = state.persistedPack;
    if (!pack) throw new Error("Save the pack before activation");
    if (!window.confirm("Activate this exact reviewed revision for the local MCP bridge for 15 minutes?")) return;
    const digest = await approveOutbound();
    await send("ACTIVATE_LOCAL", {
      pack,
      rendered: state.previewText,
      digest,
      ttlMinutes: 15,
      acknowledgeWarnings: outboundWarningAck.checked,
    });
    element<HTMLElement>("modeStatus").textContent = "Local bridge active · 15m";
    toast("Reviewed revision activated for 15 minutes");
    await recordOutbound("activate");
  });
}

async function recordOutbound(operation: string): Promise<void> {
  const pack = state.persistedPack;
  if (!pack) return;
  const label = destinationLabel.value.trim();
  if (label) await send("MARK_DESTINATION", { id: pack.id, label, revision: pack.revision, policyRevision: POLICY_REVISION });
  await send("APPEND_AUDIT", {
    event: {
      eventType: operation,
      timestamp: nowIso(),
      packId: pack.id,
      revision: pack.revision,
      ...(label ? { destination: label } : {}),
      result: "success",
      characters: state.previewText.length,
      criticalFindings: state.previewFindings.filter((finding) => finding.severity === "critical").length,
      warningFindings: state.previewFindings.filter((finding) => finding.severity === "warning").length,
      mode: state.previewMode,
    },
  });
  state.currentRecord = await send<PackRecord>("GET_PACK_RECORD", { id: pack.id });
}

async function loadPacks(): Promise<void> {
  const result = await send<ListResult>("LIST_PACKS");
  state.packSummaries = result.packs;
  element<HTMLElement>("diagPacks").textContent = String(result.packs.length);
  const notice = element<HTMLElement>("corruptNotice");
  notice.hidden = result.unreadableRecordIds.length === 0;
  notice.textContent = result.unreadableRecordIds.length
    ? result.unreadableRecordIds.length + " encrypted record(s) could not be authenticated. They were preserved for backup and were not overwritten."
    : "";
  renderPacks();
}

async function importContextPack(event: Event): Promise<void> {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    if (file.size > LIMITS.importBytes) throw new Error("Context Pack import exceeds the 2 MiB limit");
    const json = await file.text();
    const pack = parseContextPackJson(json);
    if (state.packSummaries.some((item) => item.id === pack.id)) throw new Error("A pack with this ID already exists. Open it or import a separately exported copy.");
    const rendered = renderPack(pack, { budget: state.settings.contextBudget });
    const findings = scanText(rendered.text + "\n" + exportPublicJson(pack), { trust: "agent", blockedPatterns: state.settings.blockedPatterns });
    state.currentPack = pack;
    state.persistedPack = undefined;
    state.currentRecord = undefined;
    state.sourceText = json;
    state.sourceCharacters = json.length;
    state.sourceTrust = "agent";
    state.sourceFindings = findings;
    state.sourceWarningsAcknowledged = false;
    state.artifacts = [...pack.artifacts];
    state.dirty = true;
    fillEditor(pack);
    updateDirtyUi();
    showView("editorView");
    if (hasCriticalFindings(findings)) toast("Imported draft is blocked by critical secret findings. Redact them before saving.", true);
    else if (findings.some((finding) => finding.severity === "warning")) toast("Imported draft is valid but contains warnings that require review.");
    else toast("Validated Context Pack imported as an unsaved draft");
  } catch (error) {
    toast("Import rejected safely: " + safeMessage(error), true);
  }
}

function renderPacks(): void {
  const query = element<HTMLInputElement>("packSearch").value.trim().toLocaleLowerCase();
  const packs = state.packSummaries.filter((pack) => pack.title.toLocaleLowerCase().includes(query));
  const container = element<HTMLElement>("packsList");
  container.replaceChildren();
  for (const pack of packs) container.append(packCard(pack));
  element<HTMLElement>("emptyPacks").hidden = packs.length > 0;
}

function packCard(pack: PackSummary): HTMLElement {
  const row = document.createElement("article");
  row.className = "pack-card";
  const icon = document.createElement("span");
  icon.className = "pack-icon";
  icon.textContent = "◇";
  const body = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = pack.title;
  const meta = document.createElement("small");
  meta.textContent = "Revision " + pack.revision + " · " + new Date(pack.updatedAt).toLocaleDateString() + (pack.expiresAt ? " · expires " + new Date(pack.expiresAt).toLocaleDateString() : "");
  body.append(title, meta);
  const actions = document.createElement("div");
  actions.className = "pack-actions";
  actions.append(
    iconButton("Open " + pack.title, "→", () => void openPack(pack.id)),
    iconButton("Duplicate " + pack.title, "⧉", () => void duplicatePack(pack.id)),
    iconButton("Delete " + pack.title, "×", () => void deletePack(pack.id, pack.title)),
  );
  row.append(icon, body, actions);
  return row;
}

async function openPack(id: string): Promise<void> {
  const record = await send<PackRecord>("GET_PACK_RECORD", { id });
  state.currentRecord = record;
  state.currentPack = record.current;
  state.persistedPack = record.current;
  state.sourceCharacters = estimatePackSource(record.current);
  state.artifacts = [...record.current.artifacts];
  state.dirty = false;
  updateDirtyUi();
  fillEditor(record.current);
  showView("editorView");
}

async function duplicatePack(id: string): Promise<void> {
  const original = await send<ContextPack>("GET_PACK", { id });
  const timestamp = nowIso();
  const duplicate = parseContextPack({
    ...original,
    id: uuid(),
    revision: 1,
    title: (original.title + " copy").slice(0, 160),
    createdAt: timestamp,
    updatedAt: timestamp,
    parentRevision: undefined,
  });
  const plain = { ...duplicate } as Record<string, unknown>;
  delete plain.parentRevision;
  const clean = parseContextPack(plain);
  await send("SAVE_PACK", { pack: clean, acknowledgeWarnings: true });
  await loadPacks();
  toast("Pack duplicated encrypted");
}

async function deletePack(id: string, title: string): Promise<void> {
  if (!window.confirm("Delete \"" + title + "\" from this browser? This also revokes an active local share.")) return;
  await send("DELETE_PACK", { id });
  if (state.currentPack?.id === id) startNewPack();
  await loadPacks();
  toast("Pack deleted");
}

function startNewPack(): void {
  state.currentPack = undefined;
  state.persistedPack = undefined;
  state.currentRecord = undefined;
  state.sourceText = "";
  state.sourceCharacters = 0;
  state.artifacts = [];
  state.dirty = false;
  clearSource();
  updateDirtyUi();
  showView("captureView");
}

function applySettingsToUi(): void {
  element<HTMLSelectElement>("autoLockMinutes").value = String(state.settings.autoLockMinutes);
  element<HTMLSelectElement>("defaultExpiryDays").value = String(state.settings.defaultExpiryDays);
  element<HTMLInputElement>("contextBudget").value = String(state.settings.contextBudget);
  element<HTMLSelectElement>("themeSelect").value = state.settings.theme;
  element<HTMLTextAreaElement>("blockedPatterns").value = state.settings.blockedPatterns.join("\n");
  applyTheme(state.settings.theme);
}

async function saveSettings(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const settings = {
    autoLockMinutes: Number(element<HTMLSelectElement>("autoLockMinutes").value),
    defaultExpiryDays: Number(element<HTMLSelectElement>("defaultExpiryDays").value),
    contextBudget: Number(element<HTMLInputElement>("contextBudget").value),
    theme: element<HTMLSelectElement>("themeSelect").value,
    blockedPatterns: splitLines(element<HTMLTextAreaElement>("blockedPatterns").value),
  };
  state.settings = await send<VaultSettings>("SAVE_SETTINGS", { settings });
  applyTheme(state.settings.theme);
  toast("Encrypted settings saved");
}

async function exportBackup(): Promise<void> {
  const result = await send<{ json: string }>("EXPORT_BACKUP");
  downloadBlob(result.json, "context-bridge-encrypted-backup-" + new Date().toISOString().slice(0, 10) + ".json", "application/json");
  toast("Encrypted backup downloaded");
}

async function importBackup(): Promise<void> {
  const file = element<HTMLInputElement>("backupInput").files?.[0];
  if (!file) return;
  if (!window.confirm("Importing this backup replaces the current vault records and locks the vault. Continue?")) return;
  const json = await file.text();
  await send("IMPORT_BACKUP", { json });
  toast("Encrypted backup imported. Unlock it with its original passphrase.");
  await lockLocallyFromTimeout();
}

async function changePassphrase(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const currentPassphrase = element<HTMLInputElement>("currentPassphrase").value;
  const newPassphrase = element<HTMLInputElement>("newPassphrase").value;
  const confirmation = element<HTMLInputElement>("newPassphraseConfirmation").value;
  await withBusy(event.submitter as HTMLButtonElement, async () => {
    await send("CHANGE_PASSPHRASE", { currentPassphrase, newPassphrase, confirmation });
    element<HTMLFormElement>("passphraseForm").reset();
    toast("Vault re-encrypted with the new passphrase");
  });
}

async function deleteAllPacks(): Promise<void> {
  if (!window.confirm("Delete every encrypted Context Pack and revoke the active share? Settings and audit events remain.")) return;
  await send("DELETE_ALL_PACKS");
  await loadPacks();
  startNewPack();
  toast("All packs deleted");
}

async function destroyVault(): Promise<void> {
  const phrase = window.prompt("Type DELETE VAULT to permanently remove this extension's vault records and settings.");
  if (phrase !== "DELETE VAULT") return;
  await send("DESTROY_VAULT");
  location.reload();
}

async function loadDiagnostics(): Promise<void> {
  const status = await send<AppStatus>("STATUS");
  state.status = status;
  element<HTMLElement>("diagMode").textContent = status.bridgeBuild ? "Bridge build" : "Local only";
  element<HTMLElement>("diagBridge").textContent = status.bridgeBuild ? "Native host optional" : "Bridge permission absent";
  element<HTMLElement>("modeStatus").textContent = status.bridgeBuild ? "Bridge build · inactive" : "Local only";
  await loadPacks();
  const events = await send<AuditEvent[]>("READ_AUDIT");
  const list = element<HTMLElement>("auditList");
  list.replaceChildren();
  for (const event of events.slice().reverse().slice(0, 50)) {
    const row = document.createElement("div");
    row.className = "audit-row";
    const name = document.createElement("strong");
    name.textContent = event.eventType + " · " + event.result;
    const meta = document.createElement("small");
    meta.textContent = new Date(event.timestamp).toLocaleString() + " · " + event.characters.toLocaleString() + " chars · " + event.mode;
    row.append(name, meta);
    list.append(row);
  }
  if (!events.length) {
    const empty = document.createElement("small");
    empty.textContent = "No outbound events recorded.";
    list.append(empty);
  }
  if (status.bridgeBuild) {
    const bridge = await send<Record<string, unknown>>("LOCAL_STATUS").catch(() => undefined);
    element<HTMLElement>("bridgeStatusText").textContent = bridge ? "Native host reachable. Status: " + String(bridge.status ?? "available") : "Bridge build detected, but the native host is not installed or reachable.";
  }
}

async function clearAudit(): Promise<void> {
  if (!window.confirm("Clear the encrypted content-free audit trail?")) return;
  await send("CLEAR_AUDIT");
  await loadDiagnostics();
  toast("Audit trail cleared");
}

async function revokeBridge(): Promise<void> {
  await send("REVOKE_LOCAL");
  element<HTMLElement>("modeStatus").textContent = state.status?.bridgeBuild ? "Bridge build · inactive" : "Local only";
  toast("Active local context revoked");
}

async function setupMcpBridge(): Promise<void> {
  await withBusy(element<HTMLButtonElement>("setupMcpButton"), async () => {
    const { script, filename } = await send<{ script: string; filename: string }>("GENERATE_MCP_SETUP");
    // Download the personalised PowerShell script — no eval, no external URLs, CSP-safe.
    downloadBlob(script, filename, "text/plain");
    // Show post-setup instructions
    const instructions = document.getElementById("mcpBridgeInstructions");
    if (instructions) instructions.hidden = false;
    const notice = document.getElementById("mcpBridgeNotice");
    if (notice) notice.hidden = false;
    // Populate the Claude Desktop config snippet
    const snippet = document.getElementById("claudeConfigSnippet");
    if (snippet) {
      snippet.textContent = JSON.stringify({
        mcpServers: {
          "context-bridge": {
            command: "node",
            args: ["%LOCALAPPDATA%\\ContextBridge\\native-host.mjs"],
          },
        },
      }, null, 2);
    }
    toast("Setup script downloaded — right-click → Run with PowerShell");
  });
}

async function checkMcpBridgeStatus(): Promise<void> {
  const badge = document.getElementById("mcpBridgeStatusBadge");
  const diagStatus = document.getElementById("diagBridgeStatus");
  try {
    await send("LOCAL_STATUS");
    // LOCAL_STATUS succeeded → native host is installed and responding
    if (badge) { badge.textContent = "✓ Active"; badge.className = "status-badge status-badge--active"; }
    if (diagStatus) diagStatus.textContent = "Bridge active";
    toast("MCP Bridge is installed and responding");
  } catch {
    // Native host not installed or not responding
    if (badge) { badge.textContent = "Not set up"; badge.className = "status-badge status-badge--inactive"; }
    if (diagStatus) diagStatus.textContent = "Not installed";
    toast("MCP Bridge not detected — download and run the setup script", true);
  }
}


async function navigate(view: ViewId): Promise<void> {
  if (view === "packsView") await loadPacks();
  if (view === "diagnosticsView") await loadDiagnostics();
  showView(view);
}

function showView(id: ViewId): void {
  for (const view of views) element<HTMLElement>(view).hidden = view !== id;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-nav]")) button.classList.toggle("active", button.dataset.nav === id);
  document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
  element<HTMLElement>(id).querySelector<HTMLElement>("h1, button, input, textarea, select")?.focus({ preventScroll: true });
}

function renderFindings(findings: SecurityFinding[], container: HTMLElement): void {
  container.replaceChildren();
  for (const finding of findings.slice(0, 80)) {
    const row = document.createElement("article");
    row.className = "finding " + finding.severity;
    const icon = document.createElement("span");
    icon.className = "finding-icon";
    icon.textContent = finding.severity === "critical" ? "!" : finding.category === "prompt-injection" ? "↯" : "i";
    const body = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = labelize(finding.category) + " · " + finding.severity;
    const detail = document.createElement("small");
    detail.textContent = finding.explanation + " " + finding.remediation;
    const masked = document.createElement("span");
    masked.className = "masked";
    masked.textContent = finding.maskedPreview;
    body.append(title, detail, masked);
    row.append(icon, body);
    container.append(row);
  }
}

function updateOutboundBadge(): void {
  element<HTMLElement>("scanPill").hidden = false;
}

function setVaultUi(unlocked: boolean): void {
  element<HTMLElement>("vaultStatus").textContent = unlocked ? "Vault unlocked" : "Vault locked";
  element<HTMLElement>("vaultDot").style.background = unlocked ? "var(--success)" : "var(--danger)";
}

function updateSecurityBadge(): void {
  updateOutboundBadge();
}

function summary(label: string, value: number, caption: string): HTMLElement {
  const box = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = value.toLocaleString();
  const small = document.createElement("small");
  small.textContent = label + " · " + caption;
  box.append(strong, small);
  return box;
}

function chip(value: string): HTMLElement {
  const span = document.createElement("span");
  span.textContent = value;
  return span;
}

function iconButton(label: string, text: string, handler: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.textContent = text;
  button.addEventListener("click", handler);
  return button;
}

async function send<T = unknown>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
  const requestId = crypto.randomUUID();
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Extension request timed out safely")), 15_000));
  const response = await Promise.race([
    chrome.runtime.sendMessage({ requestId, type, ...payload }) as Promise<ExtensionResponse>,
    timeout,
  ]);
  if (!response || response.requestId !== requestId) throw new Error("Invalid extension response");
  if (!response.ok) throw new Error(response.error);
  return response.data as T;
}

async function withBusy(button: HTMLButtonElement, action: () => Promise<void>): Promise<void> {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Working…";
  try {
    await action();
  } catch (error) {
    toast(safeMessage(error), true);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function toast(message: string, error = false): void {
  const item = document.createElement("div");
  item.className = "toast" + (error ? " error" : "");
  item.textContent = message;
  element<HTMLElement>("toastRegion").append(item);
  setTimeout(() => item.remove(), 4_500);
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 240) : "The operation failed safely";
}

function splitLines(value: string): string[] {
  return value.split("\n").map((line) => line.replace(/^\s*[-*+]\s*/, "").trim()).filter(Boolean);
}

function splitBlocks(value: string): string[] {
  return value.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
}

function labelize(value: string): string {
  return value.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function slug(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "context-pack";
}

function downloadBlob(content: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: type + ";charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function estimatePackSource(pack: ContextPack | undefined): number {
  if (!pack) return 0;
  return pack.evidence.reduce((sum, item) => sum + item.text.length, 0)
    + pack.artifacts.reduce((sum, item) => sum + item.value.length, 0)
    + pack.goal.length
    + ["facts", "constraints", "decisions", "completed", "nextActions", "blockers", "unresolved"].reduce((sum, key) => sum + (pack[key as keyof ContextPack] as string[]).join("\n").length, 0);
}

function applyTheme(theme: VaultSettings["theme"]): void {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

void sha256;
void updateSecurityBadge;
