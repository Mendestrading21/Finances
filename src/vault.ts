import type { FinanceData } from "./domain/types";
import { validateData } from "./domain/validation";

/** Only this encrypted envelope is persisted. Keys and clear text stay in memory. */
const STORAGE_KEY = "finance.vault.v1";
const ITERATIONS = 600_000;
const MAX_ITERATIONS = 1_000_000;
const MAX_FILE_BYTES = 25_000_000;
const MAX_PLAINTEXT_BYTES = Math.floor(((MAX_FILE_BYTES - 1_024) * 3) / 4) - 16;
const OPEN_ERROR =
  "Impossible d’ouvrir le coffre. Vérifiez la phrase secrète et la sauvegarde.";
const INVALID_ERROR = "Sauvegarde Finance invalide ou incompatible.";
const CONFLICT_ERROR =
  "Le coffre a changé dans un autre onglet. Verrouillez puis ouvrez-le à nouveau avant d’enregistrer.";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
// Produced only by `new Date().toISOString()`; kept strict so a tampered or foreign
// value cannot slip past parsing and influence the older-backup comparison below.
const SAVED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

type Envelope = {
  format: "Finance";
  version: 1;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  cipher: { name: "AES-GCM"; iv: string; tagLength: 128 };
  ciphertext: string;
  // Optional so an envelope written before this field existed still parses unchanged
  // (same authenticated bytes, see additionalData). Absent on either side means
  // "unknown age": importVault never blocks a restore it cannot date.
  savedAt?: string;
};
// `revision` counts data replacements coming from another device (see replaceVaultFromRemote).
type KeyState = {
  salt: string;
  iterations: number;
  expectedRaw: string;
  revision: number;
};
const keyStates = new WeakMap<CryptoKey, KeyState>();

function webCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error(
      "Le coffre exige un navigateur récent dans un contexte sécurisé (HTTPS ou localhost).",
    );
  }
  return globalThis.crypto;
}

function storage(): Storage {
  try {
    return globalThis.localStorage;
  } catch {
    throw new Error(
      "Le stockage de cet appareil est inaccessible. Vérifiez les réglages du navigateur.",
    );
  }
}

