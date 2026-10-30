/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Lagringsstatus på iPaden (prøve C, docs/funksjoner/fase1-prove-c-lagring.md pkt. 1): hvor mye
 * plass appen bruker og får, om lagringen er varig, og tekstene når plassen er lav eller lagring
 * feiler. Bare rene funksjoner uten React, og ingen kandidat. `navigator` leses inne i
 * funksjonene, aldri når filen importeres, så Vitest kan bytte den ut.
 */

/**
 * Grensen for «lite plass»: under 500 MB ledig. En befaring har 100–300 bilder (sidemannskontrollen
 * del 1 T1), ca. 1,5–2 MB per bilde, altså opptil ca. 600 MB. Med 500 MB igjen rekker takstmannen
 * å synke før det blir fullt. Avgjort av agentene (A1); endres bare her.
 */
export const LOW_STORAGE_FREE_BYTES = 500 * 1024 * 1024;

export const LOW_STORAGE_WARNING_TEXT =
  "Lite plass igjen på iPaden. Synk med nett så snart du kan.";

export type StorageLevel = "ok" | "low" | "unknown";
export type PersistedState = "yes" | "no" | "unsupported";

export interface StorageEstimateNumbers {
  usage?: number;
  quota?: number;
}

export interface StorageHealth extends StorageEstimateNumbers {
  level: StorageLevel;
  persisted: PersistedState;
}

export interface StorageFailure {
  kind: "answer" | "photo";
  fieldLabel: string;
  error: unknown;
}

/** Det minste av `StorageManager` som brukes. Alt er valgfritt; Safari og eldre nettlesere mangler deler. */
interface StorageManagerLike {
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}

function storageManager(): StorageManagerLike | undefined {
  try {
    if (typeof navigator === "undefined" || navigator === null) return undefined;
    const storage = (navigator as { storage?: StorageManagerLike }).storage;
    return storage ?? undefined;
  } catch {
    return undefined;
  }
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** `low` når ledig plass er under grensen, `ok` på og over, `unknown` uten tall eller med kvote 0. */
export function storageLevel({ usage, quota }: StorageEstimateNumbers): StorageLevel {
  if (!isNumber(usage) || !isNumber(quota) || quota === 0) return "unknown";
  return quota - usage < LOW_STORAGE_FREE_BYTES ? "low" : "ok";
}

async function readPersisted(storage: StorageManagerLike | undefined): Promise<PersistedState> {
  if (!storage || typeof storage.persisted !== "function") return "unsupported";
  try {
    return (await storage.persisted()) ? "yes" : "no";
  } catch {
    return "unsupported";
  }
}

async function readEstimate(
  storage: StorageManagerLike | undefined,
): Promise<StorageEstimateNumbers> {
  if (!storage || typeof storage.estimate !== "function") return {};
  try {
    const estimate = await storage.estimate();
    const out: StorageEstimateNumbers = {};
    if (isNumber(estimate?.usage)) out.usage = estimate.usage;
    if (isNumber(estimate?.quota)) out.quota = estimate.quota;
    return out;
  } catch {
    return {};
  }
}

/**
 * Leser plassen og om lagringen er varig. Kaster aldri. `estimateOverride` brukes bare av
 * testkroken (`storage-test-hook.ts`) og erstatter `estimate()`; `persisted()` er alltid ekte.
 */
export async function readStorageHealth(
  estimateOverride?: StorageEstimateNumbers,
): Promise<StorageHealth> {
  const storage = storageManager();
  const [numbers, persisted] = await Promise.all([
    estimateOverride ? Promise.resolve({ ...estimateOverride }) : readEstimate(storage),
    readPersisted(storage),
  ]);
  const health: StorageHealth = { level: storageLevel(numbers), persisted };
  if (isNumber(numbers.usage)) health.usage = numbers.usage;
  if (isNumber(numbers.quota)) health.quota = numbers.quota;
  return health;
}

let persistRequest: Promise<PersistedState> | null = null;

async function askForPersistence(): Promise<PersistedState> {
  const storage = storageManager();
  if (!storage || typeof storage.persist !== "function") return "unsupported";
  const already = await readPersisted(storage);
  if (already === "yes") return "yes";
  try {
    return (await storage.persist()) ? "yes" : "no";
  } catch {
    return "no";
  }
}

/**
 * Ber nettleseren om varig lagring, bare når den ikke er varig fra før. Ett `persist()` per
 * sideinnlasting: alle kall får det samme løftet. Avvist `persist()` gir `no`. Kaster aldri.
 */
export function requestPersistentStorage(): Promise<PersistedState> {
  persistRequest ??= askForPersistence().catch(() => "unsupported" as const);
  return persistRequest;
}

/** Bare for tester: neste `requestPersistentStorage()` spør på nytt. */
export function resetPersistRequestForTests(): void {
  persistRequest = null;
}

const MB = 1024 * 1024;

function formatMb(bytes: number): string {
  return `${Math.round(bytes / MB)} MB`;
}

const PERSISTED_TEXT: Record<PersistedState, string> = {
  yes: "ja",
  no: "nei",
  unsupported: "ikke støttet",
};

/** Teksten i boksen på listen: brukt plass, plassen appen får, og varig lagring. */
export function storageHealthText(health: StorageHealth): string {
  const persisted = PERSISTED_TEXT[health.persisted] ?? PERSISTED_TEXT.unsupported;
  const space =
    isNumber(health.usage) && isNumber(health.quota)
      ? `Brukt: ${formatMb(health.usage)} av ${formatMb(health.quota)} som appen får.`
      : "Plassen kan ikke måles i denne nettleseren.";
  return `${space} Varig lagring: ${persisted}.`;
}

/** Full plass, slik Safari, Chrome og Firefox melder det. */
export function isQuotaError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const name = (error as { name?: unknown }).name;
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED";
}

