import type { FinanceData } from "./domain/types";
import { isVaultOpenError, unlockVault, vaultExists } from "./vault";

/**
 * Déverrouillage rapide (Face ID, Touch ID, empreinte, Windows Hello) par WebAuthn + extension PRF.
 *
 * Aucun serveur : l'authentificateur de la plateforme, après vérification de l'utilisateur, rend
 * une sortie PRF propre à ce passkey et à `prfSalt`. HKDF en tire une clé AES-GCM qui chiffre la
 * phrase secrète au repos sur CET appareil. Seul ce chiffré est stocké : jamais la phrase, la
 * sortie PRF ni une clé. Le déverrouillage redonne la phrase à `unlockVault`, qui reste l'unique
 * juge : aucune donnée du coffre ne dépend de ce module.
 */
const STORAGE_KEY = "finance.quick-unlock.v1";
const INFO = "Finance/quick-unlock/v1";
const TIMEOUT_MS = 60_000;
const PRF_BYTES = 32;
const SALT_BYTES = 32;
const MAX_CREDENTIAL_ID_BYTES = 1_023;
// A vault passphrase has at most 1 024 UTF-16 code units (see vault.ts): at most 3 072 UTF-8 bytes.
const MAX_PASSPHRASE_BYTES = 3_072;
const CREATED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const UNSUPPORTED_ERROR =
  "Face ID ou l'empreinte ne peuvent pas protéger Finance sur cet appareil (fonction non prise en charge). Continuez avec la phrase secrète.";
const UNLOCK_CANCELLED_ERROR = "Déverrouillage annulé.";
const ENABLE_CANCELLED_ERROR = "Activation annulée.";
const ENABLE_INTERRUPTED_ERROR =
  "Activation presque terminée : touchez à nouveau le bouton d’activation et confirmez avec Face ID ou l’empreinte.";
const CHANGED_ERROR =
  "La phrase secrète a changé : déverrouillez avec la phrase, puis réactivez Face ID dans les réglages.";
const NOT_ENABLED_ERROR =
  "Face ID n’est pas activé sur cet appareil. Déverrouillez avec la phrase secrète.";
const UNREADABLE_ERROR =
  "Le réglage Face ID de cet appareil était illisible ; il a été désactivé. Déverrouillez avec la phrase secrète, puis réactivez-le dans les réglages.";
const FAILED_ERROR =
  "Face ID n’a pas pu ouvrir Finance sur cet appareil. Déverrouillez avec la phrase secrète.";
const NO_VAULT_ERROR = "Aucun coffre enregistré sur cet appareil.";
const STORAGE_ERROR =
  "Le stockage de cet appareil est inaccessible. Vérifiez les réglages du navigateur.";
const SAVE_ERROR =
  "Face ID n’a pas été activé : espace disponible ou stockage inaccessible. Continuez avec la phrase secrète.";
const DISABLE_ERROR =
  "Désactivation impossible : le stockage de cet appareil est inaccessible.";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

type StoredQuickUnlock = {
  version: 1;
  credentialId: string;
  prfSalt: string;
  iv: string;
  ct: string;
  createdAt: string;
};
type ParsedQuickUnlock = {
  stored: StoredQuickUnlock;
  credentialId: Uint8Array<ArrayBuffer>;
  prfSalt: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  ct: Uint8Array<ArrayBuffer>;
};
type PrfCredential = {
  rawId: ArrayBuffer;
  getClientExtensionResults(): AuthenticationExtensionsClientOutputs;
};
/** Signal API (WebAuthn niveau 3) : absente des types DOM de TypeScript 5.9, et de nombreux navigateurs. */
type SignalingPublicKeyCredential = {
  signalUnknownCredential?: (options: {
    rpId: string;
    credentialId: string;
  }) => Promise<void>;
};

