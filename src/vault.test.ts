import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyData, type FinanceData } from "./domain/types";
import {
  createVault,
  exportVault,
  importVault,
  openSecret,
  replaceVaultFromRemote,
  resealVault,
  saveVault,
  sealSecret,
  unlockVault,
  vaultEnvelopeInfo,
  VaultChangedError,
  vaultExists,
  VaultKeyMismatchError,
  vaultRevision,
  vaultSaltOnly,
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
let local: MemoryStorage;
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

function toB64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Builds a version-1 business-data envelope, sealed with an already-derived vault `key`
 * (reusing its exact kdf salt/iterations, as a real legacy file would carry). Lets tests
 * exercise `migrateToCurrentVersion` exactly as `open()` runs it, without a public API that
 * could ever write a pre-migration shape (`seal()` always validates/migrates first). */
async function encryptLegacyEnvelope(
  key: CryptoKey,
  kdf: { salt: string; iterations: number },
  businessData: unknown,
  savedAt: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const metadata = {
    format: "Finance",
    version: 1,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: kdf.iterations, salt: kdf.salt },
    cipher: { name: "AES-GCM", iv: toB64(iv), tagLength: 128 },
    savedAt,
  };
  const additionalData = new TextEncoder().encode(
    JSON.stringify([
      metadata.format,
      metadata.version,
      metadata.kdf.name,
      metadata.kdf.hash,
      metadata.kdf.iterations,
      metadata.kdf.salt,
      metadata.cipher.name,
      metadata.cipher.iv,
      metadata.cipher.tagLength,
      metadata.savedAt,
    ]),
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128, additionalData },
    key,
    new TextEncoder().encode(JSON.stringify(businessData)),
  );
  return JSON.stringify({
    ...metadata,
    ciphertext: toB64(new Uint8Array(ciphertext)),
  });
}

