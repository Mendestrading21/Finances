import type { FinanceData } from "./domain/types";
import {
  envelopeInfo,
  exportVault,
  type EnvelopeInfo,
  importVault,
  openSecret,
  replaceVaultFromRemote,
  resealVault,
  sealSecret,
  VaultKeyMismatchError,
} from "./vault";

export { VaultChangedError, VaultKeyMismatchError } from "./vault";

// Only the encrypted vault envelope ever reaches GitHub; the token is stored sealed with the vault key.
const SYNC_KEY = "finance.sync.v1";
export const DEFAULT_SYNC_PATH = "finance-coffre.json";
const API = "https://api.github.com";
const TIMEOUT_MS = 60_000;
const COMMIT_MESSAGE = "Finance : coffre chiffré";
const NAME_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;
const PATH_PATTERN = /^[A-Za-z0-9_.\-/]{1,200}$/;
// Printable ASCII only, so the token can never break or inject an HTTP header.
const TOKEN_PATTERN = /^[\x21-\x7E]{20,255}$/;
const TOKEN_PREFIX = "github_pat_";
const TOKEN_ERROR = "Jeton GitHub invalide : 20 à 255 caractères, sans espace.";
const FINE_GRAINED_ERROR =
  "Utilisez un jeton « fine-grained » (il commence par github_pat_), limité à ce seul dépôt.";
const MAX_REMOTE_BYTES = 25_000_000;
const BYTES_PER_EXTRA_SECOND = 50_000;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SAVED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const APP_REPOSITORIES = [
  "mendestrading21/finances",
  "mendestrading21/finance1",
];
const APP_REPOSITORY_ERROR =
  "Choisissez un dépôt privé distinct du code de l’application.";
const STORAGE_ERROR =
  "Le stockage de cet appareil est inaccessible. Vérifiez les réglages du navigateur.";
const REFUSED_ERROR =
  "GitHub a refusé l’envoi du coffre. Rien n’a été remplacé ; réessayez plus tard.";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export type SyncSettings = {
  owner: string;
  repo: string;
  path?: string;
  token: string;
};
export type SyncTarget = {
  owner: string;
  repo: string;
  path: string;
  token: string;
};
export type SyncConfig = SyncTarget & {
  lastSha?: string;
  lastSavedAt?: string;
};
export type SyncResult =
  | { status: "pushed" | "up-to-date" }
  | { status: "pulled"; data: FinanceData }
  | {
      status: "conflict";
      localSavedAt?: string;
      remoteSavedAt?: string;
      localSha: string;
      remoteSha: string;
    }
  | { status: "foreign"; remoteSavedAt?: string; remoteSha: string };
export type ResolveOptions = {
  expected?: { localSha?: string; remoteSha: string };
  replaceForeign?: boolean;
};
export type SyncState =
  | { state: "off" }
  | { state: "ready"; config: SyncConfig }
  | { state: "reconfigure" };
/** `raw` is null only when getRemote was given the matching `knownSha` for a file served without inline content. */
export type RemoteVault = { raw: string | null; sha: string };
type RemoteContent = { raw: string; sha: string };

type SealedToken = { iv: string; ct: string };
type StoredConfig = {
  version: 1;
  owner: string;
  repo: string;
  path: string;
  token: SealedToken;
  lastSha?: string;
  lastSavedAt?: string;
};
type LocalVault = {
  raw: string;
  sha: string;
  savedAt?: string;
  salt: string;
  iterations: number;
};

export class SyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncError";
  }
}

export class SyncConflictError extends SyncError {
  constructor() {
    super(
      "Le coffre distant a changé entre-temps. Relancez la synchronisation.",
    );
    this.name = "SyncConflictError";
  }
}