function readRaw(): string | null {
  try {
    const local = storage();
    if (!local) throw new Error("unavailable");
    return local.getItem(STORAGE_KEY);
  } catch {
    throw new Error(
      "Le stockage de cet appareil est inaccessible. Vérifiez les réglages du navigateur.",
    );
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

/** The envelope's required keys, plus the optional `savedAt` — never any other extra key. */
function envelopeKeysValid(value: Record<string, unknown>): boolean {
  const required = ["format", "version", "kdf", "cipher", "ciphertext"];
  const extra = Object.hasOwn(value, "savedAt") ? 1 : 0;
  return (
    Object.keys(value).length === required.length + extra &&
    required.every((key) => Object.hasOwn(value, key))
  );
}

function isSavedAt(value: unknown): value is string {
  return (
    typeof value === "string" &&
    SAVED_AT_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function toBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
  }
  return btoa(chunks.join(""));
}

function fromBase64(
  value: unknown,
  minBytes: number,
  maxBytes: number,
): Uint8Array<ArrayBuffer> {
  if (
    typeof value !== "string" ||
    value.length % 4 !== 0 ||
    value.length > 4 * Math.ceil(maxBytes / 3) ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    throw new Error(INVALID_ERROR);
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error(INVALID_ERROR);
  }
  if (
    binary.length < minBytes ||
    binary.length > maxBytes ||
    btoa(binary) !== value
  ) {
    throw new Error(INVALID_ERROR);
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function parseEnvelope(raw: string): Envelope {
  if (
    typeof raw !== "string" ||
    raw.length > MAX_FILE_BYTES ||
    encoder.encode(raw).byteLength > MAX_FILE_BYTES
  ) {
    throw new Error("Sauvegarde trop volumineuse (25 Mo maximum).");
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(INVALID_ERROR);
  }
  if (
    !record(value) ||
    !envelopeKeysValid(value) ||
    value.format !== "Finance" ||
    value.version !== 1 ||
    !record(value.kdf) ||
    !record(value.cipher) ||
    !exactKeys(value.kdf, ["name", "hash", "iterations", "salt"]) ||
    !exactKeys(value.cipher, ["name", "iv", "tagLength"]) ||
    value.kdf.name !== "PBKDF2" ||
    value.kdf.hash !== "SHA-256" ||
    !Number.isSafeInteger(value.kdf.iterations) ||
    typeof value.kdf.iterations !== "number" ||
    value.kdf.iterations < ITERATIONS ||
    value.kdf.iterations > MAX_ITERATIONS ||
    value.cipher.name !== "AES-GCM" ||
    value.cipher.tagLength !== 128 ||
    (value.savedAt !== undefined && !isSavedAt(value.savedAt))
  ) {
    throw new Error(INVALID_ERROR);
  }
  fromBase64(value.kdf.salt, 16, 16);
  fromBase64(value.cipher.iv, 12, 12);
  fromBase64(value.ciphertext, 17, MAX_PLAINTEXT_BYTES + 16);
  return value as Envelope;
}

/** Stable, authenticated metadata: property order in an imported JSON file is irrelevant. */
function additionalData(
  envelope: Omit<Envelope, "ciphertext">,
): Uint8Array<ArrayBuffer> {
  return encoder.encode(
    JSON.stringify([
      envelope.format,
      envelope.version,
      envelope.kdf.name,
      envelope.kdf.hash,
      envelope.kdf.iterations,
      envelope.kdf.salt,
      envelope.cipher.name,
      envelope.cipher.iv,
      envelope.cipher.tagLength,
      // Included only when present so an envelope sealed before this field existed
      // still authenticates with the exact same bytes it always did.
      ...(envelope.savedAt === undefined ? [] : [envelope.savedAt]),
    ]),
  );
}

async function deriveKey(
  passphrase: string,
  salt: string,
  iterations: number,
): Promise<CryptoKey> {
  if (
    typeof passphrase !== "string" ||
    !passphrase.length ||
    passphrase.length > 1_024
  ) {
    throw new Error(OPEN_ERROR);
  }
  const crypto = webCrypto();
  const passwordBytes = encoder.encode(passphrase);
  let material: CryptoKey;
  try {
    material = await crypto.subtle.importKey(
      "raw",
      passwordBytes,
      "PBKDF2",
      false,
      ["deriveKey"],
    );
  } finally {
    passwordBytes.fill(0);
  }
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: fromBase64(salt, 16, 16),
      iterations,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function seal(
  key: CryptoKey,
  state: Pick<KeyState, "salt" | "iterations">,
  data: FinanceData,
  savedAt = new Date().toISOString(),
): Promise<string> {
  const validated = validateData(data);
  const plaintext = encoder.encode(JSON.stringify(validated));
  if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) {
    plaintext.fill(0);
    throw new Error(
      "Le coffre est trop volumineux. Réduisez les pièces jointes avant d’enregistrer.",
    );
  }
  const crypto = webCrypto();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const metadata: Omit<Envelope, "ciphertext"> = {
    format: "Finance",
    version: 1,
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: state.iterations,
      salt: state.salt,
    },
    cipher: { name: "AES-GCM", iv: toBase64(iv), tagLength: 128 },
    // Authenticated, unencrypted save time. Not secret; lets a later restore warn
    // before silently replacing data saved more recently than the backup being applied.
    savedAt,
  };
  try {
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        tagLength: 128,
        additionalData: additionalData(metadata),
      },
      key,
      plaintext,
    );
    return JSON.stringify({
      ...metadata,
      ciphertext: toBase64(new Uint8Array(ciphertext)),
    } satisfies Envelope);
  } finally {
    plaintext.fill(0);
  }
}

async function decryptEnvelope(
  key: CryptoKey,
  envelope: Envelope,
): Promise<FinanceData> {
  const plaintext = new Uint8Array(
    await webCrypto().subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64(envelope.cipher.iv, 12, 12),
        tagLength: 128,
        additionalData: additionalData(envelope),
      },
      key,
      fromBase64(envelope.ciphertext, 17, MAX_PLAINTEXT_BYTES + 16),
    ),
  );
  try {
    return validateData(JSON.parse(decoder.decode(plaintext)));
  } finally {
    plaintext.fill(0);
  }
}