/** Feltnavnene uten dubletter, i rekkefølgen de sist feilet. */
function distinctLabels(failures: readonly StorageFailure[]): string[] {
  const labels: string[] = [];
  for (const failure of failures) {
    const index = labels.indexOf(failure.fieldLabel);
    if (index !== -1) labels.splice(index, 1);
    labels.push(failure.fieldLabel);
  }
  return labels;
}

function answerText(labels: string[]): string {
  const where =
    labels.length === 1
      ? `Svaret i «${labels[0]}» ble ikke lagret på iPaden.`
      : `${labels.length} svar ble ikke lagret på iPaden, sist «${labels[labels.length - 1]}».`;
  return `${where} Lukk ikke appen. Trykk «Prøv igjen».`;
}

function photoText(photos: readonly StorageFailure[]): string {
  if (photos.length === 1) {
    return `Bildet i «${photos[0]!.fieldLabel}» ble ikke lagret på iPaden. Ta bildet på nytt.`;
  }
  const last = photos[photos.length - 1]!.fieldLabel;
  return `${photos.length} bilder ble ikke lagret på iPaden, sist i «${last}». Ta bildene på nytt.`;
}

/**
 * Den ene meldingen når lagring på iPaden feiler. Samme svarfelt telles én gang; hvert bilde
 * telles. Har aldri svarverdien eller bildet, bare feltnavnet.
 */
export function storageErrorMessage(failures: readonly StorageFailure[]): string {
  const answers = failures.filter((failure) => failure.kind === "answer");
  const photos = failures.filter((failure) => failure.kind === "photo");
  const parts: string[] = [];
  if (answers.length > 0) parts.push(answerText(distinctLabels(answers)));
  if (photos.length > 0) parts.push(photoText(photos));
  if (failures.some((failure) => isQuotaError(failure.error))) {
    parts.push("Plassen på iPaden er brukt opp.");
  }
  return parts.join(" ");
}

const UNKNOWN_ERROR = "ukjent feil";

/**
 * Det som kan stå i loggen om en lagringsfeil: bare feilnavnet. Meldingen tas ikke med, fordi
 * lagringen kan legge svaret eller filnavnet inn i den.
 */
export function storageErrorLog(error: unknown): { name: string } {
  if (!(error instanceof Error)) return { name: UNKNOWN_ERROR };
  return { name: typeof error.name === "string" && error.name !== "" ? error.name : UNKNOWN_ERROR };
}