export class SyncOfflineError extends SyncError {
  constructor() {
    super("Hors ligne : la synchronisation reprendra plus tard.");
    this.name = "SyncOfflineError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSha(value: unknown): value is string {
  return typeof value === "string" && SHA_PATTERN.test(value);
}

function isSavedAt(value: unknown): value is string {
  return (
    typeof value === "string" &&
    SAVED_AT_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validateLocation(owner: string, repo: string, path: string): void {
  // "." and ".." would be normalized away by URL parsing and escape /repos/{owner}/{repo}.
  if (!NAME_PATTERN.test(owner) || /^\.+$/.test(owner)) {
    throw new SyncError(
      "Propriétaire GitHub invalide : lettres, chiffres, « - », « _ » ou « . » (100 caractères maximum).",
    );
  }
  if (!NAME_PATTERN.test(repo) || /^\.+$/.test(repo)) {
    throw new SyncError(
      "Nom de dépôt invalide : lettres, chiffres, « - », « _ » ou « . » (100 caractères maximum).",
    );
  }
  if (APP_REPOSITORIES.includes(`${owner}/${repo}`.toLowerCase())) {
    throw new SyncError(APP_REPOSITORY_ERROR);
  }
  if (
    !PATH_PATTERN.test(path) ||
    path.includes("..") ||
    path.startsWith("/") ||
    path.split("/").some((segment) => segment === "" || segment === ".")
  ) {
    throw new SyncError(
      "Chemin du fichier invalide : lettres, chiffres, « - », « _ », « . » et « / », sans « .. » ni « / » au début ou à la fin (200 caractères maximum).",
    );
  }
}

function tokenProblem(token: string): string | null {
  if (!TOKEN_PATTERN.test(token)) return TOKEN_ERROR;
  return token.startsWith(TOKEN_PREFIX) ? null : FINE_GRAINED_ERROR;
}

/** Normalizes and strictly validates user input; never echoes the token in an error. */
export function validateSyncSettings(settings: SyncSettings): SyncTarget {
  if (!record(settings)) {
    throw new SyncError("Réglages de synchronisation invalides.");
  }
  const owner = trimmed(settings.owner);
  const repo = trimmed(settings.repo);
  const path = trimmed(settings.path) || DEFAULT_SYNC_PATH;
  const token = trimmed(settings.token);
  validateLocation(owner, repo, path);
  const problem = tokenProblem(token);
  if (problem) throw new SyncError(problem);
  return { owner, repo, path, token };
}

function storage(): Storage {
  try {
    const local = globalThis.localStorage;
    if (!local) throw new Error("unavailable");
    return local;
  } catch {
    throw new SyncError(STORAGE_ERROR);
  }
}

function readStored(): string | null {
  try {
    return storage().getItem(SYNC_KEY);
  } catch {
    throw new SyncError(STORAGE_ERROR);
  }
}

function writeStored(config: StoredConfig): void {
  try {
    storage().setItem(SYNC_KEY, JSON.stringify(config));
  } catch {
    throw new SyncError(
      "Configuration de synchronisation non enregistrée : espace disponible ou stockage inaccessible.",
    );
  }
}

function parseStored(raw: string): StoredConfig | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const allowed = [
    "version",
    "owner",
    "repo",
    "path",
    "token",
    "lastSha",
    "lastSavedAt",
  ];
  if (
    !record(value) ||
    value.version !== 1 ||
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    typeof value.owner !== "string" ||
    typeof value.repo !== "string" ||
    typeof value.path !== "string" ||
    !record(value.token) ||
    Object.keys(value.token).length !== 2 ||
    typeof value.token.iv !== "string" ||
    typeof value.token.ct !== "string" ||
    (value.lastSha !== undefined && !isSha(value.lastSha)) ||
    (value.lastSavedAt !== undefined && !isSavedAt(value.lastSavedAt))
  ) {
    return null;
  }
  try {
    validateLocation(value.owner, value.repo, value.path);
  } catch {
    return null;
  }
  return {
    version: 1,
    owner: value.owner,
    repo: value.repo,
    path: value.path,
    token: { iv: value.token.iv, ct: value.token.ct },
    ...(value.lastSha === undefined ? {} : { lastSha: value.lastSha }),
    ...(value.lastSavedAt === undefined
      ? {}
      : { lastSavedAt: value.lastSavedAt }),
  };
}

function toBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
  }
  return btoa(chunks.join(""));
}