async function open(
  envelope: Envelope,
  passphrase: string,
): Promise<{ key: CryptoKey; data: FinanceData }> {
  // Failure of the passphrase, authentication tag, UTF-8 or data schema shares one message.
  try {
    const key = await deriveKey(
      passphrase,
      envelope.kdf.salt,
      envelope.kdf.iterations,
    );
    return { key, data: await decryptEnvelope(key, envelope) };
  } catch {
    throw new Error(OPEN_ERROR);
  }
}

async function openWithKey(
  key: CryptoKey,
  envelope: Envelope,
): Promise<FinanceData> {
  try {
    return await decryptEnvelope(key, envelope);
  } catch {
    throw new Error(OPEN_ERROR);
  }
}

/** `guard` and `written` run in the same synchronous block as the check and the write. */
async function commit(
  raw: string,
  expected: string | null,
  hooks: { guard?: () => void; written?: () => void } = {},
): Promise<void> {
  const write = () => {
    hooks.guard?.();
    if (readRaw() !== expected) throw new Error(CONFLICT_ERROR);
    try {
      // Web Storage setItem is atomic: on quota/security failure the previous value is retained.
      // Never remove the previous vault or write an unencrypted temporary copy.
      storage().setItem(STORAGE_KEY, raw);
    } catch {
      throw new Error(
        "Enregistrement impossible : espace disponible ou stockage inaccessible. Votre coffre précédent est conservé.",
      );
    }
    hooks.written?.();
  };
  // A shared exclusive lock makes the check-and-write indivisible across cooperating tabs.
  // Older browsers still get optimistic conflict detection; the limitation is documented.
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    let failure: unknown;
    await navigator.locks.request(
      "finance.vault.write",
      { mode: "exclusive" },
      () => {
        try {
          write();
        } catch (error) {
          failure = error;
        }
      },
    );
    // Propagate after releasing the lock, including runtimes that mishandle a thrown callback.
    if (failure !== undefined) throw failure;
  } else {
    write();
  }
}

export function vaultExists(): boolean {
  // Fail closed: inaccessible storage must never appear to be an empty vault.
  try {
    return readRaw() !== null;
  } catch {
    return true;
  }
}

export async function createVault(
  passphrase: string,
  data: FinanceData,
): Promise<CryptoKey> {
  if (
    typeof passphrase !== "string" ||
    Array.from(passphrase).length < 12 ||
    passphrase.length > 1_024
  ) {
    throw new Error(
      "Choisissez une phrase secrète de 12 caractères minimum (1 024 maximum).",
    );
  }
  if (readRaw() !== null)
    throw new Error(
      "Un coffre existe déjà sur cet appareil. Ouvrez-le ou restaurez une sauvegarde.",
    );
  const validated = validateData(data);
  const salt = toBase64(webCrypto().getRandomValues(new Uint8Array(16)));
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const raw = await seal(key, { salt, iterations: ITERATIONS }, validated);
  await commit(raw, null);
  keyStates.set(key, {
    salt,
    iterations: ITERATIONS,
    expectedRaw: raw,
    revision: 0,
  });
  return key;
}

export async function unlockVault(
  passphrase: string,
): Promise<{ key: CryptoKey; data: FinanceData }> {
  const raw = readRaw();
  if (raw === null)
    throw new Error("Aucun coffre enregistré sur cet appareil.");
  const envelope = parseEnvelope(raw);
  const result = await open(envelope, passphrase);
  if (readRaw() !== raw) throw new Error(CONFLICT_ERROR);
  keyStates.set(result.key, {
    salt: envelope.kdf.salt,
    iterations: envelope.kdf.iterations,
    expectedRaw: raw,
    revision: 0,
  });
  return result;
}