/** Passkey created but whose PRF output still has to be read (second prompt interrupted). Memory only. */
let pending: {
  rp: string;
  credentialId: Uint8Array<ArrayBuffer>;
  prfSalt: Uint8Array<ArrayBuffer>;
} | null = null;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Canonical standard base64 only; null otherwise. */
function fromBase64(
  value: unknown,
  minBytes: number,
  maxBytes: number,
): Uint8Array<ArrayBuffer> | null {
  if (
    typeof value !== "string" ||
    value.length % 4 !== 0 ||
    value.length > 4 * Math.ceil(maxBytes / 3) ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    return null;
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    return null;
  }
  if (
    binary.length < minBytes ||
    binary.length > maxBytes ||
    btoa(binary) !== value
  ) {
    return null;
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** Canonical unpadded base64url only; null otherwise. */
function fromBase64Url(
  value: unknown,
  minBytes: number,
  maxBytes: number,
): Uint8Array<ArrayBuffer> | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = fromBase64(
    standard + "=".repeat((4 - (standard.length % 4)) % 4),
    minBytes,
    maxBytes,
  );
  return bytes !== null && toBase64Url(bytes) === value ? bytes : null;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

function webCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) throw new Error(UNSUPPORTED_ERROR);
  return globalThis.crypto;
}

function random(length: number): Uint8Array<ArrayBuffer> {
  return webCrypto().getRandomValues(new Uint8Array(length));
}

function storage(): Storage {
  try {
    const local = globalThis.localStorage;
    if (!local) throw new Error("unavailable");
    return local;
  } catch {
    throw new Error(STORAGE_ERROR);
  }
}

function readStored(): string | null {
  try {
    return storage().getItem(STORAGE_KEY);
  } catch {
    throw new Error(STORAGE_ERROR);
  }
}

function parseStored(raw: string): ParsedQuickUnlock | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !record(value) ||
    !exactKeys(value, [
      "version",
      "credentialId",
      "prfSalt",
      "iv",
      "ct",
      "createdAt",
    ]) ||
    value.version !== 1 ||
    typeof value.credentialId !== "string" ||
    typeof value.createdAt !== "string" ||
    !CREATED_AT_PATTERN.test(value.createdAt) ||
    !Number.isFinite(Date.parse(value.createdAt))
  ) {
    return null;
  }
  const credentialId = fromBase64Url(
    value.credentialId,
    1,
    MAX_CREDENTIAL_ID_BYTES,
  );
  const prfSalt = fromBase64(value.prfSalt, SALT_BYTES, SALT_BYTES);
  const iv = fromBase64(value.iv, 12, 12);
  const ct = fromBase64(value.ct, 17, MAX_PASSPHRASE_BYTES + 16);
  if (!credentialId || !prfSalt || !iv || !ct) return null;
  return {
    stored: {
      version: 1,
      credentialId: value.credentialId,
      prfSalt: value.prfSalt as string,
      iv: value.iv as string,
      ct: value.ct as string,
      createdAt: value.createdAt,
    },
    credentialId,
    prfSalt,
    iv,
    ct,
  };
}

function credentialsApi(): CredentialsContainer | null {
  try {
    const container = globalThis.navigator?.credentials;
    return container &&
      typeof container.create === "function" &&
      typeof container.get === "function"
      ? container
      : null;
  } catch {
    return null;
  }
}

function relyingPartyId(): string | null {
  try {
    const host = globalThis.location?.hostname;
    return typeof host === "string" && host !== "" ? host : null;
  } catch {
    return null;
  }
}

function cancelled(error: unknown): boolean {
  return (
    record(error) &&
    (error.name === "NotAllowedError" || error.name === "AbortError")
  );
}

function asPrfCredential(value: unknown): PrfCredential | null {
  return record(value) &&
    value.rawId instanceof ArrayBuffer &&
    typeof value.getClientExtensionResults === "function"
    ? (value as unknown as PrfCredential)
    : null;
}

function extensionResults(
  credential: PrfCredential,
): AuthenticationExtensionsClientOutputs | null {
  try {
    const results = credential.getClientExtensionResults();
    return record(results) ? results : null;
  } catch {
    return null;
  }
}

