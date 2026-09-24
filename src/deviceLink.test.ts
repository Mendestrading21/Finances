import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyData, type FinanceData } from "./domain/types";
import {
  createDeviceLink,
  openFromDeviceLink,
  readDeviceLink,
  type DeviceLink,
} from "./deviceLink";
import {
  configureSync,
  loadSyncState,
  syncNow,
  SyncError,
  type SyncConfig,
} from "./sync";
import {
  createVault,
  deriveVaultKey,
  envelopeInfo,
  exportVault,
  openVaultKeyInfo,
  saveVault,
  sealSecret,
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
const API = "https://api.github.com";
const ORIGIN = "https://finance.test";
const PAGE = "/Finances/";
const INVALID = "Ce code d'ajout n'est pas valide.";
const WRONG = "Phrase secrète incorrecte pour ce code.";

const sample = (): FinanceData => ({
  ...emptyData(),
  accounts: [
    {
      id: "bank-test",
      name: "Compte confidentiel Lausanne",
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

function toBase64Url(text: string): string {
  return utf8ToBase64(text)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(value: string): string {
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  return base64ToUtf8(standard + "=".repeat((4 - (standard.length % 4)) % 4));
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Minimal in-memory GitHub (repository metadata, contents read and write with sha checks), as in sync.test.ts. */
class FakeGitHub {
  requests: { method: string; url: string }[] = [];
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
  file() {
    return this.files.get(`${OWNER}/${REPO}`.toLowerCase() + `:${PATH}`);
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const url = new URL(String(input));
    this.requests.push({ method, url: String(input) });
    const headers = new Headers(init.headers);
    if (url.origin !== API) return json(404, { message: "Not Found" });
    if (headers.get("authorization") !== `Bearer ${TOKEN}`) {
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
    const existing = this.files.get(fileKey);
    if (method === "GET") {
      if (!existing) return json(404, { message: "Not Found" });
      return json(200, {
        type: "file",
        path,
        sha: existing.sha,
        size: new TextEncoder().encode(existing.raw).byteLength,
        encoding: "base64",
        content: utf8ToBase64(existing.raw),
      });
    }
    if (method === "PUT") {
      const body = JSON.parse(String(init.body ?? "{}"));
      if (existing && body.sha !== existing.sha)
        return json(409, { message: "does not match" });
      if (!existing && body.sha !== undefined)
        return json(422, { message: "sha for missing file" });
      const raw = base64ToUtf8(body.content);
      const sha = await blobSha(raw);
      this.files.set(fileKey, { raw, sha });
      return json(existing ? 200 : 201, { content: { path, sha } });
    }
    return json(405, { message: "Method Not Allowed" });
  };
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

/** Device A creates its vault, turns sync on, pushes, then creates the link. Ends on device B. */
async function linkFromDeviceA(): Promise<{
  keyA: CryptoKey;
  configA: SyncConfig;
  code: string;
  url: string;
}> {
  use(deviceA);
  const keyA = await createVault(PASSPHRASE, sample());
  const configA = await configureSync(keyA, SETTINGS);
  expect(await syncNow(keyA, configA)).toEqual({ status: "pushed" });
  const { code, url } = await createDeviceLink(keyA, configA);
  use(deviceB);
  return { keyA, configA, code, url };
}

beforeEach(() => {
  fake = new FakeGitHub();
  fake.addRepo(OWNER, REPO, true);
  deviceA = new MemoryStorage();
  deviceB = new MemoryStorage();
  use(deviceA);
  vi.stubGlobal("fetch", fake.fetch);
  vi.stubGlobal("location", {
    origin: ORIGIN,
    pathname: PAGE,
    hostname: "finance.test",
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ajouter un appareil par un lien", () => {
  it("aller-retour : le nouvel appareil n’a besoin que du lien et de la phrase secrète", async () => {
    const { keyA, configA, code, url } = await linkFromDeviceA();
    expect(code.startsWith("FIN1.")).toBe(true);
    expect(url).toBe(`${ORIGIN}${PAGE}#ajouter=${code}`);
    const parsed = new URL(url);
    expect(parsed.search).toBe("");
    expect(parsed.hash).toBe(`#ajouter=${code}`);

    // Nothing readable travels: no token, owner, repository or path, even once decoded.
    const payload = JSON.parse(fromBase64Url(code.slice("FIN1.".length)));
    expect(Object.keys(payload)).toEqual([
      "v",
      "salt",
      "iterations",
      "iv",
      "ct",
    ]);
    expect(payload.v).toBe(1);
    use(deviceA);
    expect({ salt: payload.salt, iterations: payload.iterations }).toEqual(
      openVaultKeyInfo(keyA),
    );
    expect(openVaultKeyInfo(keyA).salt).toBe(envelopeInfo(exportVault()).salt);
    use(deviceB);
    for (const text of [code, url, JSON.stringify(payload)]) {
      for (const secret of [TOKEN, OWNER, REPO, PATH, "github_pat_"]) {
        expect(text).not.toContain(secret);
      }
    }
    // A fresh IV each time: two links for the same settings differ.
    use(deviceA);
    expect((await createDeviceLink(keyA, configA)).code).not.toBe(code);
    use(deviceB);

    expect(vaultExists()).toBe(false);
    const opened = await openFromDeviceLink(readDeviceLink(url), PASSPHRASE);
    expect(opened.data).toEqual(sample());
    expect(opened.config).toEqual({
      owner: OWNER,
      repo: REPO,
      path: PATH,
      token: TOKEN,
      lastSha: fake.file()!.sha,
      lastSavedAt: envelopeInfo(fake.file()!.raw).savedAt,
    });
    expect(deviceB.getItem("finance.vault.v1")).toBe(fake.file()!.raw);
    for (const value of Object.values(snapshot(deviceB))) {
      expect(value).not.toContain(TOKEN);
    }
    expect((await loadSyncState(opened.key)).state).toBe("ready");
    expect(await syncNow(opened.key, opened.config)).toEqual({
      status: "up-to-date",
    });

    // Both devices keep syncing with each other afterwards.
    await saveVault(opened.key, emptyData());
    expect(await syncNow(opened.key, opened.config)).toEqual({
      status: "pushed",
    });
    use(deviceA);
    expect(await syncNow(keyA, configA)).toEqual({
      status: "pulled",
      data: emptyData(),
    });
  });

  it("accepte l’URL complète (même d’une autre origine), le fragment ou le code seul", async () => {
    const { code, url } = await linkFromDeviceA();
    const expected = readDeviceLink(code);
    for (const input of [
      url,
      url.replace(ORIGIN, "http://localhost:4173"),
      `  ${url}\n`,
      `#ajouter=${code}`,
      `ajouter=${code}`,
      ` ${code} `,
    ]) {
      expect(readDeviceLink(input)).toEqual(expected);
    }
    expect(Object.isFrozen(expected)).toBe(true);
  });

  it("mauvaise phrase secrète : rien n’est écrit et GitHub n’est pas contacté", async () => {
    const { url } = await linkFromDeviceA();
    const link = readDeviceLink(url);
    const requests = fake.requests.length;
    for (const passphrase of [
      "Une mauvaise phrase secrète",
      "",
      "x".repeat(1_025),
    ]) {
      await expect(openFromDeviceLink(link, passphrase)).rejects.toThrow(WRONG);
    }
    expect(deviceB.length).toBe(0);
    expect(fake.requests).toHaveLength(requests);

    // An existing, different vault on the device survives the failed attempt untouched.
    await createVault("Un autre coffre très privé", emptyData());
    const before = snapshot(deviceB);
    await expect(
      openFromDeviceLink(link, "Une mauvaise phrase secrète"),
    ).rejects.toThrow(WRONG);
    expect(snapshot(deviceB)).toEqual(before);
    expect(fake.requests).toHaveLength(requests);
  });

  it("refuse un lien altéré, tronqué ou étranger avant toute dérivation de clé", async () => {
    const { code } = await linkFromDeviceA();
    const payload = JSON.parse(fromBase64Url(code.slice(5)));
    const encode = (value: unknown) =>
      `FIN1.${toBase64Url(JSON.stringify(value))}`;
    const derive = vi.spyOn(crypto.subtle, "deriveKey");
    const body = code.slice(5);
    const invalid: unknown[] = [
      "",
      "   ",
      "FIN1.",
      code.slice(0, -7),
      code.slice(0, 40),
      `FIN2.${body}`,
      `fin1.${body}`,
      `${code}=`,
      `${code}&x=1`,
      `FIN1.${body.replace(/[A-Za-z]/, "+")}`,
      `FIN1.${body.slice(0, 20)}!${body.slice(21)}`,
      `https://finance.test/Finances/#autre=${code}`,
      `FIN1.${"A".repeat(4_200)}`,
      " ".repeat(9_000) + code,
      encode({ ...payload, extra: true }),
      encode({ ...payload, v: 2 }),
      encode({
        v: 1,
        salt: payload.salt,
        iterations: payload.iterations,
        iv: payload.iv,
      }),
      encode({ ...payload, iterations: 1 }),
      encode({ ...payload, iterations: 1_000_001 }),
      encode({ ...payload, iterations: 600_000.5 }),
      encode({ ...payload, iterations: "600000" }),
      encode({ ...payload, salt: btoa("x".repeat(15)) }),
      encode({ ...payload, iv: btoa("x".repeat(16)) }),
      encode({ ...payload, ct: btoa("x".repeat(16)) }),
      encode({ ...payload, ct: btoa("x".repeat(2_100)) }),
      encode([payload]),
      `FIN1.${toBase64Url("pas du JSON")}`,
      null,
      42,
    ];
    for (const input of invalid) {
      expect(() => readDeviceLink(input as string)).toThrow(INVALID);
    }
    await expect(
      openFromDeviceLink(
        { ...payload, iterations: 1 } as DeviceLink,
        PASSPHRASE,
      ),
    ).rejects.toThrow(INVALID);
    await expect(
      openFromDeviceLink(
        { ...payload, extra: 1 } as unknown as DeviceLink,
        PASSPHRASE,
      ),
    ).rejects.toThrow(INVALID);
    expect(derive).not.toHaveBeenCalled();

    // A structurally valid link whose ciphertext was altered cannot be told from a wrong passphrase.
    const ct = atob(payload.ct);
    const flipped = encode({
      ...payload,
      ct: btoa(String.fromCharCode(ct.charCodeAt(0) ^ 1) + ct.slice(1)),
    });
    const requests = fake.requests.length;
    await expect(
      openFromDeviceLink(readDeviceLink(flipped), PASSPHRASE),
    ).rejects.toThrow(WRONG);
    expect(deviceB.length).toBe(0);
    expect(fake.requests).toHaveLength(requests);
  });

  it("exige un coffre ouvert et des réglages valides ; la clé dérivée n’ouvre pas de session", async () => {
    use(deviceA);
    const key = await createVault(PASSPHRASE, sample());
    const foreign = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    expect(() => openVaultKeyInfo(foreign)).toThrow("Coffre verrouillé.");
    await expect(
      createDeviceLink(foreign, {
        owner: OWNER,
        repo: REPO,
        path: PATH,
        token: TOKEN,
      }),
    ).rejects.toThrow("Coffre verrouillé.");
    for (const settings of [
      {
        owner: OWNER,
        repo: REPO,
        path: PATH,
        token: "ghp_0123456789abcdefghijklmnopqrstuvwxyz",
      },
      { owner: "..", repo: REPO, path: PATH, token: TOKEN },
      { owner: "Mendestrading21", repo: "Finances", path: PATH, token: TOKEN },
      { owner: OWNER, repo: REPO, path: "../coffre.json", token: TOKEN },
    ]) {
      const failure = await createDeviceLink(key, settings).then(
        () => new Error("Échec attendu"),
        (error: unknown) => error as Error,
      );
      expect(failure).toBeInstanceOf(SyncError);
      expect(failure.message).not.toContain(TOKEN);
    }

    const { salt, iterations } = openVaultKeyInfo(key);
    expect(iterations).toBe(600_000);
    await expect(deriveVaultKey(PASSPHRASE, salt, 1)).rejects.toThrow(
      "invalide ou incompatible",
    );
    await expect(deriveVaultKey(PASSPHRASE, salt, 1_000_001)).rejects.toThrow(
      "invalide ou incompatible",
    );
    await expect(
      deriveVaultKey(PASSPHRASE, "AAAA", iterations),
    ).rejects.toThrow("invalide ou incompatible");
    const derived = await deriveVaultKey(PASSPHRASE, salt, iterations);
    expect(derived.extractable).toBe(false);
    // Same key material as the open vault, yet never registered as an open session.
    await expect(sealSecret(derived, "secret")).rejects.toThrow(
      "Coffre verrouillé",
    );
    expect(() => openVaultKeyInfo(derived)).toThrow("Coffre verrouillé.");
    expect(fake.requests).toHaveLength(0);
  });

  it("garde toutes les protections de l’ouverture depuis GitHub : dépôt devenu public, coffre plus récent", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-01T08:00:00.000Z"));
    const { url } = await linkFromDeviceA();
    const link = readDeviceLink(url);

    fake.setPrivate(false);
    await expect(openFromDeviceLink(link, PASSPHRASE)).rejects.toThrow(
      "Le dépôt doit être privé",
    );
    expect(deviceB.length).toBe(0);
    fake.setPrivate(true);

    // Device B already holds a more recent vault: refused with the usual « plus ancienne » message.
    vi.setSystemTime(new Date("2026-09-02T08:00:00.000Z"));
    await createVault("Un autre coffre très privé", emptyData());
    const before = snapshot(deviceB);
    await expect(openFromDeviceLink(link, PASSPHRASE)).rejects.toThrow(
      /^Cette sauvegarde est plus ancienne/,
    );
    expect(snapshot(deviceB)).toEqual(before);
    const opened = await openFromDeviceLink(link, PASSPHRASE, true);
    expect(opened.data).toEqual(sample());
    expect(deviceB.getItem("finance.vault.v1")).toBe(fake.file()!.raw);
  });
});