function decodeBase64Utf8(content: string): string {
  const compact = content.replace(/\s/g, "");
  try {
    if (compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
      throw new Error("base64");
    }
    const binary = atob(compact);
    return decoder.decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    );
  } catch {
    throw new SyncError(
      "Le fichier distant est illisible (encodage invalide).",
    );
  }
}

/** Git blob SHA-1, i.e. the `sha` GitHub reports for a file with exactly these bytes. */
async function gitBlobSha(raw: string): Promise<string> {
  const body = encoder.encode(raw);
  const header = encoder.encode(`blob ${body.byteLength}\0`);
  const bytes = new Uint8Array(header.byteLength + body.byteLength);
  bytes.set(header);
  bytes.set(body, header.byteLength);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function repoUrl(target: SyncTarget): string {
  return `${API}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;
}

function contentsUrl(target: SyncTarget): string {
  const path = target.path.split("/").map(encodeURIComponent).join("/");
  return `${repoUrl(target)}/contents/${path}`;
}

function unexpectedResponse(): SyncError {
  return new SyncError("Réponse GitHub inattendue. Rien n’a été modifié.");
}

function httpError(response: Response): SyncError {
  const status = response.status;
  if (status === 401) {
    return new SyncError(
      "Jeton GitHub refusé : il est invalide, expiré ou révoqué.",
    );
  }
  if (
    status === 429 ||
    (status === 403 && response.headers.get("x-ratelimit-remaining") === "0")
  ) {
    return new SyncError(
      "Limite de requêtes GitHub atteinte. Réessayez dans quelques minutes.",
    );
  }
  if (status === 403) {
    return new SyncError(
      "Droits insuffisants : le jeton doit avoir l’accès « Contents » en lecture et écriture sur ce dépôt.",
    );
  }
  if (status === 404) {
    return new SyncError("Dépôt introuvable, ou jeton sans accès à ce dépôt.");
  }
  if (status >= 500) {
    return new SyncError(
      "GitHub est momentanément indisponible. Réessayez plus tard.",
    );
  }
  return new SyncError(`Réponse inattendue de GitHub (code ${status}).`);
}

async function bodyText(response: Response): Promise<string> {
  let bytes: ArrayBuffer;
  try {
    bytes = await response.arrayBuffer();
  } catch {
    throw new SyncOfflineError();
  }
  try {
    return decoder.decode(bytes);
  } catch {
    throw new SyncError(
      "Le fichier distant est illisible (encodage invalide).",
    );
  }
}

async function bodyJson(response: Response): Promise<unknown> {
  const text = await bodyText(response);
  try {
    return JSON.parse(text);
  } catch {
    throw unexpectedResponse();
  }
}

async function github<T>(
  target: SyncTarget,
  url: string,
  options: {
    method?: "GET" | "PUT";
    accept?: string;
    body?: string;
    bytes?: number;
  },
  read: (response: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  // One extra second per 50 kB, so a large vault on a slow connection is not cut off.
  const timeout =
    TIMEOUT_MS +
    Math.ceil((options.bytes ?? 0) / BYTES_PER_EXTRA_SECOND) * 1_000;
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? "GET",
        headers: {
          Authorization: `Bearer ${target.token}`,
          Accept: options.accept ?? "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(options.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body: options.body,
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      throw new SyncOfflineError();
    }
    return await read(response);
  } finally {
    clearTimeout(timer);
  }
}

/** Connexion simplifiée : avec la seule clé d'accès, retrouve l'identifiant GitHub et les
 * dépôts privés que cette clé peut lire (le dépôt de l'application exclu). Rien n'est écrit. */
export async function detectSyncRepos(
  token: string,
): Promise<{ owner: string; repos: string[] }> {
  const clean = trimmed(token);
  const problem = tokenProblem(clean);
  if (problem) throw new SyncError(problem);
  const probe: SyncTarget = { owner: "", repo: "", path: DEFAULT_SYNC_PATH, token: clean };
  const user = await github(probe, `${API}/user`, {}, async (response) => {
    if (!response.ok) throw httpError(response);
    return bodyJson(response);
  });
  if (!record(user) || typeof user.login !== "string" || !NAME_PATTERN.test(user.login))
    throw unexpectedResponse();
  const owner = user.login;
  const list = await github(
    probe,
    `${API}/user/repos?visibility=private&affiliation=owner&per_page=100&sort=updated`,
    {},
    async (response) => {
      if (!response.ok) throw httpError(response);
      return bodyJson(response);
    },
  );
  if (!Array.isArray(list)) throw unexpectedResponse();
  const repos = list
    .filter(
      (item): item is Record<string, unknown> =>
        record(item) &&
        item.private === true &&
        typeof item.name === "string" &&
        NAME_PATTERN.test(item.name) &&
        record(item.owner) &&
        item.owner.login === owner &&
        !APP_REPOSITORIES.includes(`${owner}/${item.name}`.toLowerCase()),
    )
    .map((item) => item.name as string);
  return { owner, repos };
}

/** Refuses a public (or unconfirmed) repository and the application's own source repository. */
export async function checkRepoPrivate(target: SyncTarget): Promise<void> {
  const body = await github(target, repoUrl(target), {}, async (response) => {
    if (!response.ok) throw httpError(response);
    return bodyJson(response);
  });
  if (!record(body)) throw unexpectedResponse();
  // A renamed repository redirects: check the name GitHub actually resolved too.
  if (
    typeof body.full_name === "string" &&
    APP_REPOSITORIES.includes(body.full_name.toLowerCase())
  ) {
    throw new SyncError(APP_REPOSITORY_ERROR);
  }
  if (body.private !== true) {
    throw new SyncError(
      "Le dépôt doit être privé. Rendez-le privé sur GitHub ou choisissez un autre dépôt.",
    );
  }
}

export async function getRemote(
  target: SyncTarget,
  knownSha?: string,
): Promise<RemoteVault | null> {
  const url = contentsUrl(target);
  const meta = await github(target, url, {}, async (response) => {
    if (response.status === 404) return null;
    if (!response.ok) throw httpError(response);
    return bodyJson(response);
  });
  if (meta === null) return null;
  if (!record(meta) || meta.type !== "file" || !isSha(meta.sha)) {
    throw new SyncError(
      "Le chemin indiqué sur GitHub n’est pas un fichier de coffre.",
    );
  }
  const sha = meta.sha;
  if (
    meta.encoding === "base64" &&
    typeof meta.content === "string" &&
    meta.content !== ""
  ) {
    return { raw: decodeBase64Utf8(meta.content), sha };
  }
  const size = typeof meta.size === "number" ? meta.size : 0;
  if (size > MAX_REMOTE_BYTES) {
    throw new SyncError(
      "Le fichier distant est trop volumineux pour un coffre Finance. Rien n’a été modifié.",
    );
  }
  // Files over 1 MB come without inline content: skip the download when already known, else fetch the raw bytes.
  if (knownSha !== undefined && sha === knownSha) return { raw: null, sha };
  const raw = await github(
    target,
    url,
    { accept: "application/vnd.github.raw+json", bytes: size },
    async (response) => {
      if (!response.ok) throw httpError(response);
      return bodyText(response);
    },
  );
  if ((await gitBlobSha(raw)) !== sha) {
    throw new SyncError(
      "Le coffre distant a changé pendant la lecture. Réessayez.",
    );
  }
  return { raw, sha };
}

/** Sends one encrypted envelope; anything else is refused before any request. */
export async function putRemote(
  target: SyncTarget,
  raw: string,
  sha?: string,
): Promise<string> {
  envelopeInfo(raw);
  const body = JSON.stringify({
    message: COMMIT_MESSAGE,
    content: toBase64(encoder.encode(raw)),
    ...(sha === undefined ? {} : { sha }),
  });
  const result = await github(
    target,
    contentsUrl(target),
    { method: "PUT", body, bytes: body.length },
    async (response) => {
      if (response.status === 409 || response.status === 422) {
        throw new SyncConflictError();
      }
      if (!response.ok) throw httpError(response);
      return bodyJson(response);
    },
  );
  if (
    !record(result) ||
    !record(result.content) ||
    !isSha(result.content.sha)
  ) {
    throw unexpectedResponse();
  }
  return result.content.sha;
}

let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

async function describeLocal(raw: string): Promise<LocalVault> {
  const { savedAt, salt, iterations } = envelopeInfo(raw);
  return {
    raw,
    sha: await gitBlobSha(raw),
    salt,
    iterations,
    ...(savedAt === undefined ? {} : { savedAt }),
  };
}

function readLocal(): Promise<LocalVault> {
  return describeLocal(exportVault());
}

async function getRemoteContent(
  target: SyncTarget,
): Promise<RemoteContent | null> {
  const remote = await getRemote(target);
  if (remote === null) return null;
  if (remote.raw === null) throw unexpectedResponse();
  return { raw: remote.raw, sha: remote.sha };
}

function unchangedSinceSync(local: LocalVault, config: SyncConfig): boolean {
  return (
    config.lastSha !== undefined &&
    local.sha === config.lastSha &&
    local.savedAt === config.lastSavedAt
  );
}

type Inspected = { foreign: boolean; savedAt?: string };

/** Compares envelope metadata only, never decrypts; an unreadable file counts as another vault. */
function inspectRemote(local: LocalVault, remote: RemoteContent): Inspected {
  let info: EnvelopeInfo;
  try {
    info = envelopeInfo(remote.raw);
  } catch {
    return { foreign: true };
  }
  return {
    foreign: info.salt !== local.salt || info.iterations !== local.iterations,
    ...(info.savedAt === undefined ? {} : { savedAt: info.savedAt }),
  };
}

function divergence(
  local: LocalVault,
  remote: RemoteContent,
  inspected: Inspected,
): SyncResult {
  const remoteSavedAt =
    inspected.savedAt === undefined ? {} : { remoteSavedAt: inspected.savedAt };
  if (inspected.foreign) {
    return { status: "foreign", remoteSha: remote.sha, ...remoteSavedAt };
  }
  return {
    status: "conflict",
    localSha: local.sha,
    remoteSha: remote.sha,
    ...(local.savedAt === undefined ? {} : { localSavedAt: local.savedAt }),
    ...remoteSavedAt,
  };
}

/** Updates `config` in place, then persists best effort: a lost write is recovered next time by byte comparison. */
function remember(
  config: SyncConfig,
  sha: string,
  savedAt: string | undefined,
): void {
  config.lastSha = sha;
  if (savedAt === undefined) delete config.lastSavedAt;
  else config.lastSavedAt = savedAt;
  try {
    const raw = readStored();
    const stored = raw === null ? null : parseStored(raw);
    if (
      !stored ||
      stored.owner !== config.owner ||
      stored.repo !== config.repo ||
      stored.path !== config.path
    ) {
      return;
    }
    const { lastSavedAt: _previous, ...rest } = stored;
    writeStored({
      ...rest,
      lastSha: sha,
      ...(savedAt === undefined ? {} : { lastSavedAt: savedAt }),
    });
  } catch {
    // Not fatal: the vault itself is already consistent.
  }
}

/** Reports the current situation without writing the vault or the remote. */
function classify(
  config: SyncConfig,
  local: LocalVault,
  remote: RemoteContent,
): SyncResult {
  if (remote.raw === local.raw) {
    remember(config, remote.sha, local.savedAt);
    return { status: "up-to-date" };
  }
  return divergence(local, remote, inspectRemote(local, remote));
}

async function pull(
  key: CryptoKey,
  config: SyncConfig,
  local: LocalVault,
  remote: RemoteContent,
  remoteSavedAt: string | undefined,
): Promise<SyncResult> {
  // Only the snapshot this decision was based on may be replaced; a later local save raises VaultChangedError.
  const data = await replaceVaultFromRemote(key, remote.raw, local.raw);
  remember(config, remote.sha, remoteSavedAt);
  return { status: "pulled", data };
}

async function reconcile(
  key: CryptoKey,
  config: SyncConfig,
  local: LocalVault,
  remote: RemoteContent,
): Promise<SyncResult> {
  if (remote.raw === local.raw) {
    remember(config, remote.sha, local.savedAt);
    return { status: "up-to-date" };
  }
  const inspected = inspectRemote(local, remote);
  // An older remote than the last synced version is a stale read or a skewed clock: let the person decide.
  const remoteOlder =
    inspected.savedAt !== undefined &&
    config.lastSavedAt !== undefined &&
    inspected.savedAt < config.lastSavedAt;
  if (!inspected.foreign && !remoteOlder && unchangedSinceSync(local, config)) {
    return pull(key, config, local, remote, inspected.savedAt);
  }
  return divergence(local, remote, inspected);
}

async function push(
  key: CryptoKey,
  config: SyncConfig,
  local: LocalVault,
  remote: RemoteVault | null,
  onRace: "reconcile" | "classify",
): Promise<SyncResult> {
  try {
    const sha = await putRemote(config, local.raw, remote?.sha);
    remember(config, sha, local.savedAt);
    return { status: "pushed" };
  } catch (error) {
    if (!(error instanceof SyncConflictError)) throw error;
  }
  const current = await getRemoteContent(config);
  if (current === null || current.sha === remote?.sha) {
    throw new SyncError(REFUSED_ERROR);
  }
  return onRace === "reconcile"
    ? reconcile(key, config, local, current)
    : classify(config, local, current);
}

/** Validates, requires a private repository, then stores the settings with the token sealed by the vault key. */
export function configureSync(
  key: CryptoKey,
  settings: SyncSettings,
): Promise<SyncConfig> {
  return exclusive(async () => {
    const target = validateSyncSettings(settings);
    await checkRepoPrivate(target);
    const token = await sealSecret(key, target.token);
    writeStored({
      version: 1,
      owner: target.owner,
      repo: target.repo,
      path: target.path,
      token,
    });
    return { ...target };
  });
}

/** "reconfigure": settings exist but cannot be used with this vault key (e.g. vault restored with another salt, or an older kind of token). */
export async function loadSyncState(key: CryptoKey): Promise<SyncState> {
  const raw = readStored();
  if (raw === null) return { state: "off" };
  const stored = parseStored(raw);
  if (!stored) return { state: "reconfigure" };
  let token: string;
  try {
    token = await openSecret(key, stored.token);
  } catch {
    return { state: "reconfigure" };
  }
  if (tokenProblem(token)) return { state: "reconfigure" };
  return {
    state: "ready",
    config: {
      owner: stored.owner,
      repo: stored.repo,
      path: stored.path,
      token,
      ...(stored.lastSha === undefined ? {} : { lastSha: stored.lastSha }),
      ...(stored.lastSavedAt === undefined
        ? {}
        : { lastSavedAt: stored.lastSavedAt }),
    },
  };
}

/** Null when sync is off or must be reconfigured; use loadSyncState to tell them apart. */
export async function loadSyncConfig(
  key: CryptoKey,
): Promise<SyncConfig | null> {
  const result = await loadSyncState(key);
  return result.state === "ready" ? result.config : null;
}

export function disableSync(): void {
  try {
    storage().removeItem(SYNC_KEY);
  } catch {
    throw new SyncError(STORAGE_ERROR);
  }
}

/** Pushes, pulls, or reports a conflict or a foreign vault without writing anything; updates `config` in place. */
export function syncNow(
  key: CryptoKey,
  config: SyncConfig,
): Promise<SyncResult> {
  return exclusive(async () => {
    await checkRepoPrivate(config);
    const local = await readLocal();
    const remote = await getRemote(config, config.lastSha);
    if (remote !== null && remote.sha !== config.lastSha) {
      if (remote.raw === null) throw unexpectedResponse();
      return reconcile(key, config, local, {
        raw: remote.raw,
        sha: remote.sha,
      });
    }
    if (remote !== null && unchangedSinceSync(local, config)) {
      return { status: "up-to-date" };
    }
    return push(key, config, local, remote, "reconcile");
  });
}

/** Explicit choice after a conflict: "remote" replaces this vault, "local" overwrites the remote file (a foreign vault only with `replaceForeign`). */
export function resolveConflict(
  key: CryptoKey,
  config: SyncConfig,
  choice: "remote" | "local",
  options: ResolveOptions = {},
): Promise<SyncResult> {
  return exclusive(async () => {
    await checkRepoPrivate(config);
    const local = await readLocal();
    const remote = await getRemoteContent(config);
    const expected = options.expected;
    if (
      expected !== undefined &&
      ((expected.localSha !== undefined && expected.localSha !== local.sha) ||
        remote?.sha !== expected.remoteSha)
    ) {
      // The choice was made on what was shown; describe what is there now instead of applying it.
      if (remote === null) {
        throw new SyncError(
          "Le coffre distant a disparu depuis l’affichage du choix. Rien n’a été modifié ; relancez la synchronisation.",
        );
      }
      return classify(config, local, remote);
    }
    if (remote !== null && remote.raw === local.raw) {
      remember(config, remote.sha, local.savedAt);
      return { status: "up-to-date" };
    }
    const inspected = remote === null ? null : inspectRemote(local, remote);
    if (choice === "remote") {
      if (remote === null || inspected === null) {
        throw new SyncError("Aucun coffre trouvé dans ce dépôt.");
      }
      if (inspected.foreign) throw new VaultKeyMismatchError();
      return pull(key, config, local, remote, inspected.savedAt);
    }
    if (choice !== "local") throw new SyncError("Choix de résolution inconnu.");
    if (
      remote !== null &&
      inspected !== null &&
      inspected.foreign &&
      !options.replaceForeign
    ) {
      return divergence(local, remote, inspected);
    }
    // A fresh savedAt makes the kept version newer than the one it replaces, so other devices pull it instead of conflicting again.
    const raw = await resealVault(
      key,
      local.raw,
      inspected !== null && !inspected.foreign ? inspected.savedAt : undefined,
    );
    return push(key, config, await describeLocal(raw), remote, "classify");
  });
}

/** New device or explicit restore: the vault is decrypted and validated before anything is written. */
export function openFromGitHub(
  settings: SyncSettings,
  passphrase: string,
  allowOlder = false,
): Promise<{ key: CryptoKey; data: FinanceData; config: SyncConfig }> {
  return exclusive(async () => {
    const target = validateSyncSettings(settings);
    await checkRepoPrivate(target);
    const remote = await getRemoteContent(target);
    if (remote === null) {
      throw new SyncError("Aucun coffre trouvé dans ce dépôt.");
    }
    const { key, data } = await importVault(remote.raw, passphrase, allowOlder);
    const { savedAt } = envelopeInfo(remote.raw);
    const last = {
      lastSha: remote.sha,
      ...(savedAt === undefined ? {} : { lastSavedAt: savedAt }),
    };
    try {
      writeStored({
        version: 1,
        owner: target.owner,
        repo: target.repo,
        path: target.path,
        token: await sealSecret(key, target.token),
        ...last,
      });
    } catch {
      throw new SyncError(
        "Coffre restauré depuis GitHub, mais la synchronisation n’a pas pu être enregistrée sur cet appareil. Ouvrez le coffre puis configurez-la à nouveau.",
      );
    }
    return { key, data, config: { ...target, ...last } };
  });
}