/** Copies the PRF output, then wipes the browser's buffer; null unless exactly 32 bytes. */
function takePrfOutput(
  results: AuthenticationExtensionsClientOutputs | null,
): Uint8Array<ArrayBuffer> | null {
  const first = results?.prf?.results?.first;
  let view: Uint8Array | null = null;
  if (first instanceof ArrayBuffer) view = new Uint8Array(first);
  else if (ArrayBuffer.isView(first)) {
    view = new Uint8Array(first.buffer, first.byteOffset, first.byteLength);
  }
  if (view === null) return null;
  const copy = new Uint8Array(view);
  try {
    view.fill(0);
  } catch {
    // A read-only buffer cannot be wiped; the copy is still wiped after use.
  }
  if (copy.length !== PRF_BYTES) {
    copy.fill(0);
    return null;
  }
  return copy;
}

/** Best effort: asks the password manager to drop a passkey Finance no longer uses. Never throws. */
function forgetCredential(credentialId: string): void {
  try {
    const rp = relyingPartyId();
    const api = globalThis.PublicKeyCredential as unknown as
      | SignalingPublicKeyCredential
      | undefined;
    const signal = api?.signalUnknownCredential;
    if (!rp || typeof signal !== "function") return;
    void Promise.resolve(signal.call(api, { rpId: rp, credentialId })).catch(
      () => undefined,
    );
  } catch {
    // Optional cleanup only.
  }
}

/** Removes the stored setting only if it is still `expected` (another tab may have re-enabled meanwhile). */
function removeIfUnchanged(expected: string): void {
  try {
    const local = storage();
    if (local.getItem(STORAGE_KEY) === expected) local.removeItem(STORAGE_KEY);
  } catch {
    // The error shown to the person already says what to do; nothing else to clean.
  }
}

async function wrappingKey(
  prfOutput: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const subtle = webCrypto().subtle;
  const material = await subtle.importKey("raw", prfOutput, "HKDF", false, [
    "deriveKey",
  ]);
  return subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: encoder.encode(INFO),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function additionalData(credentialId: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`${INFO}|${credentialId}`);
}

/**
 * Asks the authenticator for the PRF output of `credentialId` on `prfSalt`, with user verification.
 * Must stay free of any `await` before `get`, so the browser still sees the person's tap.
 */
async function evaluatePrf(
  container: CredentialsContainer,
  rp: string,
  credentialId: Uint8Array<ArrayBuffer>,
  prfSalt: Uint8Array<ArrayBuffer>,
  cancelMessage: string,
): Promise<Uint8Array<ArrayBuffer>> {
  let answer: unknown;
  try {
    answer = await container.get({
      publicKey: {
        challenge: random(32),
        rpId: rp,
        allowCredentials: [{ type: "public-key", id: credentialId }],
        userVerification: "required",
        timeout: TIMEOUT_MS,
        extensions: { prf: { eval: { first: prfSalt } } },
      },
    });
  } catch (error) {
    throw new Error(cancelled(error) ? cancelMessage : FAILED_ERROR);
  }
  const credential = asPrfCredential(answer);
  if (
    !credential ||
    !sameBytes(new Uint8Array(credential.rawId), credentialId)
  ) {
    throw new Error(FAILED_ERROR);
  }
  const output = takePrfOutput(extensionResults(credential));
  if (output === null) throw new Error(UNSUPPORTED_ERROR);
  return output;
}