/** With `expectedRevision` (from vaultRevision), refuses to save over data pulled from another device since then. */
export async function saveVault(
  key: CryptoKey,
  data: FinanceData,
  expectedRevision?: number,
): Promise<void> {
  const state = keyStates.get(key);
  if (!state)
    throw new Error("Coffre verrouillé. Ouvrez-le avant d’enregistrer.");
  // Capture before encryption so concurrent saves from the same session cannot overwrite each other.
  const expectedRaw = state.expectedRaw;
  if (readRaw() !== expectedRaw) throw new Error(CONFLICT_ERROR);
  const raw = await seal(key, state, data);
  await commit(
    raw,
    expectedRaw,
    expectedRevision === undefined
      ? {}
      : {
          guard: () => {
            if (state.revision !== expectedRevision) {
              throw new VaultChangedError(
                "Vos données viennent d’être mises à jour depuis un autre appareil. Rien n’a été enregistré ; vérifiez, puis recommencez.",
              );
            }
          },
        },
  );
  state.expectedRaw = raw;
}

/** Number of times this open vault's data was replaced from another device. */
export function vaultRevision(key: CryptoKey): number {
  const state = keyStates.get(key);
  if (!state)
    throw new Error("Coffre verrouillé. Ouvrez-le avant de continuer.");
  return state.revision;
}

export function exportVault(): string {
  const raw = readRaw();
  if (raw === null) throw new Error("Aucun coffre à sauvegarder.");
  parseEnvelope(raw);
  return raw;
}

/** Restores an encrypted backup, replacing whatever vault is on this device.
 * Fully decrypted and validated before any write, so a wrong passphrase or a corrupted,
 * truncated or foreign file never touches the existing vault (see tests).
 * When a vault already exists here and both it and `raw` carry a `savedAt`, a backup
 * strictly older than the current vault is refused rather than silently discarded —
 * pass `allowOlder: true` (`allowOlder` as third argument) once the caller has
 * explicitly confirmed that replacing more recent data is intended. */
export async function importVault(
  raw: string,
  passphrase: string,
  allowOlder = false,
): Promise<{ key: CryptoKey; data: FinanceData }> {
  const previous = readRaw();
  const envelope = parseEnvelope(raw);
  const result = await open(envelope, passphrase);
  // A wrong passphrase always fails above, before this ever runs: dating a backup an
  // attacker cannot open leaks nothing. Only compare once both sides are authenticated.
  if (!allowOlder && previous !== null && envelope.savedAt !== undefined) {
    let currentSavedAt: string | undefined;
    try {
      // Envelope metadata only: never requires the current passphrase to date it.
      currentSavedAt = parseEnvelope(previous).savedAt;
    } catch {
      // The vault on this device cannot be read at all: dating it is impossible, and
      // blocking the one operation that could recover it would be actively harmful.
      currentSavedAt = undefined;
    }
    // Both timestamps come from `new Date().toISOString()`, so lexicographic order
    // matches chronological order; missing on either side means "unknown", never "older".
    if (currentSavedAt !== undefined && envelope.savedAt < currentSavedAt) {
      throw new Error(
        `Cette sauvegarde est plus ancienne (enregistrée le ${envelope.savedAt}) que le coffre déjà présent sur cet appareil (enregistré le ${currentSavedAt}). Elle n’a pas été restaurée pour ne pas remplacer des données plus récentes ; confirmez explicitement pour la restaurer quand même.`,
      );
    }
  }
  // Validate and decrypt completely before any write. An invalid import leaves the old vault intact.
  const normalized = JSON.stringify(envelope);
  await commit(normalized, previous);
  keyStates.set(result.key, {
    salt: envelope.kdf.salt,
    iterations: envelope.kdf.iterations,
    expectedRaw: normalized,
    revision: 0,
  });
  return result;
}