beforeEach(() => {
  local = new MemoryStorage();
  vi.stubGlobal("localStorage", local);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("coffre privé avec le vrai Web Crypto", () => {
  it("chiffre, ouvre, enregistre et restaure les données sans clé ou mot de passe persisté", async () => {
    expect(vaultExists()).toBe(false);
    const key = await createVault(PASSPHRASE, sample());
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toEqual({ name: "AES-GCM", length: 256 });
    expect(vaultExists()).toBe(true);
    const initial = exportVault();
    expect(local.length).toBe(1);
    expect(initial).not.toContain("Compte confidentiel");
    expect(initial).not.toContain("amountMinor");
    expect(initial).not.toContain(PASSPHRASE);
    const envelope = JSON.parse(initial);
    expect(envelope.kdf.iterations).toBe(600_000);
    expect(atob(envelope.kdf.salt).length).toBe(16);
    expect(atob(envelope.cipher.iv).length).toBe(12);
    const opened = await unlockVault(PASSPHRASE);
    expect(opened.data).toEqual(sample());
    expect(opened.key.extractable).toBe(false);
    const updated = {
      ...sample(),
      preferences: { baseCurrency: "EUR", locale: "fr-CH" },
    };
    await saveVault(opened.key, updated);
    const saved = exportVault();
    expect(JSON.parse(saved).cipher.iv).not.toBe(envelope.cipher.iv);
    expect((await unlockVault(PASSPHRASE)).data).toEqual(updated);
    local.clear();
    const restored = await importVault(saved, PASSPHRASE);
    expect(restored.data).toEqual(updated);
    await saveVault(restored.key, sample());
    expect((await unlockVault(PASSPHRASE)).data).toEqual(sample());
  });

  it("refuse une phrase courte et empêche une création de remplacer un coffre existant", async () => {
    await expect(createVault("trop court", sample())).rejects.toThrow(
      "12 caractères",
    );
    expect(local.length).toBe(0);
    await createVault(PASSPHRASE, sample());
    const before = exportVault();
    await expect(createVault(PASSPHRASE, emptyData())).rejects.toThrow(
      "existe déjà",
    );
    expect(exportVault()).toBe(before);
  });

  it("renvoie la même erreur pour une phrase incorrecte et un chiffré altéré, sans remplacement", async () => {
    await createVault(PASSPHRASE, sample());
    const before = exportVault();
    const wrong = await unlockVault("Une mauvaise phrase secrète").catch(
      (error) => error as Error,
    );
    expect(wrong).toBeInstanceOf(Error);
    const altered = JSON.parse(before);
    const binary = atob(altered.ciphertext);
    altered.ciphertext = btoa(
      String.fromCharCode(binary.charCodeAt(0) ^ 1) + binary.slice(1),
    );
    const tampered = await importVault(
      JSON.stringify(altered),
      PASSPHRASE,
    ).catch((error) => error as Error);
    expect(tampered).toBeInstanceOf(Error);
    expect((tampered as Error).message).toBe((wrong as Error).message);
    expect(exportVault()).toBe(before);
  });

  it("conserve le coffre précédent quand le stockage est plein et permet une nouvelle tentative", async () => {
    const key = await createVault(PASSPHRASE, sample());
    const before = exportVault();
    local.failWrites = true;
    await expect(saveVault(key, emptyData())).rejects.toThrow(
      "précédent est conservé",
    );
    expect(exportVault()).toBe(before);
    await expect(importVault(before, PASSPHRASE)).rejects.toThrow(
      "précédent est conservé",
    );
    expect(exportVault()).toBe(before);
    local.failWrites = false;
    await saveVault(key, emptyData());
    expect((await unlockVault(PASSPHRASE)).data).toEqual(emptyData());
  });

  it("refuse JSON malformé, clés supplémentaires, paramètres non bornés et base64 invalide avant dérivation", async () => {
    await createVault(PASSPHRASE, sample());
    const before = exportVault();
    const envelope = JSON.parse(before);
    const derive = vi.spyOn(crypto.subtle, "deriveKey");
    const invalid = [
      "{",
      "null",
      JSON.stringify(emptyData()),
      JSON.stringify({ ...envelope, additional: true }),
      JSON.stringify({ ...envelope, version: 2 }),
      JSON.stringify({ ...envelope, kdf: { ...envelope.kdf, iterations: 1 } }),
      JSON.stringify({
        ...envelope,
        kdf: { ...envelope.kdf, iterations: 1_000_001 },
      }),
      JSON.stringify({ ...envelope, kdf: { ...envelope.kdf, salt: "AAAA" } }),
      JSON.stringify({
        ...envelope,
        cipher: { ...envelope.cipher, iv: "!!!!!!!!!!!!====" },
      }),
      JSON.stringify({ ...envelope, ciphertext: "%%%%" }),
      JSON.stringify({ ...envelope, savedAt: "2026/01/01" }),
      JSON.stringify({ ...envelope, savedAt: 20260101 }),
    ];
    for (const raw of invalid) {
      await expect(importVault(raw, PASSPHRASE)).rejects.toThrow(
        "invalide ou incompatible",
      );
      expect(exportVault()).toBe(before);
    }
    expect(derive).not.toHaveBeenCalled();
  });

  it("rejette une sauvegarde dépassant 25 Mo avant analyse et ne modifie rien", async () => {
    await createVault(PASSPHRASE, sample());
    const before = exportVault();
    await expect(
      importVault(" ".repeat(25_000_001), PASSPHRASE),
    ).rejects.toThrow("25 Mo");
    expect(exportVault()).toBe(before);
  });

  it("valide les données avant enregistrement et garde le coffre précédent", async () => {
    const key = await createVault(PASSPHRASE, sample());
    const before = exportVault();
    await expect(
      saveVault(key, { ...sample(), version: 99 } as unknown as FinanceData),
    ).rejects.toThrow();
    expect(exportVault()).toBe(before);
  });

  it("refuse une ancienne session après une sauvegarde depuis une autre session", async () => {
    const oldKey = await createVault(PASSPHRASE, sample());
    const newSession = await unlockVault(PASSPHRASE);
    await saveVault(newSession.key, emptyData());
    const before = exportVault();
    await expect(saveVault(oldKey, sample())).rejects.toThrow("autre onglet");
    expect(exportVault()).toBe(before);
  });

  it("refuse un écrasement silencieux lorsque deux sauvegardes sont lancées en même temps", async () => {
    const key = await createVault(PASSPHRASE, sample());
    const other = {
      ...emptyData(),
      preferences: { baseCurrency: "USD", locale: "fr-CH" },
    };
    const results = await Promise.allSettled([
      saveVault(key, emptyData()),
      saveVault(key, other),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const failure = results.find(
      (result) => result.status === "rejected",
    ) as PromiseRejectedResult;
    expect(failure.reason.message).toContain("autre onglet");
    const restored = (await unlockVault(PASSPHRASE)).data;
    expect([emptyData(), other]).toContainEqual(restored);
  });

  it("ne confond pas le stockage inaccessible avec l’absence de coffre", async () => {
    vi.spyOn(local, "getItem").mockImplementation(() => {
      throw new DOMException("Denied", "SecurityError");
    });
    expect(vaultExists()).toBe(true);
    await expect(createVault(PASSPHRASE, sample())).rejects.toThrow(
      "inaccessible",
    );
    expect(local.length).toBe(0);
  });

  it("conserve une pièce jointe fictive intacte à travers chiffrement, sauvegarde et restauration", async () => {
    const attachment = {
      id: "piece-test",
      name: "Justificatif fictif.txt",
      mimeType: "text/plain" as const,
      dataUrl: `data:text/plain;base64,${btoa(
        "FICTIF - justificatif de test - a supprimer avant tout import reel",
      )}`,
      addedAt: "2026-09-17T12:00:00.000Z",
      source: { system: "manual" as const },
    };
    const withAttachment: FinanceData = {
      ...sample(),
      documents: [attachment],
    };
    await createVault(PASSPHRASE, withAttachment);
    expect((await unlockVault(PASSPHRASE)).data.documents).toEqual([
      attachment,
    ]);
    const backup = exportVault();
    local.clear();
    const restored = await importVault(backup, PASSPHRASE);
    expect(restored.data.documents).toEqual([attachment]);
    await saveVault(restored.key, withAttachment);
    expect((await unlockVault(PASSPHRASE)).data.documents).toEqual([
      attachment,
    ]);
  });

  it("ne laisse aucun coffre à moitié écrit si le stockage est plein dès la création, et permet de réessayer", async () => {
    local.failWrites = true;
    await expect(createVault(PASSPHRASE, sample())).rejects.toThrow(
      "Enregistrement impossible",
    );
    // A failed first write must not leave a corrupt or partial vault behind.
    expect(vaultExists()).toBe(false);
    expect(local.length).toBe(0);
    local.failWrites = false;
    await createVault(PASSPHRASE, sample());
    expect((await unlockVault(PASSPHRASE)).data).toEqual(sample());
  });

  it("répète la même erreur pour de nombreuses phrases incorrectes d’affilée, sans dégrader le coffre ni bloquer une tentative correcte", async () => {
    await createVault(PASSPHRASE, sample());
    const before = exportVault();
    const messages = new Set<string>();
    for (let attempt = 0; attempt < 8; attempt++) {
      const failure = await unlockVault(`Mauvaise phrase numéro ${attempt}`).catch(
        (error) => error as Error,
      );
      expect(failure).toBeInstanceOf(Error);
      messages.add((failure as Error).message);
      // Storage must be byte-identical after every single failed attempt, not just the last one.
      expect(exportVault()).toBe(before);
    }
    // One identical message regardless of attempt count or content: no information leak,
    // no counter visible in the error, nothing that would tell an attacker they are close.
    expect(messages.size).toBe(1);
    // No lockout of any kind: the very next attempt, if correct, opens immediately.
    const opened = await unlockVault(PASSPHRASE);
    expect(opened.data).toEqual(sample());
    expect(exportVault()).toBe(before);
  });

  it("refuse par défaut de restaurer une sauvegarde plus ancienne que le coffre déjà présent, sans y toucher", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const key = await createVault(PASSPHRASE, sample());
    const oldBackup = exportVault();
    vi.setSystemTime(new Date("2030-06-01T00:00:00.000Z"));
    const newer: FinanceData = {
      ...emptyData(),
      preferences: { baseCurrency: "EUR", locale: "fr-CH" },
    };
    await saveVault(key, newer);
    vi.useRealTimers();
    const before = exportVault();
    await expect(importVault(oldBackup, PASSPHRASE)).rejects.toThrow(
      "plus ancienne",
    );
    // The newer vault already on this device must survive the refused restore untouched.
    expect(exportVault()).toBe(before);
    expect((await unlockVault(PASSPHRASE)).data).toEqual(newer);
    // An explicit, deliberate confirmation still allows reverting to the older backup.
    const restored = await importVault(oldBackup, PASSPHRASE, true);
    expect(restored.data).toEqual(sample());
    expect((await unlockVault(PASSPHRASE)).data).toEqual(sample());
  });

  it("ne bloque jamais la restauration d’une sauvegarde quand aucun coffre n’existe encore sur l’appareil", async () => {
    await createVault(PASSPHRASE, sample());
    const backup = exportVault();
    local.clear();
    // Fresh device: nothing to compare the backup's date against, so it must always apply.
    const restored = await importVault(backup, PASSPHRASE);
    expect(restored.data).toEqual(sample());
  });

  it("ne bloque pas une restauration quand le coffre présent sur l’appareil n’a pas de date (format antérieur à ce champ)", async () => {
    // Simulate a vault written before `savedAt` existed: strip it from a real, currently
    // installed envelope without touching anything that authenticates it. This entry is
    // never decrypted in this scenario, only its plaintext metadata is inspected.
    await createVault(PASSPHRASE, sample());
    const undated = JSON.parse(exportVault()) as Record<string, unknown>;
    delete undated.savedAt;
    local.clear();
    const OTHER_PASSPHRASE = "Un autre coffre très privé";
    const newer: FinanceData = {
      ...emptyData(),
      preferences: { baseCurrency: "USD", locale: "fr-CH" },
    };
    await createVault(OTHER_PASSPHRASE, newer);
    const newerBackup = exportVault();
    local.clear();
    local.setItem("finance.vault.v1", JSON.stringify(undated));
    // An undated current vault can never be proven newer, so a dated backup must be allowed.
    const restored = await importVault(newerBackup, OTHER_PASSPHRASE);
    expect(restored.data).toEqual(newer);
  });

  it("ne bloque pas une restauration quand la sauvegarde elle-même n’a pas de date (format antérieur à ce champ)", async () => {
    // Build an envelope exactly as the pre-`savedAt` format did: the field is absent from
    // both the JSON and the authenticated data, so it must still open and never be treated
    // as older than anything, regardless of when the current vault was saved.
    const key = await createVault(PASSPHRASE, sample());
    const current = JSON.parse(exportVault()) as {
      kdf: { salt: string; iterations: number };
    };
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const metadata = {
      format: "Finance",
      version: 1,
      kdf: {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: current.kdf.iterations,
        salt: current.kdf.salt,
      },
      cipher: { name: "AES-GCM", iv: toB64(iv), tagLength: 128 },
    };
    const additionalData = new TextEncoder().encode(
      JSON.stringify([
        metadata.format,
        metadata.version,
        metadata.kdf.name,
        metadata.kdf.hash,
        metadata.kdf.iterations,
        metadata.kdf.salt,
        metadata.cipher.name,
        metadata.cipher.iv,
        metadata.cipher.tagLength,
      ]),
    );
    const legacyData: FinanceData = {
      ...emptyData(),
      preferences: { baseCurrency: "USD", locale: "fr-CH" },
    };
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, tagLength: 128, additionalData },
      key,
      new TextEncoder().encode(JSON.stringify(legacyData)),
    );
    const legacyBackup = JSON.stringify({
      ...metadata,
      ciphertext: toB64(new Uint8Array(ciphertext)),
    });
    expect(JSON.parse(legacyBackup).savedAt).toBeUndefined();
    // Move the current vault far into the future first: an undated backup must still be
    // accepted afterwards, because nothing here is entitled to assume it is older.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-01-01T00:00:00.000Z"));
    await saveVault(key, {
      ...sample(),
      preferences: { baseCurrency: "EUR", locale: "fr-CH" },
    });
    vi.useRealTimers();
    const restored = await importVault(legacyBackup, PASSPHRASE);
    expect(restored.data).toEqual(legacyData);
  });

  it("migre un coffre version 1 (sans classification de récurrence) à l’ouverture", async () => {
    const key = await createVault(PASSPHRASE, sample());
    const current = JSON.parse(exportVault()) as {
      kdf: { salt: string; iterations: number };
    };
    local.clear();
    const legacyRecurrence = {
      id: "old-sub",
      label: "Streaming",
      kind: "expense",
      amountMinor: 1500,
      currency: "CHF",
      accountId: null,
      category: "Abonnements",
      day: 5,
      intervalMonths: 1,
      startDate: "2020-01-05",
      active: true,
      source: { system: "manual" },
    };
    const legacyData = {
      ...emptyData(),
      version: 1,
      recurrences: [legacyRecurrence],
    };
    const legacyBackup = await encryptLegacyEnvelope(
      key,
      current.kdf,
      legacyData,
      new Date().toISOString(),
    );
    local.setItem("finance.vault.v1", legacyBackup);
    const opened = await unlockVault(PASSPHRASE);
    expect(opened.data.version).toBe(2);
    expect(opened.data.recurrences).toEqual([
      { ...legacyRecurrence, recurrenceType: "subscription" },
    ]);
  });

  it("rejette un import version 1 dont la classification déjà présente contredit le type, sans remplacer le coffre existant", async () => {
    // A recurrence that already carries an (inconsistent) recurrenceType is never silently
    // reclassified by migration — it reaches validation as-is, which must reject it, exactly
    // like any other invalid import: nothing is written.
    const key = await createVault(PASSPHRASE, sample());
    const before = exportVault();
    const current = JSON.parse(before) as {
      kdf: { salt: string; iterations: number };
    };
    const inconsistentRecurrence = {
      id: "bad",
      label: "Salaire",
      kind: "income",
      recurrenceType: "subscription",
      amountMinor: 500000,
      currency: "CHF",
      accountId: null,
      category: "Revenus",
      day: 1,
      intervalMonths: 1,
      startDate: "2020-01-01",
      active: true,
      source: { system: "manual" },
    };
    const legacyData = {
      ...emptyData(),
      version: 1,
      recurrences: [inconsistentRecurrence],
    };
    const badBackup = await encryptLegacyEnvelope(
      key,
      current.kdf,
      legacyData,
      new Date().toISOString(),
    );
    await expect(importVault(badBackup, PASSPHRASE)).rejects.toThrow();
    expect(exportVault()).toBe(before);
  });
});

describe("remplacement depuis un coffre distant et secrets scellés", () => {
  it("décrit l’enveloppe locale sans la déchiffrer", async () => {
    expect(vaultEnvelopeInfo()).toBeNull();
    await createVault(PASSPHRASE, sample());
    const envelope = JSON.parse(exportVault());
    const derive = vi.spyOn(crypto.subtle, "deriveKey");
    const decrypt = vi.spyOn(crypto.subtle, "decrypt");
    expect(vaultEnvelopeInfo()).toEqual({
      savedAt: envelope.savedAt,
      salt: envelope.kdf.salt,
      iterations: 600_000,
    });
    expect(derive).not.toHaveBeenCalled();
    expect(decrypt).not.toHaveBeenCalled();
  });

  it("lit le seul sel du coffre sans décoder le chiffré, et refuse une enveloppe illisible", async () => {
    expect(vaultSaltOnly()).toBeNull();
    await createVault(PASSPHRASE, sample());
    const envelope = JSON.parse(exportVault());
    expect(vaultSaltOnly()).toBe(envelope.kdf.salt);
    // Chiffré abîmé, sel intact : le sel reste lisible (l'ouverture, elle, sera refusée).
    local.setItem(
      "finance.vault.v1",
      JSON.stringify({ ...envelope, ciphertext: "%%%" }),
    );
    expect(() => vaultEnvelopeInfo()).toThrow();
    expect(vaultSaltOnly()).toBe(envelope.kdf.salt);
    for (const salt of ["", "AAAA", `${envelope.kdf.salt}AAAA`, 42]) {
      local.setItem(
        "finance.vault.v1",
        JSON.stringify({ ...envelope, kdf: { ...envelope.kdf, salt } }),
      );
      expect(() => vaultSaltOnly()).toThrow("Sauvegarde Finance invalide");
    }
    local.setItem("finance.vault.v1", "{pas du JSON");
    expect(() => vaultSaltOnly()).toThrow("Sauvegarde Finance invalide");
    local.setItem("finance.vault.v1", JSON.stringify({ kdf: null }));
    expect(() => vaultSaltOnly()).toThrow("Sauvegarde Finance invalide");
  });

  it("remplace le coffre ouvert par une enveloppe de même clé et garde la session utilisable", async () => {
    const key = await createVault(PASSPHRASE, sample());
    const older = exportVault();
    await saveVault(key, emptyData());
    expect(await replaceVaultFromRemote(key, older)).toEqual(sample());
    expect(exportVault()).toBe(older);
    await saveVault(key, emptyData());
    expect((await unlockVault(PASSPHRASE)).data).toEqual(emptyData());
  });

  it("n’écrit rien si le distant est altéré, d’un autre sel, ou si le coffre local a changé depuis l’instantané", async () => {
    const key = await createVault(PASSPHRASE, sample());
    const snapshotRaw = exportVault();
    await saveVault(key, emptyData());
    const current = exportVault();

    const altered = JSON.parse(snapshotRaw);
    const binary = atob(altered.ciphertext);
    altered.ciphertext = btoa(String.fromCharCode(binary.charCodeAt(0) ^ 1) + binary.slice(1));
    await expect(replaceVaultFromRemote(key, JSON.stringify(altered))).rejects.toThrow(
      "Impossible d’ouvrir le coffre",
    );
    expect(exportVault()).toBe(current);

    const foreignSalt = JSON.parse(snapshotRaw);
    foreignSalt.kdf.salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
    await expect(replaceVaultFromRemote(key, JSON.stringify(foreignSalt))).rejects.toBeInstanceOf(
      VaultKeyMismatchError,
    );
    expect(exportVault()).toBe(current);

    await expect(replaceVaultFromRemote(key, snapshotRaw, snapshotRaw)).rejects.toBeInstanceOf(
      VaultChangedError,
    );
    expect(exportVault()).toBe(current);
    expect(await replaceVaultFromRemote(key, snapshotRaw, current)).toEqual(sample());
    expect(exportVault()).toBe(snapshotRaw);
  });

  it("refuse le remplacement pour une session périmée par un autre onglet", async () => {
    const oldKey = await createVault(PASSPHRASE, sample());
    const remote = exportVault();
    const other = await unlockVault(PASSPHRASE);
    await saveVault(other.key, emptyData());
    const current = exportVault();
    await expect(replaceVaultFromRemote(oldKey, remote)).rejects.toThrow("autre onglet");
    await expect(replaceVaultFromRemote(oldKey, remote, current)).rejects.toThrow("autre onglet");
    expect(exportVault()).toBe(current);
  });

  it("ré-scelle les mêmes données avec une date fraîche, jamais antérieure au distant remplacé dans une limite de 10 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-05T08:00:00.000Z"));
    const key = await createVault(PASSPHRASE, sample());
    const first = exportVault();
    vi.setSystemTime(new Date("2026-09-05T09:00:00.000Z"));
    const second = await resealVault(key, first);
    expect(exportVault()).toBe(second);
    expect(JSON.parse(second).savedAt).toBe("2026-09-05T09:00:00.000Z");
    expect(JSON.parse(second).cipher.iv).not.toBe(JSON.parse(first).cipher.iv);
    const third = await resealVault(key, second, "2026-09-05T09:05:00.000Z");
    expect(JSON.parse(third).savedAt).toBe("2026-09-05T09:05:00.001Z");
    const fourth = await resealVault(key, third, "9999-01-01T00:00:00.000Z");
    expect(JSON.parse(fourth).savedAt).toBe("2026-09-05T09:00:00.000Z");
    await expect(resealVault(key, first)).rejects.toBeInstanceOf(VaultChangedError);
    expect(exportVault()).toBe(fourth);
    vi.useRealTimers();
    expect((await unlockVault(PASSPHRASE)).data).toEqual(sample());
    await saveVault(key, emptyData());
    expect((await unlockVault(PASSPHRASE)).data).toEqual(emptyData());
  });

  it("compte les remplacements venus d’un autre appareil, et seulement eux", async () => {
    const key = await createVault(PASSPHRASE, sample());
    expect(vaultRevision(key)).toBe(0);
    const remote = exportVault();
    await saveVault(key, emptyData());
    await resealVault(key, exportVault());
    expect(vaultRevision(key)).toBe(0);
    const current = exportVault();
    await expect(
      replaceVaultFromRemote(key, remote, remote),
    ).rejects.toBeInstanceOf(VaultChangedError);
    expect(vaultRevision(key)).toBe(0);
    expect(exportVault()).toBe(current);
    await replaceVaultFromRemote(key, remote);
    expect(vaultRevision(key)).toBe(1);
    await expect(saveVault(key, emptyData(), 0)).rejects.toBeInstanceOf(
      VaultChangedError,
    );
    expect(exportVault()).toBe(remote);
    await saveVault(key, emptyData(), 1);
    expect(vaultRevision(key)).toBe(1);
    expect((await unlockVault(PASSPHRASE)).data).toEqual(emptyData());
    const foreign = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    expect(() => vaultRevision(foreign)).toThrow("Coffre verrouillé");
  });

  it("un tirage commité pendant le chiffrement d’une sauvegarde révisée l’emporte : la sauvegarde est refusée", async () => {
    const key = await createVault(PASSPHRASE, sample());
    const remote = exportVault();
    await saveVault(key, emptyData());
    const revision = vaultRevision(key);
    const other: FinanceData = {
      ...emptyData(),
      preferences: { baseCurrency: "USD", locale: "fr-CH" },
    };
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "encrypt").mockImplementationOnce(
      async (...args) => {
        await replaceVaultFromRemote(key, remote);
        return encrypt(...args);
      },
    );
    await expect(saveVault(key, other, revision)).rejects.toBeInstanceOf(
      VaultChangedError,
    );
    expect(exportVault()).toBe(remote);
    expect(vaultRevision(key)).toBe(revision + 1);
    expect((await unlockVault(PASSPHRASE)).data).toEqual(sample());
    await saveVault(key, other, revision + 1);
    expect((await unlockVault(PASSPHRASE)).data).toEqual(other);
  });

  it("une sauvegarde révisée commitée pendant le déchiffrement d’un tirage l’emporte : le tirage est refusé", async () => {
    const key = await createVault(PASSPHRASE, sample());
    const remote = exportVault();
    await saveVault(key, emptyData());
    const snapshotRaw = exportVault();
    const revision = vaultRevision(key);
    const other: FinanceData = {
      ...emptyData(),
      preferences: { baseCurrency: "USD", locale: "fr-CH" },
    };
    let saved = "";
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "decrypt").mockImplementationOnce(
      async (...args) => {
        await saveVault(key, other, revision);
        saved = exportVault();
        return decrypt(...args);
      },
    );
    await expect(
      replaceVaultFromRemote(key, remote, snapshotRaw),
    ).rejects.toBeInstanceOf(VaultChangedError);
    expect(exportVault()).toBe(saved);
    expect(vaultRevision(key)).toBe(revision);
    expect((await unlockVault(PASSPHRASE)).data).toEqual(other);
  });

  it("scelle un secret avec la clé du coffre, sans le laisser en clair, et ne l’ouvre qu’avec cette clé", async () => {
    const secret = "github_pat_FICTIF_0123456789abcdefghijklmnop";
    const key = await createVault(PASSPHRASE, sample());
    const first = await sealSecret(key, secret);
    const second = await sealSecret(key, secret);
    expect(Object.keys(first).sort()).toEqual(["ct", "iv"]);
    expect(JSON.stringify(first)).not.toContain(secret);
    expect(atob(first.iv)).toHaveLength(12);
    expect(first.iv).not.toBe(second.iv);
    expect(await openSecret(key, first)).toBe(secret);

    const tampered = { ...first, ct: btoa(String.fromCharCode(atob(first.ct).charCodeAt(0) ^ 1) + atob(first.ct).slice(1)) };
    await expect(openSecret(key, tampered)).rejects.toThrow("Secret illisible");
    await expect(openSecret(key, { ...first, extra: 1 } as never)).rejects.toThrow("Secret illisible");

    local.clear();
    const otherKey = await createVault(PASSPHRASE, sample());
    await expect(openSecret(otherKey, first)).rejects.toThrow("Secret illisible");

    const foreign = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await expect(sealSecret(foreign, secret)).rejects.toThrow("Coffre verrouillé");
    await expect(openSecret(foreign, first)).rejects.toThrow("Coffre verrouillé");
  });
});
