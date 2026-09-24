import type { FinanceData } from "./domain/types";
import {
  openFromGitHub,
  validateSyncSettings,
  type SyncConfig,
  type SyncTarget,
} from "./sync";
import {
  deriveVaultKey,
  openVaultKeyInfo,
  vaultIterationsAllowed,
} from "./vault";

/**
 * « Ajouter un appareil » : un code à copier (AirDrop, Messages, presse-papiers) qui transporte
 * les réglages GitHub (propriétaire, dépôt, chemin, jeton) chiffrés avec la clé du coffre ouvert.
 * Le nouvel appareil colle le code « FIN1.… » dans l'application et tape la phrase secrète : elle
 * redérive la même clé (sel et itérations du coffre, non secrets, inclus dans le code), puis
 * `openFromGitHub` fait le reste.
 *
 * Le code est destiné à être collé, pas ouvert comme adresse : une URL resterait dans l'historique
 * du navigateur. `url` reste fournie (code dans le fragment #ajouter=…, jamais envoyé au serveur)
 * et une URL collée est encore acceptée. Le code reste un chiffré attaquable hors ligne par la
 * seule phrase secrète, comme une sauvegarde exportée : à partager seulement avec ses propres appareils.
 */
const PREFIX = "FIN1.";
const FRAGMENT = "ajouter=";
const LINK_AAD = new TextEncoder().encode("Finance/device-link/v1");
const MAX_CODE_CHARS = 4_096;
// Room for the origin and path of a full URL around the code.
const MAX_INPUT_CHARS = 8_192;
// Owner (100) + repository (100) + path (200) + token (255), ASCII, plus JSON syntax: well under 2 KiB.
const MAX_SETTINGS_BYTES = 2_048;
const INVALID_ERROR = "Ce code d'ajout n'est pas valide.";
const PASSPHRASE_ERROR = "Phrase secrète incorrecte pour ce code.";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export type DeviceLink = {
  readonly v: 1;
  readonly salt: string;
  readonly iterations: number;
  readonly iv: string;
  readonly ct: string;
};

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
function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = fromBase64(
    standard + "=".repeat((4 - (standard.length % 4)) % 4),
    1,
    MAX_CODE_CHARS,
  );
  return bytes !== null && toBase64Url(bytes) === value ? bytes : null;
}

function webCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error(
      "Le coffre exige un navigateur récent dans un contexte sécurisé (HTTPS ou localhost).",
    );
  }
  return globalThis.crypto;
}

/** Strict shape of a code payload; returns a fresh, frozen copy or throws the one invalid-code error. */
function validateLink(value: unknown): DeviceLink {
  if (
    !record(value) ||
    !exactKeys(value, ["v", "salt", "iterations", "iv", "ct"]) ||
    value.v !== 1 ||
    !vaultIterationsAllowed(value.iterations) ||
    fromBase64(value.salt, 16, 16) === null ||
    fromBase64(value.iv, 12, 12) === null ||
    fromBase64(value.ct, 17, MAX_SETTINGS_BYTES + 16) === null
  ) {
    throw new Error(INVALID_ERROR);
  }
  return Object.freeze({
    v: 1,
    salt: value.salt as string,
    iterations: value.iterations,
    iv: value.iv as string,
    ct: value.ct as string,
  });
}

function parseSettings(text: string): SyncTarget {
  const value: unknown = JSON.parse(text);
  if (
    !record(value) ||
    !exactKeys(value, ["owner", "repo", "path", "token"]) ||
    typeof value.owner !== "string" ||
    typeof value.repo !== "string" ||
    typeof value.path !== "string" ||
    typeof value.token !== "string"
  ) {
    throw new Error(INVALID_ERROR);
  }
  return validateSyncSettings({
    owner: value.owner,
    repo: value.repo,
    path: value.path,
    token: value.token,
  });
}

/** Encrypts the GitHub settings with the open vault key; the code holds no clear owner, repository or token. */
export async function createDeviceLink(
  key: CryptoKey,
  settings: { owner: string; repo: string; path: string; token: string },
): Promise<{ code: string; url: string }> {
  const { salt, iterations } = openVaultKeyInfo(key);
  // Only these four fields travel, validated exactly as sync would use them (never lastSha/lastSavedAt).
  const target = validateSyncSettings({
    owner: settings.owner,
    repo: settings.repo,
    path: settings.path,
    token: settings.token,
  });
  const plaintext = encoder.encode(
    JSON.stringify({
      owner: target.owner,
      repo: target.repo,
      path: target.path,
      token: target.token,
    }),
  );
  let payload: DeviceLink;
  try {
    const crypto = webCrypto();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, tagLength: 128, additionalData: LINK_AAD },
      key,
      plaintext,
    );
    payload = {
      v: 1,
      salt,
      iterations,
      iv: toBase64(iv),
      ct: toBase64(new Uint8Array(ciphertext)),
    };
  } finally {
    plaintext.fill(0);
  }
  const code = PREFIX + toBase64Url(encoder.encode(JSON.stringify(payload)));
  const place = globalThis.location;
  const base = place ? `${place.origin}${place.pathname}` : "";
  return { code, url: `${base}#${FRAGMENT}${code}` };
}

/** Accepts the bare code (the intended use), or a pasted URL (any origin) or fragment, with or without « # ». */
export function readDeviceLink(input: string): DeviceLink {
  if (typeof input !== "string" || input.length > MAX_INPUT_CHARS) {
    throw new Error(INVALID_ERROR);
  }
  let text = input.trim();
  const marker = text.indexOf(`#${FRAGMENT}`);
  if (marker !== -1) text = text.slice(marker + FRAGMENT.length + 1);
  else if (text.startsWith(FRAGMENT)) text = text.slice(FRAGMENT.length);
  if (!text.startsWith(PREFIX) || text.length > MAX_CODE_CHARS) {
    throw new Error(INVALID_ERROR);
  }
  const bytes = fromBase64Url(text.slice(PREFIX.length));
  if (bytes === null) throw new Error(INVALID_ERROR);
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(bytes));
  } catch {
    throw new Error(INVALID_ERROR);
  }
  return validateLink(value);
}

/** Nothing is written unless the passphrase opens the code; then `openFromGitHub` applies all its checks. */
export async function openFromDeviceLink(
  link: DeviceLink,
  passphrase: string,
  allowOlder = false,
): Promise<{ key: CryptoKey; data: FinanceData; config: SyncConfig }> {
  const checked = validateLink(link);
  let plaintext: Uint8Array;
  try {
    const key = await deriveVaultKey(
      passphrase,
      checked.salt,
      checked.iterations,
    );
    plaintext = new Uint8Array(
      await webCrypto().subtle.decrypt(
        {
          name: "AES-GCM",
          iv: fromBase64(checked.iv, 12, 12)!,
          tagLength: 128,
          additionalData: LINK_AAD,
        },
        key,
        fromBase64(checked.ct, 17, MAX_SETTINGS_BYTES + 16)!,
      ),
    );
  } catch {
    throw new Error(PASSPHRASE_ERROR);
  }
  let settings: SyncTarget;
  try {
    settings = parseSettings(decoder.decode(plaintext));
  } catch {
    // Authenticated yet malformed: only a faulty creator could produce it.
    throw new Error(INVALID_ERROR);
  } finally {
    plaintext.fill(0);
  }
  // Private repository check, foreign or older vault, decrypt-before-write: all from openFromGitHub.
  return openFromGitHub(settings, passphrase, allowOlder);
}