export type EnvelopeInfo = {
  savedAt?: string;
  salt: string;
  iterations: number;
};

/** Validated, unencrypted metadata of any Finance envelope. Never decrypts. */
export function envelopeInfo(raw: string): EnvelopeInfo {
  const envelope = parseEnvelope(raw);
  return {
    ...(envelope.savedAt === undefined ? {} : { savedAt: envelope.savedAt }),
    salt: envelope.kdf.salt,
    iterations: envelope.kdf.iterations,
  };
}

/** Metadata of the envelope stored on this device, or null when there is none. */
export function vaultEnvelopeInfo(): EnvelopeInfo | null {
  const raw = readRaw();
  return raw === null ? null : envelopeInfo(raw);
}

export class VaultKeyMismatchError extends Error {
  constructor() {
    super(
      "Le coffre distant est chiffré avec une autre clé (autre phrase secrète ou autre coffre). Rien n’a été modifié : verrouillez le coffre, puis rouvrez-le depuis GitHub avec sa phrase secrète. Exportez d’abord une sauvegarde chiffrée de ce coffre : l’ouvrir depuis GitHub le remplacera.",
    );
    this.name = "VaultKeyMismatchError";
  }
}

/** Retryable: the local vault changed after the snapshot a sync decided on; nothing was written. */
export class VaultChangedError extends Error {
  constructor(
    message = "Le coffre a été modifié pendant la synchronisation. Rien n’a été remplacé ; relancez la synchronisation.",
  ) {
    super(message);
    this.name = "VaultChangedError";
  }
}

/** Replaces the open vault with a same-key remote envelope, only if the local vault is still `expectedLocalRaw` when given. */
export async function replaceVaultFromRemote(
  key: CryptoKey,
  raw: string,
  expectedLocalRaw?: string,
): Promise<FinanceData> {
  const state = keyStates.get(key);
  if (!state)
    throw new Error("Coffre verrouillé. Ouvrez-le avant de synchroniser.");
  const expectedRaw = expectedLocalRaw ?? state.expectedRaw;
  if (expectedLocalRaw !== undefined) {
    if (readRaw() !== expectedLocalRaw) throw new VaultChangedError();
    if (state.expectedRaw !== expectedLocalRaw) throw new Error(CONFLICT_ERROR);
  }
  const envelope = parseEnvelope(raw);
  if (
    envelope.kdf.salt !== state.salt ||
    envelope.kdf.iterations !== state.iterations
  ) {
    throw new VaultKeyMismatchError();
  }
  const data = await openWithKey(key, envelope);
  const normalized = JSON.stringify(envelope);
  try {
    await commit(normalized, expectedRaw, {
      written: () => {
        state.expectedRaw = normalized;
        state.revision += 1;
      },
    });
  } catch (error) {
    // A save committed during decryption wins; report it as retryable rather than as another tab.
    if (
      expectedLocalRaw !== undefined &&
      error instanceof Error &&
      error.message === CONFLICT_ERROR
    ) {
      throw new VaultChangedError();
    }
    throw error;
  }
  return data;
}

const MAX_CLOCK_AHEAD_MS = 10 * 60_000;

/** Re-encrypts the unchanged open vault with a fresh savedAt, only if it is still exactly `expectedLocalRaw`. */
export async function resealVault(
  key: CryptoKey,
  expectedLocalRaw: string,
  notBefore?: string,
): Promise<string> {
  const state = keyStates.get(key);
  if (!state)
    throw new Error("Coffre verrouillé. Ouvrez-le avant de synchroniser.");
  if (readRaw() !== expectedLocalRaw) throw new VaultChangedError();
  if (state.expectedRaw !== expectedLocalRaw) throw new Error(CONFLICT_ERROR);
  const data = await openWithKey(key, parseEnvelope(expectedLocalRaw));
  // Never earlier than a remote version this one supersedes, so a device whose clock is slightly behind still wins; capped against absurd remote dates.
  const now = Date.now();
  const floor = isSavedAt(notBefore) ? Date.parse(notBefore) + 1 : now;
  const savedAt = new Date(
    floor > now && floor <= now + MAX_CLOCK_AHEAD_MS ? floor : now,
  ).toISOString();
  const raw = await seal(key, state, data, savedAt);
  try {
    await commit(raw, expectedLocalRaw);
  } catch (error) {
    if (error instanceof Error && error.message === CONFLICT_ERROR) {
      throw new VaultChangedError();
    }
    throw error;
  }
  state.expectedRaw = raw;
  return raw;
}

