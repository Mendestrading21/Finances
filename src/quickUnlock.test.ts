import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyData, type FinanceData } from "./domain/types";
import {
  disableQuickUnlock,
  enableQuickUnlock,
  quickUnlock,
  quickUnlockEnabled,
  quickUnlockSupported,
} from "./quickUnlock";
import {
  createVault,
  exportVault,
  importVault,
  saveVault,
  unlockVault,
} from "./vault";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  failWrites = false;
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
    if (this.failWrites)
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    this.values.set(key, String(value));
  }
}

const PASSPHRASE = "Coffre test très privé 2026";
const OTHER_PASSPHRASE = "Un autre coffre très privé 2026";
const HOST = "finance.test";
const QUICK_KEY = "finance.quick-unlock.v1";
const UNSUPPORTED =
  "Face ID ou l'empreinte ne peuvent pas protéger Finance sur cet appareil (fonction non prise en charge). Continuez avec la phrase secrète.";
const CHANGED =
  "La phrase secrète a changé : déverrouillez avec la phrase, puis réactivez Face ID dans les réglages.";
const OPEN_ERROR =
  "Impossible d’ouvrir le coffre. Vérifiez la phrase secrète et la sauvegarde.";

const sample = (): FinanceData => ({
  ...emptyData(),
  accounts: [
    {
      id: "bank-test",
      name: "Compte confidentiel",
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

function bytesOf(source: BufferSource): Uint8Array {
  return source instanceof ArrayBuffer
    ? new Uint8Array(source)
    : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
}

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Platform authenticator with the PRF extension, simulated: the PRF output is
 * HMAC-SHA256(secret, salt), so another secret behaves like another authenticator.
 */
class FakeAuthenticator {
  secret: Uint8Array<ArrayBuffer> = new Uint8Array(32).fill(7);
  /** "full": PRF output at creation; "enabled-only": only on get; "disabled"/"absent": no PRF. */
  prf: "full" | "enabled-only" | "disabled" | "absent" = "full";
  prfOnGet = true;
  uvAvailable = true;
  capabilities: Record<string, boolean> = { "extension:prf": true };
  failCreate?: string;
  failGets: string[] = [];
  creates: CredentialCreationOptions[] = [];
  gets: CredentialRequestOptions[] = [];
  forgotten: { rpId: string; credentialId: string }[] = [];
  known = new Set<string>();

  private async evaluate(salt: BufferSource): Promise<ArrayBuffer> {
    const key = await crypto.subtle.importKey(
      "raw",
      this.secret,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return crypto.subtle.sign("HMAC", key, bytesOf(salt).slice());
  }

  credentials = {
    create: async (options?: CredentialCreationOptions) => {
      this.creates.push(options!);
      if (this.failCreate) throw new DOMException("Refusé", this.failCreate);
      const rawId = crypto.getRandomValues(new Uint8Array(16));
      this.known.add(b64url(rawId));
      const salt = options!.publicKey!.extensions?.prf?.eval?.first;
      const output =
        this.prf === "full" && salt ? await this.evaluate(salt) : undefined;
      const prf =
        this.prf === "absent"
          ? undefined
          : this.prf === "disabled"
            ? { enabled: false }
            : {
                enabled: true,
                ...(output ? { results: { first: output } } : {}),
              };
      return {
        type: "public-key",
        id: b64url(rawId),
        rawId: rawId.buffer,
        getClientExtensionResults: () => (prf ? { prf } : {}),
      };
    },
    get: async (options?: CredentialRequestOptions) => {
      this.gets.push(options!);
      const failure = this.failGets.shift();
      if (failure) throw new DOMException("Refusé", failure);
      const publicKey = options!.publicKey!;
      const id = bytesOf(publicKey.allowCredentials![0].id).slice();
      if (!this.known.has(b64url(id)))
        throw new DOMException("Inconnu", "NotAllowedError");
      const salt = publicKey.extensions?.prf?.eval?.first;
      const output =
        this.prfOnGet && salt ? await this.evaluate(salt) : undefined;
      return {
        type: "public-key",
        id: b64url(id),
        rawId: id.buffer,
        getClientExtensionResults: () =>
          output ? { prf: { results: { first: output } } } : {},
      };
    },
  };

  api(withCapabilities = true) {
    return {
      isUserVerifyingPlatformAuthenticatorAvailable: async () =>
        this.uvAvailable,
      ...(withCapabilities
        ? { getClientCapabilities: async () => this.capabilities }
        : {}),
      signalUnknownCredential: async (options: {
        rpId: string;
        credentialId: string;
      }) => {
        this.forgotten.push(options);
      },
    };
  }
}

let local: MemoryStorage;
let auth: FakeAuthenticator;

function install(authenticator: FakeAuthenticator, withCapabilities = true) {
  vi.stubGlobal("navigator", { credentials: authenticator.credentials });
  vi.stubGlobal("PublicKeyCredential", authenticator.api(withCapabilities));
}

function snapshot(): Record<string, string> {
  const values: Record<string, string> = {};
  for (let i = 0; i < local.length; i++) {
    const key = local.key(i)!;
    values[key] = local.getItem(key)!;
  }
  return values;
}

function stored(): Record<string, string> {
  return JSON.parse(local.getItem(QUICK_KEY) ?? "null");
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("Échec attendu");
}

function expectNoPassphraseStored() {
  const everything = Object.values(snapshot()).join("\n");
  expect(everything).not.toContain(PASSPHRASE);
  expect(everything).not.toContain(b64(new TextEncoder().encode(PASSPHRASE)));
}

beforeEach(() => {
  local = new MemoryStorage();
  auth = new FakeAuthenticator();
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("location", {
    hostname: HOST,
    origin: `https://${HOST}`,
    pathname: "/Finances/",
  });
  install(auth);
  // Clears any passkey left pending in memory by a previous test.
  disableQuickUnlock();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("déverrouillage rapide par Face ID ou empreinte (WebAuthn PRF)", () => {
  it("détecte la prise en charge sans jamais lever d’exception", async () => {
    expect(await quickUnlockSupported()).toBe(true);
    auth.capabilities = { "extension:prf": false };
    expect(await quickUnlockSupported()).toBe(false);
    auth.capabilities = {};
    expect(await quickUnlockSupported()).toBe(true);
    install(auth, false);
    expect(await quickUnlockSupported()).toBe(true);
    auth.uvAvailable = false;
    expect(await quickUnlockSupported()).toBe(false);
    vi.stubGlobal("PublicKeyCredential", {
      isUserVerifyingPlatformAuthenticatorAvailable: async () => {
        throw new Error("indisponible");
      },
    });
    expect(await quickUnlockSupported()).toBe(false);
    vi.stubGlobal("PublicKeyCredential", {
      isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
      getClientCapabilities: async () => {
        throw new Error("indisponible");
      },
    });
    expect(await quickUnlockSupported()).toBe(false);
    vi.stubGlobal("PublicKeyCredential", undefined);
    expect(await quickUnlockSupported()).toBe(false);
    install(new FakeAuthenticator());
    vi.stubGlobal("navigator", {});
    expect(await quickUnlockSupported()).toBe(false);
  });

  it("active puis déverrouille en une vérification ; la phrase n’est jamais stockée ni journalisée", async () => {
    const logs = (["log", "info", "warn", "error", "debug"] as const).map(
      (method) => vi.spyOn(console, method),
    );
    await createVault(PASSPHRASE, sample());
    const vaultBefore = exportVault();
    expect(quickUnlockEnabled()).toBe(false);

    await enableQuickUnlock(PASSPHRASE);
    expect(quickUnlockEnabled()).toBe(true);
    expect(auth.creates).toHaveLength(1);
    expect(auth.gets).toHaveLength(0);
    const created = auth.creates[0].publicKey!;
    expect(created.rp).toEqual({ name: "Finance", id: HOST });
    expect(created.user.name).toBe("Finance");
    expect(created.user.displayName).toBe("Coffre Finance");
    expect(bytesOf(created.user.id)).toHaveLength(16);
    expect(bytesOf(created.challenge)).toHaveLength(32);
    expect(created.pubKeyCredParams).toEqual([
      { type: "public-key", alg: -7 },
      { type: "public-key", alg: -257 },
    ]);
    expect(created.authenticatorSelection).toEqual({
      userVerification: "required",
      residentKey: "preferred",
      authenticatorAttachment: "platform",
    });
    expect(created.timeout).toBe(60_000);

    const config = stored();
    expect(Object.keys(config).sort()).toEqual(
      ["createdAt", "credentialId", "ct", "iv", "prfSalt", "version"].sort(),
    );
    expect(config.version).toBe(1);
    expect(auth.known.has(config.credentialId)).toBe(true);
    expect(atob(config.prfSalt)).toHaveLength(32);
    expect(b64(bytesOf(created.extensions!.prf!.eval!.first))).toBe(
      config.prfSalt,
    );
    expect(atob(config.iv)).toHaveLength(12);
    expect(Number.isFinite(Date.parse(config.createdAt))).toBe(true);
    expectNoPassphraseStored();
    expect(exportVault()).toBe(vaultBefore);

    const opened = await quickUnlock();
    expect(opened.data).toEqual(sample());
    expect(opened.key.extractable).toBe(false);
    expect(auth.gets).toHaveLength(1);
    const request = auth.gets[0].publicKey!;
    expect(request.rpId).toBe(HOST);
    expect(request.userVerification).toBe("required");
    expect(request.timeout).toBe(60_000);
    expect(bytesOf(request.challenge)).toHaveLength(32);
    expect(request.allowCredentials).toHaveLength(1);
    expect(request.allowCredentials![0].type).toBe("public-key");
    expect(b64url(bytesOf(request.allowCredentials![0].id))).toBe(
      config.credentialId,
    );
    expect(b64(bytesOf(request.extensions!.prf!.eval!.first))).toBe(
      config.prfSalt,
    );

    // The key is a regular open-vault key: saving works, and so does the next quick unlock.
    await saveVault(opened.key, emptyData());
    expect((await quickUnlock()).data).toEqual(emptyData());
    expectNoPassphraseStored();
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  });

  it("sans sortie PRF à la création, la lit par une seconde vérification", async () => {
    auth.prf = "enabled-only";
    await createVault(PASSPHRASE, sample());
    await enableQuickUnlock(PASSPHRASE);
    expect(auth.creates).toHaveLength(1);
    expect(auth.gets).toHaveLength(1);
    expect(
      b64url(bytesOf(auth.gets[0].publicKey!.allowCredentials![0].id)),
    ).toBe(stored().credentialId);
    expect((await quickUnlock()).data).toEqual(sample());
  });

  it("seconde vérification interrompue : la tentative suivante termine sans créer un autre passkey, une seule fois", async () => {
    auth.prf = "enabled-only";
    await createVault(PASSPHRASE, sample());
    auth.failGets = ["NotAllowedError"];
    const interrupted = await rejection(enableQuickUnlock(PASSPHRASE));
    expect(interrupted.message).toContain("Activation presque terminée");
    expect(local.getItem(QUICK_KEY)).toBeNull();
    await enableQuickUnlock(PASSPHRASE);
    expect(auth.creates).toHaveLength(1);
    expect(auth.gets).toHaveLength(2);
    expect((await quickUnlock()).data).toEqual(sample());

    // Resumed only once: a second refusal abandons that passkey, the next attempt starts over.
    disableQuickUnlock();
    auth.failGets = ["NotAllowedError", "NotAllowedError"];
    await expect(enableQuickUnlock(PASSPHRASE)).rejects.toThrow(
      "Activation presque terminée",
    );
    await expect(enableQuickUnlock(PASSPHRASE)).rejects.toThrow(
      "Activation annulée.",
    );
    const abandoned = b64url(
      bytesOf(auth.gets.at(-1)!.publicKey!.allowCredentials![0].id),
    );
    expect(auth.forgotten).toContainEqual({
      rpId: HOST,
      credentialId: abandoned,
    });
    expect(local.getItem(QUICK_KEY)).toBeNull();
    await enableQuickUnlock(PASSPHRASE);
    expect(auth.creates).toHaveLength(3);
    expect((await quickUnlock()).data).toEqual(sample());
  });

  it("mauvaise phrase à l’activation : aucune création de passkey, rien de stocké", async () => {
    await createVault(PASSPHRASE, sample());
    const before = snapshot();
    const failure = await rejection(
      enableQuickUnlock("Une mauvaise phrase secrète"),
    );
    expect(failure.message).toBe(OPEN_ERROR);
    expect(failure.message).not.toContain("mauvaise");
    expect(auth.creates).toHaveLength(0);
    expect(snapshot()).toEqual(before);
    expect(quickUnlockEnabled()).toBe(false);

    local.clear();
    await expect(enableQuickUnlock(PASSPHRASE)).rejects.toThrow(
      "Aucun coffre enregistré",
    );
    expect(auth.creates).toHaveLength(0);
    expect(local.length).toBe(0);
  });

  it("PRF non pris en charge : message clair, rien de stocké, passkey inutile signalé", async () => {
    await createVault(PASSPHRASE, sample());
    const before = snapshot();
    for (const mode of ["disabled", "absent"] as const) {
      auth.prf = mode;
      await expect(enableQuickUnlock(PASSPHRASE)).rejects.toThrow(UNSUPPORTED);
      expect(snapshot()).toEqual(before);
    }
    expect(auth.forgotten.map((entry) => entry.credentialId).sort()).toEqual(
      [...auth.known].sort(),
    );
    expect(auth.forgotten.every((entry) => entry.rpId === HOST)).toBe(true);

    auth.prf = "enabled-only";
    auth.prfOnGet = false;
    await expect(enableQuickUnlock(PASSPHRASE)).rejects.toThrow(UNSUPPORTED);
    expect(snapshot()).toEqual(before);

    auth.prf = "full";
    auth.failCreate = "NotSupportedError";
    await expect(enableQuickUnlock(PASSPHRASE)).rejects.toThrow(UNSUPPORTED);
    vi.stubGlobal("navigator", {});
    await expect(enableQuickUnlock(PASSPHRASE)).rejects.toThrow(UNSUPPORTED);
    expect(snapshot()).toEqual(before);
    expect(quickUnlockEnabled()).toBe(false);
  });

  it("annulation : message dédié, réglage et coffre intacts", async () => {
    await createVault(PASSPHRASE, sample());
    const vaultBefore = exportVault();
    auth.failCreate = "NotAllowedError";
    await expect(enableQuickUnlock(PASSPHRASE)).rejects.toThrow(
      "Activation annulée.",
    );
    expect(local.getItem(QUICK_KEY)).toBeNull();

    auth.failCreate = undefined;
    await enableQuickUnlock(PASSPHRASE);
    const before = snapshot();
    for (const name of ["NotAllowedError", "AbortError"]) {
      auth.failGets = [name];
      await expect(quickUnlock()).rejects.toThrow("Déverrouillage annulé.");
      expect(snapshot()).toEqual(before);
    }
    expect(exportVault()).toBe(vaultBefore);
    expect((await quickUnlock()).data).toEqual(sample());
  });

  it("coffre remplacé avec une autre phrase : réglage désactivé, message, coffre intact", async () => {
    const other = new MemoryStorage();
    vi.stubGlobal("localStorage", other);
    await createVault(OTHER_PASSPHRASE, emptyData());
    const otherBackup = exportVault();
    vi.stubGlobal("localStorage", local);

    await createVault(PASSPHRASE, sample());
    await enableQuickUnlock(PASSPHRASE);
    const credentialId = stored().credentialId;
    await importVault(otherBackup, OTHER_PASSPHRASE, true);
    const vaultBefore = exportVault();

    await expect(quickUnlock()).rejects.toThrow(CHANGED);
    expect(local.getItem(QUICK_KEY)).toBeNull();
    expect(quickUnlockEnabled()).toBe(false);
    expect(auth.forgotten).toContainEqual({ rpId: HOST, credentialId });
    expect(exportVault()).toBe(vaultBefore);
    expect((await unlockVault(OTHER_PASSPHRASE)).data).toEqual(emptyData());
    await expect(quickUnlock()).rejects.toThrow("pas activé");
  });

  it("réglage altéré ou illisible : désactivé avec un message clair, sans demander Face ID ni toucher au coffre", async () => {
    await createVault(PASSPHRASE, sample());
    await enableQuickUnlock(PASSPHRASE);
    const good = stored();
    const vaultBefore = exportVault();
    const altered = [
      "{",
      "null",
      JSON.stringify([good]),
      JSON.stringify({ ...good, version: 2 }),
      JSON.stringify({ ...good, extra: true }),
      JSON.stringify({ ...good, ct: undefined }),
      JSON.stringify({ ...good, iv: "AAAA" }),
      JSON.stringify({ ...good, iv: "!!!!!!!!!!!!!!!!" }),
      JSON.stringify({ ...good, prfSalt: b64(new Uint8Array(16)) }),
      JSON.stringify({ ...good, credentialId: `${good.credentialId}=` }),
      JSON.stringify({ ...good, credentialId: "" }),
      JSON.stringify({ ...good, ct: "AAAA" }),
      JSON.stringify({ ...good, createdAt: "hier" }),
    ];
    for (const raw of altered) {
      local.setItem(QUICK_KEY, raw);
      expect(quickUnlockEnabled()).toBe(false);
      const gets = auth.gets.length;
      await expect(quickUnlock()).rejects.toThrow("illisible");
      expect(local.getItem(QUICK_KEY)).toBeNull();
      expect(auth.gets).toHaveLength(gets);
      expect(exportVault()).toBe(vaultBefore);
    }
    local.setItem(QUICK_KEY, JSON.stringify(good));
    expect((await quickUnlock()).data).toEqual(sample());
  });

  it("autre authentificateur, chiffré altéré ou sortie PRF absente : échec sans rien casser", async () => {
    await createVault(PASSPHRASE, sample());
    await enableQuickUnlock(PASSPHRASE);
    const before = snapshot();

    const genuine = auth.secret;
    auth.secret = new Uint8Array(32).fill(9);
    await expect(quickUnlock()).rejects.toThrow("n’a pas pu ouvrir Finance");
    expect(snapshot()).toEqual(before);
    auth.secret = genuine;

    const config = stored();
    const ct = atob(config.ct);
    const flipped = String.fromCharCode(ct.charCodeAt(0) ^ 1) + ct.slice(1);
    local.setItem(QUICK_KEY, JSON.stringify({ ...config, ct: btoa(flipped) }));
    await expect(quickUnlock()).rejects.toThrow("n’a pas pu ouvrir Finance");
    expect(quickUnlockEnabled()).toBe(true);
    local.setItem(QUICK_KEY, JSON.stringify(config));

    auth.prfOnGet = false;
    await expect(quickUnlock()).rejects.toThrow(UNSUPPORTED);
    expect(snapshot()).toEqual(before);
    auth.prfOnGet = true;

    // A passkey the authenticator no longer knows is refused like a cancellation, nothing removed.
    auth.known.clear();
    await expect(quickUnlock()).rejects.toThrow("Déverrouillage annulé.");
    expect(snapshot()).toEqual(before);
    auth.known.add(config.credentialId);

    expect((await quickUnlock()).data).toEqual(sample());
    expect(snapshot()).toEqual(before);
  });

  it("désactivation et réactivation : un seul réglage, les anciens passkeys sont signalés, le coffre reste", async () => {
    await createVault(PASSPHRASE, sample());
    const vaultBefore = exportVault();
    await expect(quickUnlock()).rejects.toThrow("pas activé");
    await enableQuickUnlock(PASSPHRASE);
    const first = stored().credentialId;
    await enableQuickUnlock(PASSPHRASE);
    const second = stored().credentialId;
    expect(second).not.toBe(first);
    expect(auth.forgotten).toEqual([{ rpId: HOST, credentialId: first }]);
    expect((await quickUnlock()).data).toEqual(sample());

    disableQuickUnlock();
    expect(quickUnlockEnabled()).toBe(false);
    expect(local.getItem(QUICK_KEY)).toBeNull();
    expect(auth.forgotten.at(-1)).toEqual({ rpId: HOST, credentialId: second });
    expect(exportVault()).toBe(vaultBefore);
    await expect(quickUnlock()).rejects.toThrow("pas activé");
    disableQuickUnlock();
  });

  it("stockage plein ou inaccessible : rien d’annoncé, rien d’écrit, coffre intact", async () => {
    await createVault(PASSPHRASE, sample());
    const before = snapshot();
    local.failWrites = true;
    await expect(enableQuickUnlock(PASSPHRASE)).rejects.toThrow(
      "Face ID n’a pas été activé",
    );
    local.failWrites = false;
    expect(snapshot()).toEqual(before);
    expect(auth.forgotten).toHaveLength(1);
    expect(quickUnlockEnabled()).toBe(false);

    await enableQuickUnlock(PASSPHRASE);
    vi.spyOn(local, "getItem").mockImplementation(() => {
      throw new DOMException("Denied", "SecurityError");
    });
    expect(quickUnlockEnabled()).toBe(false);
    await expect(quickUnlock()).rejects.toThrow("inaccessible");
    expect(() => disableQuickUnlock()).toThrow("Désactivation impossible");
  });
});
