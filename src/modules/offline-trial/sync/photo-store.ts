/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Bildefilene på enheten, i IndexedDB-databasen `offline-trial-photos` (rått API, ingen
 * avhengighet). Lageret `photos` har filene; nøkkelen er `photo.id`. Filen slettes bare når
 * serveren har bekreftet fingeravtrykket (oppgavekortet pkt. 22). Da legges samtidig en merknad i
 * lageret `confirmed`, så enheten vet at bildet er på serveren uten å skrive `uploaded_at` selv
 * (bare serveren setter den; resultatfilen, småfunn 6).
 *
 * Visningskopien (prøve D) ligger i det samme lageret `photos` under `displayCopyKey(photoId)`.
 * Den er aldri en rad og skrives aldri i `confirmed`; originalene finnes alltid fra radene i
 * synklageret, aldri ved å liste nøklene her.
 *
 * Endelig feilet visningskopi (beslutning A11): får kopien 400 eller 404, slettes den, og det
 * legges en merknad i `confirmed` under `display-failed:<uuid>` med verdien `"400"` eller `"404"`.
 * Merknaden er aldri et bekreftet bilde (`isConfirmedPhotoKey`), og den tømmes av
 * `clearLocalPhotos` sammen med resten. Ingen ny databaseversjon.
 */

export const TRIAL_PHOTO_DB_NAME = "offline-trial-photos";
const PHOTO_STORE = "photos";
const DISPLAY_COPY_SUFFIX = ":display";
const CONFIRMED_STORE = "confirmed";
const DISPLAY_FAILED_PREFIX = "display-failed:";
type PhotoStoreName = typeof PHOTO_STORE | typeof CONFIRMED_STORE;

let opening: Promise<IDBDatabase> | null = null;

function openPhotoDb(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(TRIAL_PHOTO_DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PHOTO_STORE)) db.createObjectStore(PHOTO_STORE);
      if (!db.objectStoreNames.contains(CONFIRMED_STORE)) db.createObjectStore(CONFIRMED_STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      // En annen fane med nyere versjon skal ikke bli blokkert.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    // En åpen fane med den gamle versjonen sperrer oppgraderingen; gi beskjed i stedet for å henge.
    request.onblocked = () => {
      opening = null;
      reject(new Error("Lukk andre faner med appen, og prøv igjen."));
    };
    request.onerror = () => {
      opening = null;
      reject(request.error ?? new Error("Kunne ikke åpne lageret for bilder."));
    };
  });
  return opening;
}

async function run<T>(
  stores: readonly PhotoStoreName[],
  mode: IDBTransactionMode,
  action: (tx: IDBTransaction) => IDBRequest<T>,
): Promise<T> {
  const db = await openPhotoDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction([...stores], mode);
    const request = action(transaction);
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error ?? request.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Lagring av bilde avbrutt."));
  });
}

/** Nøkkelen til visningskopien av et bilde i lageret `photos`. */
export function displayCopyKey(photoId: string): string {
  return `${photoId}${DISPLAY_COPY_SUFFIX}`;
}

/** Grunnen til at visningskopien er endelig feilet. Bare en fast kode, aldri svartekst. */
export type DisplayCopyFailure = "400" | "404";

/** Nøkkelen til merknaden om endelig feilet visningskopi i lageret `confirmed`. */
export function displayFailedKey(photoId: string): string {
  return `${DISPLAY_FAILED_PREFIX}${photoId}`;
}

/** Er nøkkelen i `confirmed` et bekreftet bilde? Merknader om feilet kopi er det aldri. */
export function isConfirmedPhotoKey(key: IDBValidKey): key is string {
  return typeof key === "string" && !key.startsWith(DISPLAY_FAILED_PREFIX);
}

const displayFailedListeners = new Set<() => void>();

/** Varsel når merknadene om feilet kopi endres (siden viser «Bare originalen er lagret»). */
export function onDisplayFailedChange(listener: () => void): () => void {
  displayFailedListeners.add(listener);
  return () => {
    displayFailedListeners.delete(listener);
  };
}

function notifyDisplayFailed(): void {
  for (const listener of displayFailedListeners) listener();
}

export async function putLocalPhoto(id: string, file: Blob): Promise<void> {
  await run([PHOTO_STORE], "readwrite", (tx) => tx.objectStore(PHOTO_STORE).put(file, id));
}

