import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyData, type FinanceData } from "./domain/types";
import { resolveSyncInput } from "./components/SyncPanel";
import {
  configureSync,
  detectSyncRepos,
  disableSync,
  loadSyncConfig,
  loadSyncState,
  openFromGitHub,
  resolveConflict,
  syncNow,
  SyncError,
  SyncOfflineError,
  validateSyncSettings,
  VaultChangedError,
  VaultKeyMismatchError,
  type SyncConfig,
} from "./sync";
import {
  createVault,
  envelopeInfo,
  exportVault,
  importVault,
  saveVault,
  sealSecret,
  unlockVault,
  vaultExists,
} from "./vault";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
}

const PASSPHRASE = "Coffre test très privé 2026";
const TOKEN = "github_pat_FICTIF_0123456789abcdefghijklmnopqrstuvwxyz";
const OWNER = "elio-test";
const REPO = "coffre-prive";
const PATH = "finance-coffre.json";
const SETTINGS = { owner: OWNER, repo: REPO, token: TOKEN };
const SECRET_LABEL = "Compte confidentiel Lausanne";
const API = "https://api.github.com";
const RAW_ACCEPT = "application/vnd.github.raw+json";

const sample = (): FinanceData => ({
  ...emptyData(),
  accounts: [
    {
      id: "bank-test",
      name: SECRET_LABEL,
      institution: "Établissement fictif",
      kind: "bank",
      currency: "CHF",
      valuationMode: "total",
      source: { system: "manual" },
      balances: [
        {
          id: "balance-test",
          amountMinor: 125_050,
          asOf: "2026-09-17",
          source: { system: "manual" },
        },
      ],
    },
  ],
});
const variant = (baseCurrency: "EUR" | "USD"): FinanceData => ({
  ...sample(),
  preferences: { baseCurrency, locale: "fr-CH" },
});
const renamed = (name: string): FinanceData => {
  const data = sample();
  data.accounts[0] = { ...data.accounts[0], name };
  return data;
};

async function blobSha(raw: string): Promise<string> {
  const body = new TextEncoder().encode(raw);
  const header = new TextEncoder().encode(`blob ${body.byteLength}\0`);
  const bytes = new Uint8Array(header.byteLength + body.byteLength);
  bytes.set(header);
  bytes.set(body, header.byteLength);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

function utf8ToBase64(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text))
    binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToUtf8(value: string): string {
  return new TextDecoder().decode(
    Uint8Array.from(atob(value), (c) => c.charCodeAt(0)),
  );
}

function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

type Recorded = {
  method: string;
  url: string;
  headers: Headers;
  cache?: RequestCache;
  body?: string;
  status?: number;
};

/** In-memory GitHub REST API: repository metadata and contents with sha checks. */
class FakeGitHub {
  token = TOKEN;
  offline = false;
  inlineLimit = 1_000_000;
  forceStatus?: number;
  sizeOverride?: number;
  requests: Recorded[] = [];
  beforeContents?: () => Promise<void>;
  beforePut?: () => Promise<void>;
  private repos = new Map<string, { fullName: string; private: boolean }>();
  private files = new Map<string, { raw: string; sha: string }>();

  addRepo(owner: string, repo: string, isPrivate: boolean) {
    this.repos.set(`${owner}/${repo}`.toLowerCase(), {
      fullName: `${owner}/${repo}`,
      private: isPrivate,
    });
  }
  setPrivate(isPrivate: boolean) {
    this.repos.get(`${OWNER}/${REPO}`.toLowerCase())!.private = isPrivate;
  }
  file(path = PATH) {
    return this.files.get(`${OWNER}/${REPO}`.toLowerCase() + `:${path}`);
  }
  async setFile(raw: string, path = PATH) {
    this.files.set(`${OWNER}/${REPO}`.toLowerCase() + `:${path}`, {
      raw,
      sha: await blobSha(raw),
    });
  }
  puts() {
    return this.requests.filter((r) => r.method === "PUT");
  }
  rawReads() {
    return this.requests.filter((r) => r.headers.get("accept") === RAW_ACCEPT);
  }
  repoReads() {
    return this.requests.filter(
      (r) => r.method === "GET" && !r.url.includes("/contents/"),
    );
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const entry: Recorded = {
      method: init.method ?? "GET",
      url: String(input),
      headers: new Headers(init.headers),
      cache: init.cache,
      body: typeof init.body === "string" ? init.body : undefined,
    };
    this.requests.push(entry);
    if (this.offline) throw new TypeError("Failed to fetch");
    const response = await this.route(entry);
    entry.status = response.status;
    return response;
  };