// Domain separation: a sealed secret can never authenticate as a vault envelope, nor the reverse.
const SECRET_AAD = encoder.encode("Finance/secret/v1");
const MAX_SECRET_BYTES = 4_096;
const LOCKED_SECRET_ERROR = "Coffre verrouillé. Ouvrez-le avant de continuer.";

/** Encrypts a small secret (e.g. an access token) at rest with the open vault key. */
export async function sealSecret(
  key: CryptoKey,
  text: string,
): Promise<{ iv: string; ct: string }> {
  if (!keyStates.has(key)) throw new Error(LOCKED_SECRET_ERROR);
  if (typeof text !== "string" || !text.length) throw new Error("Secret vide.");
  const bytes = encoder.encode(text);
  try {
    if (bytes.byteLength > MAX_SECRET_BYTES)
      throw new Error("Secret trop long.");
    const crypto = webCrypto();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, tagLength: 128, additionalData: SECRET_AAD },
      key,
      bytes,
    );
    return { iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
  } finally {
    bytes.fill(0);
  }
}

/** Decrypts a secret sealed by sealSecret with this same vault key; one generic error otherwise. */
export async function openSecret(
  key: CryptoKey,
  sealed: { iv: string; ct: string },
): Promise<string> {
  if (!keyStates.has(key)) throw new Error(LOCKED_SECRET_ERROR);
  try {
    if (!record(sealed) || !exactKeys(sealed, ["iv", "ct"]))
      throw new Error(INVALID_ERROR);
    const plaintext = new Uint8Array(
      await webCrypto().subtle.decrypt(
        {
          name: "AES-GCM",
          iv: fromBase64(sealed.iv, 12, 12),
          tagLength: 128,
          additionalData: SECRET_AAD,
        },
        key,
        fromBase64(sealed.ct, 17, MAX_SECRET_BYTES + 16),
      ),
    );
    try {
      return decoder.decode(plaintext);
    } finally {
      plaintext.fill(0);
    }
  } catch {
    throw new Error("Secret illisible avec ce coffre.");
  }
}

/** Whether `iterations` is a PBKDF2 iteration count this vault format accepts (same bounds as an envelope). */
export function vaultIterationsAllowed(
  iterations: unknown,
): iterations is number {
  return (
    typeof iterations === "number" &&
    Number.isSafeInteger(iterations) &&
    iterations >= ITERATIONS &&
    iterations <= MAX_ITERATIONS
  );
}

/** Derives the key a vault with this salt and iteration count would use. The key is not an
 * open vault: it cannot save, seal secrets or replace anything (see openVaultKeyInfo). */
export async function deriveVaultKey(
  passphrase: string,
  salt: string,
  iterations: number,
): Promise<CryptoKey> {
  if (!vaultIterationsAllowed(iterations)) throw new Error(INVALID_ERROR);
  return deriveKey(passphrase, salt, iterations);
}

/** Public KDF parameters of an open vault key; never the key or the passphrase. */
export function openVaultKeyInfo(key: CryptoKey): {
  salt: string;
  iterations: number;
} {
  const state = keyStates.get(key);
  if (!state) throw new Error("Coffre verrouillé.");
  return { salt: state.salt, iterations: state.iterations };
}

/** True for the single, deliberately vague error of a passphrase that does not open the vault. */
export function isVaultOpenError(error: unknown): boolean {
  return error instanceof Error && error.message === OPEN_ERROR;
}