export async function getLocalPhoto(id: string): Promise<Blob | undefined> {
  const value = await run<unknown>([PHOTO_STORE], "readonly", (tx) =>
    tx.objectStore(PHOTO_STORE).get(id),
  );
  return value instanceof Blob ? value : undefined;
}

/** Sletter én fil i lageret `photos` (brukes for visningskopien). Rører aldri `confirmed`. */
export async function deleteLocalPhoto(key: string): Promise<void> {
  await run([PHOTO_STORE], "readwrite", (tx) => tx.objectStore(PHOTO_STORE).delete(key));
}

/** Photo-id-ene til visningskopiene som ligger på enheten. */
export async function listLocalDisplayCopyIds(): Promise<string[]> {
  const keys = await run([PHOTO_STORE], "readonly", (tx) =>
    tx.objectStore(PHOTO_STORE).getAllKeys(),
  );
  return keys
    .filter((key): key is string => typeof key === "string" && key.endsWith(DISPLAY_COPY_SUFFIX))
    .map((key) => key.slice(0, -DISPLAY_COPY_SUFFIX.length));
}

/**
 * Serveren har bekreftet filen: sletter filen og legger merknaden i samme transaksjon. Rører aldri
 * `trial_photos`-raden; `uploaded_at` og `sha256` kommer fra serveren med synken.
 */
export async function confirmLocalPhoto(id: string, sha256: string): Promise<void> {
  await run([PHOTO_STORE, CONFIRMED_STORE], "readwrite", (tx) => {
    tx.objectStore(PHOTO_STORE).delete(id);
    return tx
      .objectStore(CONFIRMED_STORE)
      .put({ sha256, confirmedAt: new Date().toISOString() }, id);
  });
}

/** Id-ene til bilder serveren har bekreftet fra denne enheten. */
export async function listConfirmedPhotoIds(): Promise<Set<string>> {
  const keys = await run([CONFIRMED_STORE], "readonly", (tx) =>
    tx.objectStore(CONFIRMED_STORE).getAllKeys(),
  );
  return new Set(keys.filter(isConfirmedPhotoKey));
}

/**
 * Visningskopien er endelig feilet: sletter kopien og legger merknaden i samme transaksjon.
 * Merknaden har bare bilde-id (i nøkkelen) og en fast kode. Rører aldri originalen.
 */
export async function markDisplayCopyFailed(
  photoId: string,
  reason: DisplayCopyFailure,
): Promise<void> {
  await run([PHOTO_STORE, CONFIRMED_STORE], "readwrite", (tx) => {
    tx.objectStore(PHOTO_STORE).delete(displayCopyKey(photoId));
    return tx.objectStore(CONFIRMED_STORE).put(reason, displayFailedKey(photoId));
  });
  notifyDisplayFailed();
}

/** Har bildet en merknad om endelig feilet visningskopi? */
export async function hasDisplayCopyFailed(photoId: string): Promise<boolean> {
  const value = await run<unknown>([CONFIRMED_STORE], "readonly", (tx) =>
    tx.objectStore(CONFIRMED_STORE).get(displayFailedKey(photoId)),
  );
  return value !== undefined;
}

/** Id-ene til bildene der visningskopien er endelig feilet. */
export async function listDisplayFailedPhotoIds(): Promise<Set<string>> {
  const keys = await run([CONFIRMED_STORE], "readonly", (tx) =>
    tx.objectStore(CONFIRMED_STORE).getAllKeys(),
  );
  return new Set(
    keys
      .filter(
        (key): key is string => typeof key === "string" && key.startsWith(DISPLAY_FAILED_PREFIX),
      )
      .map((key) => key.slice(DISPLAY_FAILED_PREFIX.length)),
  );
}

/**
 * Tømmer lageret, også visningskopiene og merknadene om feilet kopi (ved bytte av organisasjon
 * på samme enhet).
 */
export async function clearLocalPhotos(): Promise<void> {
  await run([PHOTO_STORE, CONFIRMED_STORE], "readwrite", (tx) => {
    tx.objectStore(CONFIRMED_STORE).clear();
    return tx.objectStore(PHOTO_STORE).clear();
  });
  notifyDisplayFailed();
}