/** Never throws: false whenever anything needed is missing or uncertain. */
export async function quickUnlockSupported(): Promise<boolean> {
  try {
    const api = globalThis.PublicKeyCredential;
    if (
      !api ||
      !credentialsApi() ||
      !relyingPartyId() ||
      !globalThis.crypto?.subtle
    ) {
      return false;
    }
    if (
      typeof api.isUserVerifyingPlatformAuthenticatorAvailable !== "function" ||
      (await api.isUserVerifyingPlatformAuthenticatorAvailable()) !== true
    ) {
      return false;
    }
    if (typeof api.getClientCapabilities === "function") {
      const capabilities: unknown = await api.getClientCapabilities();
      if (record(capabilities) && capabilities["extension:prf"] === false) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** A valid setting is stored on this device (says nothing about the authenticator itself). */
export function quickUnlockEnabled(): boolean {
  try {
    const raw = readStored();
    return raw !== null && parseStored(raw) !== null;
  } catch {
    return false;
  }
}

/** Rethrows the vault's own error when the passphrase did not open this device's vault. */
async function passphraseRefused(
  check: Promise<{ error: unknown } | undefined>,
): Promise<void> {
  const failure = await check;
  if (failure) throw failure.error;
}

/** Checks the passphrase against this device's vault, registers a passkey with PRF, then stores
 * only the passphrase encrypted under the PRF-derived key. Nothing is stored on any failure. */
export async function enableQuickUnlock(passphrase: string): Promise<void> {
  // Everything before `create` is synchronous, so the browser still sees the person's tap.
  if (!vaultExists()) throw new Error(NO_VAULT_ERROR);
  const container = credentialsApi();
  const rp = relyingPartyId();
  if (!container || !rp) throw new Error(UNSUPPORTED_ERROR);
  // 1. The passphrase must open this device's vault (the vault's own error otherwise). The check
  // (PBKDF2, up to a second on a phone) runs during the prompt: awaiting it first could let Safari
  // treat the tap as expired and refuse Face ID. A wrong passphrase stores nothing and the new
  // passkey is signalled as unknown.
  const check = unlockVault(passphrase).then(
    () => undefined,
    (error: unknown) => ({ error }),
  );

  // 2. Register a passkey (or resume one whose PRF output could not be read yet).
  let credentialId: Uint8Array<ArrayBuffer>;
  let prfSalt: Uint8Array<ArrayBuffer>;
  let prfOutput: Uint8Array<ArrayBuffer> | null = null;
  // A pending passkey is resumed once at most, so a passkey deleted meanwhile cannot trap the person.
  const resumed = pending !== null && pending.rp === rp ? pending : null;
  pending = null;
  if (resumed !== null) {
    ({ credentialId, prfSalt } = resumed);
  } else {
    prfSalt = random(SALT_BYTES);
    let created: unknown;
    try {
      created = await container.create({
        publicKey: {
          rp: { name: "Finance", id: rp },
          user: {
            id: random(16),
            name: "Finance",
            displayName: "Coffre Finance",
          },
          challenge: random(32),
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },
            { type: "public-key", alg: -257 },
          ],
          authenticatorSelection: {
            userVerification: "required",
            residentKey: "preferred",
            authenticatorAttachment: "platform",
          },
          timeout: TIMEOUT_MS,
          extensions: { prf: { eval: { first: prfSalt } } },
        },
      });
    } catch (error) {
      await passphraseRefused(check);
      throw new Error(
        cancelled(error) ? ENABLE_CANCELLED_ERROR : UNSUPPORTED_ERROR,
      );
    }
    const credential = asPrfCredential(created);
    if (
      !credential ||
      credential.rawId.byteLength < 1 ||
      credential.rawId.byteLength > MAX_CREDENTIAL_ID_BYTES
    ) {
      await passphraseRefused(check);
      throw new Error(UNSUPPORTED_ERROR);
    }
    credentialId = new Uint8Array(credential.rawId.slice(0));
    // 3. PRF must be enabled for this passkey; its output may already come with the creation.
    const results = extensionResults(credential);
    if (results?.prf?.enabled !== true) {
      forgetCredential(toBase64Url(credentialId));
      await passphraseRefused(check);
      throw new Error(UNSUPPORTED_ERROR);
    }
    prfOutput = takePrfOutput(results);
  }
  const credentialIdText = toBase64Url(credentialId);
  try {
    await passphraseRefused(check);
  } catch (error) {
    prfOutput?.fill(0);
    forgetCredential(credentialIdText);
    throw error;
  }
  if (prfOutput === null) {
    try {
      prfOutput = await evaluatePrf(
        container,
        rp,
        credentialId,
        prfSalt,
        ENABLE_CANCELLED_ERROR,
      );
    } catch (error) {
      if (
        resumed === null &&
        error instanceof Error &&
        error.message === ENABLE_CANCELLED_ERROR
      ) {
        // Some browsers refuse a second prompt without a new tap: the next attempt skips creation.
        pending = { rp, credentialId, prfSalt };
        throw new Error(ENABLE_INTERRUPTED_ERROR);
      }
      forgetCredential(credentialIdText);
      throw error;
    }
  }

  // 4. HKDF(PRF) -> AES-GCM key, never extractable, bound to this passkey by the additional data.
  let iv: Uint8Array<ArrayBuffer>;
  let ciphertext: ArrayBuffer;
  const plaintext = encoder.encode(passphrase);
  try {
    const key = await wrappingKey(prfOutput);
    iv = random(12);
    ciphertext = await webCrypto().subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        tagLength: 128,
        additionalData: additionalData(credentialIdText),
      },
      key,
      plaintext,
    );
  } catch {
    forgetCredential(credentialIdText);
    throw new Error(UNSUPPORTED_ERROR);
  } finally {
    plaintext.fill(0);
    prfOutput.fill(0);
  }

  // 5. One atomic write, only once everything above succeeded.
  const stored: StoredQuickUnlock = {
    version: 1,
    credentialId: credentialIdText,
    prfSalt: toBase64(prfSalt),
    iv: toBase64(iv),
    ct: toBase64(new Uint8Array(ciphertext)),
    createdAt: new Date().toISOString(),
  };
  let previous: ParsedQuickUnlock | null = null;
  try {
    const local = storage();
    const before = local.getItem(STORAGE_KEY);
    previous = before === null ? null : parseStored(before);
    local.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    forgetCredential(credentialIdText);
    throw new Error(SAVE_ERROR);
  }
  if (previous && previous.stored.credentialId !== credentialIdText) {
    forgetCredential(previous.stored.credentialId);
  }
}