  private async route(entry: Recorded): Promise<Response> {
    const url = new URL(entry.url);
    if (url.origin !== API) return json(404, { message: "Not Found" });
    if (this.forceStatus) return json(this.forceStatus, { message: "Forced" });
    if (entry.headers.get("authorization") !== `Bearer ${this.token}`) {
      return json(401, { message: "Bad credentials" });
    }
    const match = url.pathname.match(
      /^\/repos\/([^/]+)\/([^/]+)(?:\/contents\/(.+))?$/,
    );
    if (!match) return json(404, { message: "Not Found" });
    const repoKey =
      `${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}`.toLowerCase();
    const repo = this.repos.get(repoKey);
    if (!repo) return json(404, { message: "Not Found" });
    if (match[3] === undefined) {
      return json(200, { full_name: repo.fullName, private: repo.private });
    }
    const path = match[3].split("/").map(decodeURIComponent).join("/");
    const fileKey = `${repoKey}:${path}`;
    if (entry.method === "GET") {
      const hook = this.beforeContents;
      this.beforeContents = undefined;
      await hook?.();
      const file = this.files.get(fileKey);
      if (!file) return json(404, { message: "Not Found" });
      if (entry.headers.get("accept") === RAW_ACCEPT) {
        return new Response(file.raw, { status: 200 });
      }
      const size =
        this.sizeOverride ?? new TextEncoder().encode(file.raw).byteLength;
      if (size > this.inlineLimit) {
        return json(200, {
          type: "file",
          path,
          sha: file.sha,
          size,
          encoding: "none",
          content: "",
        });
      }
      const content = utf8ToBase64(file.raw).replace(/.{60}/g, "$&\n");
      return json(200, {
        type: "file",
        path,
        sha: file.sha,
        size,
        encoding: "base64",
        content,
      });
    }
    if (entry.method === "PUT") {
      const hook = this.beforePut;
      this.beforePut = undefined;
      await hook?.();
      const body = JSON.parse(entry.body ?? "{}");
      const existing = this.files.get(fileKey);
      if (existing && body.sha === undefined)
        return json(422, { message: "sha wasn't supplied" });
      if (existing && body.sha !== existing.sha)
        return json(409, { message: "does not match" });
      if (!existing && body.sha !== undefined)
        return json(422, { message: "sha for missing file" });
      const raw = base64ToUtf8(body.content);
      const sha = await blobSha(raw);
      this.files.set(fileKey, { raw, sha });
      return json(existing ? 200 : 201, {
        content: { path, sha },
        commit: { sha: "c".repeat(40) },
      });
    }
    return json(405, { message: "Method Not Allowed" });
  }
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("Échec attendu");
}

let fake: FakeGitHub;
let deviceA: MemoryStorage;
let deviceB: MemoryStorage;
function use(device: MemoryStorage) {
  vi.stubGlobal("localStorage", device);
}
function snapshot(device: MemoryStorage): Record<string, string> {
  const values: Record<string, string> = {};
  for (let i = 0; i < device.length; i++) {
    const key = device.key(i)!;
    values[key] = device.getItem(key)!;
  }
  return values;
}
function storedSync(device: MemoryStorage) {
  return JSON.parse(device.getItem("finance.sync.v1") ?? "null");
}

/** Device A creates and pushes; device B opens it from GitHub. Ends on device B. */
async function twoDevices(): Promise<{
  keyA: CryptoKey;
  configA: SyncConfig;
  keyB: CryptoKey;
  configB: SyncConfig;
}> {
  use(deviceA);
  const keyA = await createVault(PASSPHRASE, sample());
  const configA = await configureSync(keyA, SETTINGS);
  expect(await syncNow(keyA, configA)).toEqual({ status: "pushed" });
  use(deviceB);
  const b = await openFromGitHub(SETTINGS, PASSPHRASE);
  return { keyA, configA, keyB: b.key, configB: b.config };
}