/** One Face ID / fingerprint prompt, then the vault opens exactly as with the typed passphrase. */
export async function quickUnlock(): Promise<{
  data: FinanceData;
  key: CryptoKey;
}> {
  // Everything before `get` is synchronous, so the browser still sees the person's tap.
  const raw = readStored();
  if (raw === null) throw new Error(NOT_ENABLED_ERROR);
  const parsed = parseStored(raw);
  if (!parsed) {
    removeIfUnchanged(raw);
    throw new Error(UNREADABLE_ERROR);
  }
  if (!vaultExists()) throw new Error(NO_VAULT_ERROR);
  const container = credentialsApi();
  const rp = relyingPartyId();
  if (!container || !rp) throw new Error(UNSUPPORTED_ERROR);

  const prfOutput = await evaluatePrf(
    container,
    rp,
    parsed.credentialId,
    parsed.prfSalt,
    UNLOCK_CANCELLED_ERROR,
  );
  let passphrase: string;
  try {
    const key = await wrappingKey(prfOutput);
    let plaintext: Uint8Array;
    try {
      plaintext = new Uint8Array(
        await webCrypto().subtle.decrypt(
          {
            name: "AES-GCM",
            iv: parsed.iv,
            tagLength: 128,
            additionalData: additionalData(parsed.stored.credentialId),
          },
          key,
          parsed.ct,
        ),
      );
    } catch {
      // Another authenticator, or a ciphertext altered in place: fail without touching anything.
      throw new Error(FAILED_ERROR);
    }
    try {
      passphrase = decoder.decode(plaintext);
    } catch {
      throw new Error(FAILED_ERROR);
    } finally {
      plaintext.fill(0);
    }
  } finally {
    prfOutput.fill(0);
  }

  try {
    return await unlockVault(passphrase);
  } catch (error) {
    if (isVaultOpenError(error)) {
      // The vault on this device no longer opens with the protected passphrase (replaced from
      // GitHub or a backup with another one): this setting is useless and is removed.
      removeIfUnchanged(raw);
      forgetCredential(parsed.stored.credentialId);
      throw new Error(CHANGED_ERROR);
    }
    throw error;
  }
}

/** Removes this device's setting (the vault is untouched). Throws only if it could not be removed. */
export function disableQuickUnlock(): void {
  pending = null;
  let raw: string | null;
  try {
    const local = storage();
    raw = local.getItem(STORAGE_KEY);
    local.removeItem(STORAGE_KEY);
  } catch {
    throw new Error(DISABLE_ERROR);
  }
  const parsed = raw === null ? null : parseStored(raw);
  if (parsed) forgetCredential(parsed.stored.credentialId);
}