beforeEach(() => {
  fake = new FakeGitHub();
  fake.addRepo(OWNER, REPO, true);
  deviceA = new MemoryStorage();
  deviceB = new MemoryStorage();
  use(deviceA);
  vi.stubGlobal("fetch", fake.fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("synchronisation GitHub du coffre chiffré", () => {
  it("premier envoi : seule l’enveloppe chiffrée part sur GitHub et le jeton reste scellé", async () => {
    const key = await createVault(PASSPHRASE, sample());
    const config = await configureSync(key, SETTINGS);
    expect(config).toEqual({
      owner: OWNER,
      repo: REPO,
      path: PATH,
      token: TOKEN,
    });
    expect(await syncNow(key, config)).toEqual({ status: "pushed" });

    const remote = fake.file()!;
    expect(remote.raw).toBe(exportVault());
    const envelope = JSON.parse(remote.raw);
    expect(envelope.format).toBe("Finance");
    expect(envelopeInfo(remote.raw).savedAt).toBe(envelope.savedAt);
    expect(remote.raw).not.toContain(SECRET_LABEL);
    expect(remote.raw).not.toContain("amountMinor");
    expect(remote.raw).not.toContain(TOKEN);
    for (const put of fake.puts()) {
      expect(put.body).not.toContain(TOKEN);
      const sent = base64ToUtf8(JSON.parse(put.body!).content);
      expect(sent).not.toContain(SECRET_LABEL);
      expect(JSON.parse(sent).format).toBe("Finance");
      expect(JSON.parse(put.body!).message).toBe("Finance : coffre chiffré");
    }

    for (const value of Object.values(snapshot(deviceA))) {
      expect(value).not.toContain(TOKEN);
    }
    const stored = storedSync(deviceA);
    expect(Object.keys(stored.token).sort()).toEqual(["ct", "iv"]);
    expect(stored).toMatchObject({
      version: 1,
      owner: OWNER,
      repo: REPO,
      path: PATH,
    });
    expect(stored.lastSha).toBe(remote.sha);
    expect(stored.lastSavedAt).toBe(envelope.savedAt);
    expect(config.lastSha).toBe(remote.sha);
    expect(await loadSyncConfig(key)).toEqual(config);

    for (const request of fake.requests) {
      expect(request.url.startsWith(`${API}/repos/${OWNER}/${REPO}`)).toBe(
        true,
      );
      expect(request.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
      expect(request.headers.get("accept")).toBe("application/vnd.github+json");
      expect(request.headers.get("x-github-api-version")).toBe("2022-11-28");
      expect(request.cache).toBe("no-store");
    }
  });

  it("reste à jour sans rien envoyer, puis envoie une modification locale", async () => {
    const key = await createVault(PASSPHRASE, sample());
    const config = await configureSync(key, SETTINGS);
    await syncNow(key, config);
    const puts = fake.puts().length;
    expect(await syncNow(key, config)).toEqual({ status: "up-to-date" });
    expect(fake.puts()).toHaveLength(puts);

    await saveVault(key, variant("EUR"));
    const repoReads = fake.repoReads().length;
    expect(await syncNow(key, config)).toEqual({ status: "pushed" });
    expect(fake.repoReads()).toHaveLength(repoReads + 1);
    expect(fake.file()!.raw).toBe(exportVault());
    expect(await loadSyncConfig(key)).toEqual(config);
    expect(await syncNow(key, config)).toEqual({ status: "up-to-date" });
  });

  it("ouvre le coffre sur un nouvel appareil et chaque appareil récupère les modifications de l’autre", async () => {
    const { keyA, configA, keyB, configB } = await twoDevices();
    expect(deviceB.getItem("finance.vault.v1")).toBe(fake.file()!.raw);
    expect(await syncNow(keyB, configB)).toEqual({ status: "up-to-date" });

    await saveVault(keyB, renamed("Compte modifié sur iPad"));
    expect(await syncNow(keyB, configB)).toEqual({ status: "pushed" });

    use(deviceA);
    const pulled = await syncNow(keyA, configA);
    expect(pulled).toEqual({
      status: "pulled",
      data: renamed("Compte modifié sur iPad"),
    });
    expect(exportVault()).toBe(fake.file()!.raw);
    expect(storedSync(deviceA).lastSha).toBe(fake.file()!.sha);
    expect(await loadSyncConfig(keyA)).toEqual(configA);
    expect((await unlockVault(PASSPHRASE)).data).toEqual(
      renamed("Compte modifié sur iPad"),
    );

    // The open session keeps working after the pull, and the change travels back.
    await saveVault(keyA, renamed("Compte modifié sur PC"));
    expect(await syncNow(keyA, configA)).toEqual({ status: "pushed" });
    use(deviceB);
    expect(await syncNow(keyB, configB)).toEqual({
      status: "pulled",
      data: renamed("Compte modifié sur PC"),
    });
  });

  it("signale un conflit quand les deux appareils ont changé, sans rien écrire nulle part", async () => {
    const { keyA, configA, keyB, configB } = await twoDevices();
    await saveVault(keyB, variant("USD"));
    expect(await syncNow(keyB, configB)).toEqual({ status: "pushed" });
    const remoteBefore = { ...fake.file()! };

    use(deviceA);
    await saveVault(keyA, variant("EUR"));
    const localBefore = snapshot(deviceA);
    const puts = fake.puts().length;
    const result = await syncNow(keyA, configA);
    expect(result).toEqual({
      status: "conflict",
      localSavedAt: envelopeInfo(exportVault()).savedAt,
      remoteSavedAt: envelopeInfo(remoteBefore.raw).savedAt,
      localSha: await blobSha(exportVault()),
      remoteSha: remoteBefore.sha,
    });
    expect(snapshot(deviceA)).toEqual(localBefore);
    expect(fake.file()).toEqual(remoteBefore);
    expect(fake.puts()).toHaveLength(puts);
    // Stable: asking again changes nothing either.
    expect((await syncNow(keyA, configA)).status).toBe("conflict");
    expect(snapshot(deviceA)).toEqual(localBefore);
  });

  it("résout un conflit en gardant le coffre distant", async () => {
    const { keyA, configA, keyB, configB } = await twoDevices();
    await saveVault(keyB, variant("USD"));
    await syncNow(keyB, configB);
    use(deviceA);
    await saveVault(keyA, variant("EUR"));
    expect((await syncNow(keyA, configA)).status).toBe("conflict");

    expect(await resolveConflict(keyA, configA, "remote")).toEqual({
      status: "pulled",
      data: variant("USD"),
    });
    expect(exportVault()).toBe(fake.file()!.raw);
    expect(await syncNow(keyA, configA)).toEqual({ status: "up-to-date" });
  });

  it("résout un conflit en gardant ce coffre, puis l’autre appareil le récupère", async () => {
    const { keyA, configA, keyB, configB } = await twoDevices();
    await saveVault(keyB, variant("USD"));
    await syncNow(keyB, configB);
    use(deviceA);
    await saveVault(keyA, variant("EUR"));
    expect((await syncNow(keyA, configA)).status).toBe("conflict");

    expect(await resolveConflict(keyA, configA, "local")).toEqual({
      status: "pushed",
    });
    expect(fake.file()!.raw).toBe(exportVault());
    use(deviceB);
    expect(await syncNow(keyB, configB)).toEqual({
      status: "pulled",
      data: variant("EUR"),
    });
  });

  /** A saves offline at 09:00, B saves and pushes at 10:00, then A comes back: conflict. */
  async function divergeWhileOffline() {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-05T08:00:00.000Z"));
    const devices = await twoDevices();
    use(deviceA);
    vi.setSystemTime(new Date("2026-09-05T09:00:00.000Z"));
    fake.offline = true;
    await saveVault(devices.keyA, variant("EUR"));
    await expect(syncNow(devices.keyA, devices.configA)).rejects.toBeInstanceOf(
      SyncOfflineError,
    );
    fake.offline = false;
    use(deviceB);
    vi.setSystemTime(new Date("2026-09-05T10:00:00.000Z"));
    await saveVault(devices.keyB, variant("USD"));
    expect(await syncNow(devices.keyB, devices.configB)).toEqual({
      status: "pushed",
    });
    use(deviceA);
    return devices;
  }

  it("après « garder ce coffre », l’autre appareil récupère cette version sans nouveau conflit", async () => {
    const { keyA, configA, keyB, configB } = await divergeWhileOffline();
    vi.setSystemTime(new Date("2026-09-05T11:00:00.000Z"));
    expect(await syncNow(keyA, configA)).toEqual({
      status: "conflict",
      localSavedAt: "2026-09-05T09:00:00.000Z",
      remoteSavedAt: "2026-09-05T10:00:00.000Z",
      localSha: await blobSha(exportVault()),
      remoteSha: fake.file()!.sha,
    });
    expect(await resolveConflict(keyA, configA, "local")).toEqual({
      status: "pushed",
    });
    expect(fake.file()!.raw).toBe(exportVault());
    expect(envelopeInfo(exportVault()).savedAt).toBe(
      "2026-09-05T11:00:00.000Z",
    );
    expect(configA.lastSavedAt).toBe("2026-09-05T11:00:00.000Z");
    expect(storedSync(deviceA).lastSavedAt).toBe("2026-09-05T11:00:00.000Z");

    use(deviceB);
    expect(await syncNow(keyB, configB)).toEqual({
      status: "pulled",
      data: variant("EUR"),
    });
    use(deviceA);
    expect(await syncNow(keyA, configA)).toEqual({ status: "up-to-date" });
    expect((await unlockVault(PASSPHRASE)).data).toEqual(variant("EUR"));
  });

  it("la version gardée reste datée après celle qu’elle remplace même si l’horloge de cet appareil retarde", async () => {
    const { keyA, configA, keyB, configB } = await divergeWhileOffline();
    vi.setSystemTime(new Date("2026-09-05T09:58:00.000Z"));
    expect((await syncNow(keyA, configA)).status).toBe("conflict");
    expect(await resolveConflict(keyA, configA, "local")).toEqual({
      status: "pushed",
    });
    expect(envelopeInfo(fake.file()!.raw).savedAt).toBe(
      "2026-09-05T10:00:00.001Z",
    );
    use(deviceB);
    expect(await syncNow(keyB, configB)).toEqual({
      status: "pulled",
      data: variant("EUR"),
    });
  });

  it("« garder ce coffre » n’envoie que l’instantané lu : une sauvegarde intercalée l’arrête sans rien écrire", async () => {
    const { keyA, configA } = await divergeWhileOffline();
    expect((await syncNow(keyA, configA)).status).toBe("conflict");
    const remote = { ...fake.file()! };
    const puts = fake.puts().length;
    let savedDuringResolve = "";
    fake.beforeContents = async () => {
      await saveVault(keyA, renamed("Saisie intercalée"));
      savedDuringResolve = exportVault();
    };
    await expect(
      resolveConflict(keyA, configA, "local"),
    ).rejects.toBeInstanceOf(VaultChangedError);
    expect(exportVault()).toBe(savedDuringResolve);
    expect(fake.file()).toEqual(remote);
    expect(fake.puts()).toHaveLength(puts);
  });

  it("une modification locale faite pendant la synchronisation n’est jamais écrasée par le tirage", async () => {
    const { keyA, configA, keyB, configB } = await twoDevices();
    await saveVault(keyB, variant("USD"));
    await syncNow(keyB, configB);

    use(deviceA);
    const shaBefore = storedSync(deviceA).lastSha;
    let savedDuringSync = "";
    // The save lands after syncNow read the local snapshot, while it waits for GitHub.
    fake.beforeContents = async () => {
      await saveVault(keyA, variant("EUR"));
      savedDuringSync = exportVault();
    };
    await expect(syncNow(keyA, configA)).rejects.toBeInstanceOf(
      VaultChangedError,
    );
    expect(exportVault()).toBe(savedDuringSync);
    expect(storedSync(deviceA).lastSha).toBe(shaBefore);
    expect(configA.lastSha).toBe(shaBefore);
    // Retrying now sees both sides changed: a conflict, still without any write.
    expect((await syncNow(keyA, configA)).status).toBe("conflict");
    expect(exportVault()).toBe(savedDuringSync);
    expect((await unlockVault(PASSPHRASE)).data).toEqual(variant("EUR"));
  });

  it("une sauvegarde qui aboutit pendant le déchiffrement du distant gagne aussi", async () => {
    const { keyA, configA, keyB, configB } = await twoDevices();
    await saveVault(keyB, variant("USD"));
    await syncNow(keyB, configB);

    use(deviceA);
    let savedDuringSync = "";
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "decrypt").mockImplementationOnce(
      async (...args) => {
        await saveVault(keyA, variant("EUR"));
        savedDuringSync = exportVault();
        return decrypt(...args);
      },
    );
    await expect(syncNow(keyA, configA)).rejects.toBeInstanceOf(
      VaultChangedError,
    );
    expect(exportVault()).toBe(savedDuringSync);
    await saveVault(keyA, variant("EUR"));
  });

  it("relit le distant quand GitHub refuse un sha périmé pendant l’envoi, puis signale le conflit", async () => {
    const { keyA, configA, keyB } = await twoDevices();
    await saveVault(keyB, variant("USD"));
    const rawB = exportVault();

    use(deviceA);
    await saveVault(keyA, variant("EUR"));
    const localBefore = snapshot(deviceA);
    fake.beforePut = () => fake.setFile(rawB);
    const result = await syncNow(keyA, configA);
    expect(result.status).toBe("conflict");
    expect(fake.puts().map((put) => put.status)).toEqual([201, 409]);
    expect(fake.file()!.raw).toBe(rawB);
    expect(snapshot(deviceA)).toEqual(localBefore);
  });

  it("ne tire pas un distant plus ancien que la dernière version synchronisée (lecture en retard)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-01T10:00:00.000Z"));
    const key = await createVault(PASSPHRASE, sample());
    const config = await configureSync(key, SETTINGS);
    await syncNow(key, config);
    const older = exportVault();
    vi.setSystemTime(new Date("2026-09-02T10:00:00.000Z"));
    await saveVault(key, variant("EUR"));
    await syncNow(key, config);

    await fake.setFile(older);
    const before = snapshot(deviceA);
    expect(await syncNow(key, config)).toEqual({
      status: "conflict",
      localSavedAt: "2026-09-02T10:00:00.000Z",
      remoteSavedAt: "2026-09-01T10:00:00.000Z",
      localSha: await blobSha(exportVault()),
      remoteSha: fake.file()!.sha,
    });
    expect(snapshot(deviceA)).toEqual(before);
  });

  it("détecte une modification locale non envoyée même avec un horodatage identique", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-03T08:00:00.000Z"));
    const { keyA, configA, keyB, configB } = await twoDevices();
    await saveVault(keyB, variant("USD"));
    await syncNow(keyB, configB);
    use(deviceA);
    await saveVault(keyA, variant("EUR"));
    expect(envelopeInfo(exportVault()).savedAt).toBe(configA.lastSavedAt);
    const before = snapshot(deviceA);
    expect((await syncNow(keyA, configA)).status).toBe("conflict");
    expect(snapshot(deviceA)).toEqual(before);
  });

  it("mauvaise phrase secrète sur un nouvel appareil : rien n’est écrit", async () => {
    await twoDevices();
    const deviceC = new MemoryStorage();
    use(deviceC);
    await expect(
      openFromGitHub(SETTINGS, "Une mauvaise phrase secrète"),
    ).rejects.toThrow("Impossible d’ouvrir le coffre");
    expect(deviceC.length).toBe(0);
    expect(vaultExists()).toBe(false);

    // An existing, different vault on the device survives the failed attempt untouched.
    await createVault("Un autre coffre très privé", emptyData());
    const before = snapshot(deviceC);
    await expect(
      openFromGitHub(SETTINGS, "Une mauvaise phrase secrète"),
    ).rejects.toThrow("Impossible d’ouvrir le coffre");
    expect(snapshot(deviceC)).toEqual(before);
  });

  it("refuse un nouvel appareil quand le dépôt ne contient aucun coffre", async () => {
    await expect(openFromGitHub(SETTINGS, PASSPHRASE)).rejects.toThrow(
      "Aucun coffre trouvé dans ce dépôt",
    );
    expect(deviceA.length).toBe(0);
  });

  it("refuse un dépôt public, y compris s’il le devient après la configuration", async () => {
    const key = await createVault(PASSPHRASE, sample());
    fake.addRepo(OWNER, "public", false);
    await expect(
      configureSync(key, { ...SETTINGS, repo: "public" }),
    ).rejects.toThrow("Le dépôt doit être privé");
    await expect(
      openFromGitHub({ ...SETTINGS, repo: "public" }, PASSPHRASE),
    ).rejects.toThrow("Le dépôt doit être privé");
    expect(deviceA.getItem("finance.sync.v1")).toBeNull();

    const config = await configureSync(key, SETTINGS);
    fake.setPrivate(false);
    await expect(syncNow(key, config)).rejects.toThrow(
      "Le dépôt doit être privé",
    );
    expect(fake.puts()).toHaveLength(0);
    expect(fake.file()).toBeUndefined();

    // Nothing to send is no excuse: a repository made public is reported at once, before any read.
    fake.setPrivate(true);
    expect(await syncNow(key, config)).toEqual({ status: "pushed" });
    expect(await syncNow(key, config)).toEqual({ status: "up-to-date" });
    fake.setPrivate(false);
    const contentReads = fake.requests.filter((r) =>
      r.url.includes("/contents/"),
    ).length;
    await expect(syncNow(key, config)).rejects.toThrow(
      "Le dépôt doit être privé",
    );
    await expect(resolveConflict(key, config, "local")).rejects.toThrow(
      "Le dépôt doit être privé",
    );
    expect(
      fake.requests.filter((r) => r.url.includes("/contents/")),
    ).toHaveLength(contentReads);
  });

  it("refuse le dépôt du code de l’application, quelle que soit la casse, sans requête", async () => {
    const key = await createVault(PASSPHRASE, sample());
    for (const [owner, repo] of [
      ["Mendestrading21", "Finances"],
      ["mendestrading21", "FINANCES"],
      ["MENDESTRADING21", "finance1"],
      ["Mendestrading21", "FINANCE1"],
    ]) {
      await expect(
        configureSync(key, { owner, repo, token: TOKEN }),
      ).rejects.toThrow(
        "Choisissez un dépôt privé distinct du code de l’application",
      );
      await expect(
        openFromGitHub({ owner, repo, token: TOKEN }, PASSPHRASE),
      ).rejects.toThrow("distinct du code");
    }
    expect(fake.requests).toHaveLength(0);
    expect(deviceA.getItem("finance.sync.v1")).toBeNull();
  });

  it("valide strictement les réglages avant toute requête", async () => {
    expect(
      validateSyncSettings({
        owner: ` ${OWNER} `,
        repo: `${REPO}\n`,
        path: " ",
        token: ` ${TOKEN}\n`,
      }),
    ).toEqual({ owner: OWNER, repo: REPO, path: PATH, token: TOKEN });
    expect(
      validateSyncSettings({
        ...SETTINGS,
        path: "sauvegardes/mon.coffre_1.json",
      }).path,
    ).toBe("sauvegardes/mon.coffre_1.json");
    const invalid = [
      { ...SETTINGS, owner: "" },
      { ...SETTINGS, owner: "a/b" },
      { ...SETTINGS, owner: ".." },
      { ...SETTINGS, owner: "a b" },
      { ...SETTINGS, owner: "x".repeat(101) },
      { ...SETTINGS, repo: "." },
      { ...SETTINGS, repo: "dépôt" },
      { ...SETTINGS, path: "/absolu.json" },
      { ...SETTINGS, path: "a/../b.json" },
      { ...SETTINGS, path: "a//b.json" },
      { ...SETTINGS, path: "dossier/" },
      { ...SETTINGS, path: "./coffre.json" },
      { ...SETTINGS, path: "coffre?.json" },
      { ...SETTINGS, path: `${"a".repeat(201)}` },
      { ...SETTINGS, token: "trop-court" },
      { ...SETTINGS, token: "github_pat avec un espace dedans" },
      { ...SETTINGS, token: "x".repeat(256) },
      { ...SETTINGS, token: `${TOKEN}é` },
      { ...SETTINGS, token: "ghp_0123456789abcdefghijklmnopqrstuvwxyz" },
      null,
    ];
    const key = await createVault(PASSPHRASE, sample());
    for (const settings of invalid) {
      expect(() => validateSyncSettings(settings as never)).toThrow(SyncError);
      const failure = await rejection(configureSync(key, settings as never));
      expect(failure).toBeInstanceOf(SyncError);
      expect(failure.message).not.toContain(TOKEN);
    }
    expect(() =>
      validateSyncSettings({
        ...SETTINGS,
        token: "ghp_0123456789abcdefghijklmnopqrstuvwxyz",
      }),
    ).toThrow(
      "Utilisez un jeton « fine-grained » (il commence par github_pat_), limité à ce seul dépôt.",
    );
    expect(fake.requests).toHaveLength(0);
    expect(deviceA.getItem("finance.sync.v1")).toBeNull();
  });

  it("donne des erreurs claires pour un jeton refusé, des droits insuffisants ou un dépôt introuvable", async () => {
    const key = await createVault(PASSPHRASE, sample());
    fake.token = "github_pat_UN_AUTRE_JETON_valide_0123456789";
    const refused = await rejection(configureSync(key, SETTINGS));
    expect(refused.message).toContain("Jeton GitHub refusé");
    expect(refused.message).not.toContain(TOKEN);
    fake.token = TOKEN;
    await expect(
      configureSync(key, { ...SETTINGS, repo: "inconnu" }),
    ).rejects.toThrow("Dépôt introuvable");
    fake.forceStatus = 403;
    await expect(configureSync(key, SETTINGS)).rejects.toThrow(
      "Droits insuffisants",
    );
    expect(deviceA.getItem("finance.sync.v1")).toBeNull();
  });

  it("récupère un coffre de plus de 1 Mo par le contenu brut quand GitHub n’envoie pas de contenu", async () => {
    const attachment = {
      id: "piece-lourde",
      name: "Justificatif fictif.txt",
      mimeType: "text/plain" as const,
      dataUrl: `data:text/plain;base64,${btoa("FICTIF ".repeat(130_000))}`,
      addedAt: "2026-09-17T12:00:00.000Z",
      source: { system: "manual" as const },
    };
    const large: FinanceData = { ...sample(), documents: [attachment] };
    const key = await createVault(PASSPHRASE, large);
    const config = await configureSync(key, SETTINGS);
    const timers = vi.spyOn(globalThis, "setTimeout");
    await syncNow(key, config);
    expect(
      new TextEncoder().encode(fake.file()!.raw).byteLength,
    ).toBeGreaterThan(1_000_000);
    const putBody = fake.puts().at(-1)!.body!;
    const putDelay = 60_000 + Math.ceil(putBody.length / 50_000) * 1_000;
    expect(putDelay).toBeGreaterThan(60_000);
    expect(timers.mock.calls.map(([, delay]) => delay)).toContain(putDelay);

    // An unchanged large vault is never downloaded again.
    for (let i = 0; i < 3; i++) {
      expect(await syncNow(key, config)).toEqual({ status: "up-to-date" });
    }
    expect(fake.rawReads()).toHaveLength(0);

    use(deviceB);
    const opened = await openFromGitHub(SETTINGS, PASSPHRASE);
    expect(opened.data).toEqual(large);
    const reads = fake.requests.filter(
      (r) => r.method === "GET" && r.url.includes("/contents/"),
    );
    expect(reads.at(-1)!.headers.get("accept")).toBe(RAW_ACCEPT);
    expect(fake.rawReads()).toHaveLength(1);
    expect(await syncNow(opened.key, opened.config)).toEqual({
      status: "up-to-date",
    });
    expect(fake.rawReads()).toHaveLength(1);
  });

  it("refuse un fichier distant de plus de 25 Mo avant de le télécharger", async () => {
    const key = await createVault(PASSPHRASE, sample());
    const config = await configureSync(key, SETTINGS);
    await syncNow(key, config);
    await fake.setFile(exportVault().replace("}", " }"));
    fake.inlineLimit = 0;
    fake.sizeOverride = 25_000_001;
    const before = snapshot(deviceA);
    await expect(syncNow(key, config)).rejects.toThrow(
      "Le fichier distant est trop volumineux pour un coffre Finance. Rien n’a été modifié.",
    );
    await expect(openFromGitHub(SETTINGS, PASSPHRASE)).rejects.toThrow(
      "trop volumineux",
    );
    expect(fake.rawReads()).toHaveLength(0);
    expect(snapshot(deviceA)).toEqual(before);
  });

  it("hors ligne : erreur dédiée, rien n’est cassé, puis reprise", async () => {
    const key = await createVault(PASSPHRASE, sample());
    const config = await configureSync(key, SETTINGS);
    await syncNow(key, config);
    await saveVault(key, variant("EUR"));
    const before = snapshot(deviceA);
    const remote = { ...fake.file()! };

    fake.offline = true;
    const failure = await rejection(syncNow(key, config));
    expect(failure).toBeInstanceOf(SyncOfflineError);
    expect(failure.message).toBe(
      "Hors ligne : la synchronisation reprendra plus tard.",
    );
    expect(failure.message).not.toContain(TOKEN);
    expect(snapshot(deviceA)).toEqual(before);
    expect(fake.file()).toEqual(remote);
    await expect(configureSync(key, SETTINGS)).rejects.toBeInstanceOf(
      SyncOfflineError,
    );
    expect(snapshot(deviceA)).toEqual(before);

    fake.offline = false;
    expect(await syncNow(key, config)).toEqual({ status: "pushed" });
    expect(fake.file()!.raw).toBe(exportVault());
  });

  it("coffre étranger : signalé sans rien écrire, « local » ne l’écrase qu’avec replaceForeign", async () => {
    use(deviceA);
    const keyA = await createVault(PASSPHRASE, sample());
    const configA = await configureSync(keyA, SETTINGS);
    await syncNow(keyA, configA);

    // Device D creates its own vault separately (new salt), then links the same repository.
    const deviceD = new MemoryStorage();
    use(deviceD);
    const keyD = await createVault(PASSPHRASE, variant("USD"));
    const configD = await configureSync(keyD, SETTINGS);
    const remoteA = { ...fake.file()! };
    const beforeD = snapshot(deviceD);
    const shown = await syncNow(keyD, configD);
    expect(shown).toEqual({
      status: "foreign",
      remoteSha: remoteA.sha,
      remoteSavedAt: envelopeInfo(remoteA.raw).savedAt,
    });
    expect(await resolveConflict(keyD, configD, "local")).toEqual(shown);
    const mismatch = await rejection(resolveConflict(keyD, configD, "remote"));
    expect(mismatch).toBeInstanceOf(VaultKeyMismatchError);
    expect(mismatch.message).toContain(
      "Exportez d’abord une sauvegarde chiffrée de ce coffre : l’ouvrir depuis GitHub le remplacera.",
    );
    expect(fake.file()).toEqual(remoteA);
    expect(snapshot(deviceD)).toEqual(beforeD);

    // A writes again after D was shown the foreign vault: D's replacement no longer applies.
    use(deviceA);
    await saveVault(keyA, variant("EUR"));
    expect(await syncNow(keyA, configA)).toEqual({ status: "pushed" });
    const remoteA2 = { ...fake.file()! };
    use(deviceD);
    expect(
      await resolveConflict(keyD, configD, "local", {
        replaceForeign: true,
        expected: { remoteSha: remoteA.sha },
      }),
    ).toEqual({
      status: "foreign",
      remoteSha: remoteA2.sha,
      remoteSavedAt: envelopeInfo(remoteA2.raw).savedAt,
    });
    expect(fake.file()).toEqual(remoteA2);
    expect(snapshot(deviceD)).toEqual(beforeD);

    // Explicit replacement of what was just shown.
    expect(
      await resolveConflict(keyD, configD, "local", {
        replaceForeign: true,
        expected: { remoteSha: remoteA2.sha },
      }),
    ).toEqual({ status: "pushed" });
    expect(fake.file()!.raw).toBe(exportVault());

    // A now sees a foreign vault: never pulled, "remote" refused, nothing modified.
    use(deviceA);
    const beforeA = snapshot(deviceA);
    expect((await syncNow(keyA, configA)).status).toBe("foreign");
    await expect(
      resolveConflict(keyA, configA, "remote"),
    ).rejects.toBeInstanceOf(VaultKeyMismatchError);
    expect(snapshot(deviceA)).toEqual(beforeA);

    const reopened = await openFromGitHub(SETTINGS, PASSPHRASE);
    expect(reopened.data).toEqual(variant("USD"));
    expect(await syncNow(reopened.key, reopened.config)).toEqual({
      status: "up-to-date",
    });
  });

  it("le choix s’applique à ce qui a été montré : un changement depuis l’affichage donne un nouveau conflit, sans écriture", async () => {
    const { keyA, configA, keyB, configB } = await twoDevices();
    await saveVault(keyB, variant("USD"));
    await syncNow(keyB, configB);
    use(deviceA);
    await saveVault(keyA, variant("EUR"));
    const shown = await syncNow(keyA, configA);
    if (shown.status !== "conflict") throw new Error("Conflit attendu");
    expect(shown.localSha).toBe(await blobSha(exportVault()));
    expect(shown.remoteSha).toBe(fake.file()!.sha);

    // B writes again while A's conflict is on screen.
    use(deviceB);
    await saveVault(keyB, renamed("Encore modifié sur iPad"));
    expect(await syncNow(keyB, configB)).toEqual({ status: "pushed" });
    use(deviceA);
    const remote = { ...fake.file()! };
    const before = snapshot(deviceA);
    const puts = fake.puts().length;
    for (const choice of ["local", "remote"] as const) {
      expect(
        await resolveConflict(keyA, configA, choice, {
          expected: { localSha: shown.localSha, remoteSha: shown.remoteSha },
        }),
      ).toEqual({
        status: "conflict",
        localSha: shown.localSha,
        remoteSha: remote.sha,
        localSavedAt: shown.localSavedAt,
        remoteSavedAt: envelopeInfo(remote.raw).savedAt,
      });
      expect(snapshot(deviceA)).toEqual(before);
      expect(fake.file()).toEqual(remote);
      expect(fake.puts()).toHaveLength(puts);
    }

    // A local change since the display is detected the same way.
    await saveVault(keyA, renamed("Encore modifié sur PC"));
    const afterLocal = snapshot(deviceA);
    const fresh = await resolveConflict(keyA, configA, "remote", {
      expected: { localSha: shown.localSha, remoteSha: remote.sha },
    });
    if (fresh.status !== "conflict") throw new Error("Conflit attendu");
    expect(fresh.localSha).toBe(await blobSha(exportVault()));
    expect(snapshot(deviceA)).toEqual(afterLocal);

    // The choice applied to the fresh situation goes through.
    expect(
      await resolveConflict(keyA, configA, "remote", {
        expected: { localSha: fresh.localSha, remoteSha: fresh.remoteSha },
      }),
    ).toEqual({ status: "pulled", data: renamed("Encore modifié sur iPad") });
  });

  it("demande de reconfigurer quand le jeton ne se déchiffre plus avec le coffre restauré", async () => {
    const key = await createVault(PASSPHRASE, sample());
    await configureSync(key, SETTINGS);
    expect((await loadSyncState(key)).state).toBe("ready");

    const deviceX = new MemoryStorage();
    use(deviceX);
    await createVault(PASSPHRASE, variant("USD"));
    const otherBackup = exportVault();
    use(deviceA);
    const restored = await importVault(otherBackup, PASSPHRASE, true);

    expect(await loadSyncState(restored.key)).toEqual({ state: "reconfigure" });
    expect(await loadSyncConfig(restored.key)).toBeNull();
    expect(deviceA.getItem("finance.sync.v1")).not.toContain(TOKEN);

    await configureSync(restored.key, SETTINGS);
    expect((await loadSyncState(restored.key)).state).toBe("ready");
    disableSync();
    expect(await loadSyncState(restored.key)).toEqual({ state: "off" });
    expect(deviceA.getItem("finance.sync.v1")).toBeNull();
    expect(vaultExists()).toBe(true);
  });

  it("traite une configuration stockée altérée comme à reconfigurer, sans l’effacer", async () => {
    const key = await createVault(PASSPHRASE, sample());
    await configureSync(key, SETTINGS);
    const stored = storedSync(deviceA);
    for (const altered of [
      "{",
      JSON.stringify({ ...stored, owner: ".." }),
      JSON.stringify({ ...stored, extra: true }),
      JSON.stringify({ ...stored, token: { ...stored.token, ct: "AAAA" } }),
      JSON.stringify({
        ...stored,
        token: await sealSecret(
          key,
          "ghp_0123456789abcdefghijklmnopqrstuvwxyz",
        ),
      }),
    ]) {
      deviceA.setItem("finance.sync.v1", altered);
      expect(await loadSyncState(key)).toEqual({ state: "reconfigure" });
      expect(deviceA.getItem("finance.sync.v1")).toBe(altered);
    }
  });
});

describe("détection du dépôt depuis la seule clé", () => {
  type Repo = { name: string; private: boolean; owner: { login: string } };
  function stubGitHub(login: string, repos: Repo[]) {
    const calls: { url: string; auth: string | null }[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const auth = new Headers(init.headers).get("authorization");
      calls.push({ url: String(input), auth });
      if (auth !== `Bearer ${TOKEN}`) return json(401, { message: "Bad credentials" });
      if (url.pathname === "/user") return json(200, { login });
      if (url.pathname === "/user/repos") return json(200, repos);
      return json(404, { message: "Not Found" });
    });
    return calls;
  }
  const own = (name: string, isPrivate = true, login = OWNER): Repo => ({
    name,
    private: isPrivate,
    owner: { login },
  });

  it("ne garde que les dépôts privés du titulaire, hors dépôts de l’application", async () => {
    const calls = stubGitHub("Mendestrading21", [
      own("finance-coffre", true, "Mendestrading21"),
      own("public-notes", false, "Mendestrading21"),
      own("coffre-orga", true, "une-orga"),
      own("Finances", true, "Mendestrading21"),
      own("FINANCE1", true, "Mendestrading21"),
      { name: "../evil", private: true, owner: { login: "Mendestrading21" } },
    ]);
    expect(await detectSyncRepos(`  ${TOKEN}  `)).toEqual({
      owner: "Mendestrading21",
      repos: ["finance-coffre"],
    });
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(["/user", "/user/repos"]);
    const list = new URL(calls[1].url).searchParams;
    expect(list.get("visibility")).toBe("private");
    expect(list.get("affiliation")).toBe("owner");
    expect(calls.every((c) => c.url.startsWith(`${API}/`))).toBe(true);
  });

  it("refuse une clé mal formée sans rien envoyer", async () => {
    const calls = stubGitHub(OWNER, []);
    const error = await rejection(detectSyncRepos("mot-de-passe"));
    expect(error).toBeInstanceOf(SyncError);
    expect(calls).toHaveLength(0);
  });

  it("refuse une réponse inattendue plutôt que d’inventer un propriétaire", async () => {
    stubGitHub("../pas-un-nom", [own(REPO)]);
    expect(await rejection(detectSyncRepos(TOKEN))).toBeInstanceOf(SyncError);
  });

  it("choisit finance-coffre, sinon le seul dépôt privé, sinon demande lequel", async () => {
    const input = { owner: "", repo: "", path: PATH, token: TOKEN };
    stubGitHub(OWNER, [own("autre"), own("finance-coffre")]);
    expect(await resolveSyncInput(input)).toEqual({
      ...input,
      owner: OWNER,
      repo: "finance-coffre",
    });
    stubGitHub(OWNER, [own(REPO)]);
    expect(await resolveSyncInput(input)).toEqual({ ...input, owner: OWNER, repo: REPO });
    stubGitHub(OWNER, [own("un"), own("deux")]);
    expect((await rejection(resolveSyncInput(input))).message).toMatch(
      /Plusieurs dépôts privés.*un, deux/,
    );
    stubGitHub(OWNER, []);
    expect((await rejection(resolveSyncInput(input))).message).toMatch(
      /Aucun dépôt privé/,
    );
  });

  it("respecte les options avancées sans deviner le dépôt d’un autre propriétaire", async () => {
    const calls = stubGitHub(OWNER, [own(REPO)]);
    const full = { owner: "une-orga", repo: "coffre", path: PATH, token: TOKEN };
    expect(await resolveSyncInput(full)).toBe(full);
    expect(calls).toHaveLength(0);
    expect(
      await resolveSyncInput({ owner: "", repo: "choisi", path: PATH, token: TOKEN }),
    ).toEqual({ owner: OWNER, repo: "choisi", path: PATH, token: TOKEN });
    expect(
      (await rejection(resolveSyncInput({ owner: "une-orga", repo: "", path: PATH, token: TOKEN })))
        .message,
    ).toMatch(/Indiquez aussi le dépôt de une-orga/);
  });
});
