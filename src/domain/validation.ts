import { isDate } from "./finance";
import { CURRENT_DATA_VERSION, migrateToCurrentVersion } from "./migration";
import type {
  Account,
  Balance,
  Document,
  FinanceData,
  FxRate,
  Goal,
  Position,
  Recurrence,
  RecurrenceAmount,
  RecurrenceType,
  ReviewItem,
  Source,
  Transaction,
} from "./types";

const MAX_BYTES = 30 * 1024 * 1024;
const MAX_ATTACHMENT = 8 * 1024 * 1024;
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
type Obj = Record<string, unknown>;
function fail(path: string, message: string): never {
  throw new Error(`${path} : ${message}`);
}
function object(value: unknown, path: string, keys?: string[]): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail(path, "objet attendu");
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null)
    return fail(path, "objet non JSON");
  const record = value as Obj;
  for (const key of Object.keys(record)) {
    if (forbidden.has(key)) fail(path, "clé interdite");
    if (keys && !keys.includes(key)) fail(`${path}.${key}`, "champ inconnu");
  }
  return record;
}
function text(value: unknown, path: string, max = 500, empty = false): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!empty && !value.trim()) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    return fail(path, "texte invalide");
  return value;
}
function id(value: unknown, path: string): string {
  const result = text(value, path, 200);
  if (!/^[A-Za-z0-9_:.@/-]+$/.test(result)) fail(path, "identifiant invalide");
  return result;
}
function number(
  value: unknown,
  path: string,
  nullable = false,
  positive = false,
): number | null {
  if (value === null && nullable) return null;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    (positive && value < 0)
  )
    return fail(path, "entier sûr attendu");
  return value;
}
function currency(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value))
    return fail(path, "devise à trois lettres attendue");
  return value;
}
function enumValue<T extends string>(
  value: unknown,
  values: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !values.includes(value as T))
    return fail(path, `valeur attendue : ${values.join(", ")}`);
  return value as T;
}
function date(value: unknown, path: string, nullable = false): string | null {
  if (value === null && nullable) return null;
  if (!isDate(value)) return fail(path, "date YYYY-MM-DD valide attendue");
  return value;
}
function timestamp(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !isDate(value.slice(0, 10)) ||
    !Number.isFinite(Date.parse(value))
  )
    return fail(path, "horodatage ISO avec fuseau attendu");
  return value;
}
function url(value: unknown, path: string): string {
  const result = text(value, path, 4000);
  try {
    const parsed = new URL(result);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password)
      fail(path, "URL HTTPS sans identifiants attendue");
  } catch {
    return fail(path, "URL HTTPS invalide");
  }
  return result;
}
function source(value: unknown, path: string): Source {
  const raw = object(value, path, [
    "system",
    "sourceId",
    "url",
    "importedAt",
    "updatedAt",
    "note",
  ]);
  return {
    system: enumValue(
      raw.system,
      ["manual", "notion", "import", "demo"],
      `${path}.system`,
    ),
    ...(raw.sourceId === undefined
      ? {}
      : { sourceId: text(raw.sourceId, `${path}.sourceId`, 500) }),
    ...(raw.url === undefined ? {} : { url: url(raw.url, `${path}.url`) }),
    ...(raw.importedAt === undefined
      ? {}
      : { importedAt: timestamp(raw.importedAt, `${path}.importedAt`) }),
    ...(raw.updatedAt === undefined
      ? {}
      : { updatedAt: timestamp(raw.updatedAt, `${path}.updatedAt`) }),
    ...(raw.note === undefined
      ? {}
      : { note: text(raw.note, `${path}.note`, 8000, true) }),
  };
}
function array<T>(
  value: unknown,
  path: string,
  parser: (value: unknown, path: string) => T,
  max = 50000,
): T[] {
  if (!Array.isArray(value) || value.length > max)
    return fail(path, `liste attendue, maximum ${max} éléments`);
  return value.map((item, index) => parser(item, `${path}[${index}]`));
}
function balance(value: unknown, path: string): Balance {
  const raw = object(value, path, ["id", "amountMinor", "asOf", "source"]);
  return {
    id: id(raw.id, `${path}.id`),
    amountMinor: number(raw.amountMinor, `${path}.amountMinor`, true),
    asOf: date(raw.asOf, `${path}.asOf`, true),
    source: source(raw.source, `${path}.source`),
  };
}
function account(value: unknown, path: string): Account {
  const raw = object(value, path, [
    "id",
    "name",
    "institution",
    "kind",
    "group",
    "currency",
    "valuationMode",
    "balances",
    "source",
  ]);
  const result: Account = {
    id: id(raw.id, `${path}.id`),
    name: text(raw.name, `${path}.name`, 200),
    institution: text(raw.institution, `${path}.institution`, 200, true),
    kind: enumValue(
      raw.kind,
      ["bank", "savings", "investment", "debt"],
      `${path}.kind`,
    ),
    currency: currency(raw.currency, `${path}.currency`),
    valuationMode: enumValue(
      raw.valuationMode,
      ["total", "components"],
      `${path}.valuationMode`,
    ),
    balances: array(raw.balances, `${path}.balances`, balance, 10000),
    source: source(raw.source, `${path}.source`),
    ...(raw.group === undefined
      ? {}
      : { group: text(raw.group, `${path}.group`, 60) }),
  };
  unique(result.balances, `${path}.balances`, false);
  return result;
}
function transaction(value: unknown, path: string): Transaction {
  const raw = object(value, path, [
    "id",
    "label",
    "kind",
    "amountMinor",
    "currency",
    "status",
    "date",
    "budgetMonth",
    "accountId",
    "destinationAccountId",
    "destinationAmountMinor",
    "category",
    "recurrenceId",
    "occurrenceDate",
    "source",
  ]);
  if (
    raw.budgetMonth !== undefined &&
    (typeof raw.budgetMonth !== "string" ||
      !/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(raw.budgetMonth))
  )
    fail(`${path}.budgetMonth`, "mois YYYY-MM attendu");
  const result: Transaction = {
    id: id(raw.id, `${path}.id`),
    label: text(raw.label, `${path}.label`, 300),
    kind: enumValue(
      raw.kind,
      ["income", "expense", "transfer"],
      `${path}.kind`,
    ),
    amountMinor: number(raw.amountMinor, `${path}.amountMinor`, false, true)!,
    currency: currency(raw.currency, `${path}.currency`),
    status: enumValue(
      raw.status,
      ["planned", "settled", "unknown"],
      `${path}.status`,
    ),
    date: date(raw.date, `${path}.date`, true),
    accountId:
      raw.accountId === null ? null : id(raw.accountId, `${path}.accountId`),
    category: text(raw.category, `${path}.category`, 200, true),
    source: source(raw.source, `${path}.source`),
    ...(raw.budgetMonth === undefined
      ? {}
      : { budgetMonth: raw.budgetMonth as string }),
    ...(raw.destinationAccountId === undefined
      ? {}
      : {
          destinationAccountId:
            raw.destinationAccountId === null
              ? null
              : id(raw.destinationAccountId, `${path}.destinationAccountId`),
        }),
    ...(raw.destinationAmountMinor === undefined
      ? {}
      : {
          destinationAmountMinor: number(
            raw.destinationAmountMinor,
            `${path}.destinationAmountMinor`,
            true,
            true,
          ),
        }),
    ...(raw.recurrenceId === undefined
      ? {}
      : { recurrenceId: id(raw.recurrenceId, `${path}.recurrenceId`) }),
    ...(raw.occurrenceDate === undefined
      ? {}
      : {
          occurrenceDate: date(raw.occurrenceDate, `${path}.occurrenceDate`)!,
        }),
  };
  if (
    result.kind !== "transfer" &&
    (result.destinationAccountId != null ||
      result.destinationAmountMinor != null)
  )
    fail(path, "destination réservée aux virements");
  if (
    result.kind === "transfer" &&
    (!result.accountId ||
      !result.destinationAccountId ||
      result.accountId === result.destinationAccountId)
  )
    fail(path, "deux comptes distincts requis pour un virement");
  if (Boolean(result.recurrenceId) !== Boolean(result.occurrenceDate))
    fail(
      path,
      "récurrence et date d’occurrence doivent être renseignées ensemble",
    );
  if (result.kind === "transfer" && result.recurrenceId)
    fail(
      path,
      "les virements récurrents ne sont pas pris en charge par ce schéma",
    );
  return result;
}
function recurrenceAmount(value: unknown, path: string): RecurrenceAmount {
  const raw = object(value, path, ["amountMinor", "effectiveFrom"]);
  return {
    amountMinor: number(raw.amountMinor, `${path}.amountMinor`, false, true)!,
    effectiveFrom: date(raw.effectiveFrom, `${path}.effectiveFrom`)!,
  };
}
const recurrenceTypes: readonly RecurrenceType[] = [
  "subscription",
  "bill",
  "income",
  "saving",
  "other",
];
function recurrence(value: unknown, path: string): Recurrence {
  const raw = object(value, path, [
    "id",
    "label",
    "kind",
    "recurrenceType",
    "amountMinor",
    "amountEffectiveFrom",
    "amountHistory",
    "currency",
    "accountId",
    "category",
    "day",
    "intervalMonths",
    "startDate",
    "endDate",
    "active",
    "source",
  ]);
  const day = number(raw.day, `${path}.day`)!,
    interval = number(raw.intervalMonths, `${path}.intervalMonths`)!;
  if (day < 1 || day > 31 || interval < 1 || interval > 120)
    fail(path, "jour 1–31 et intervalle 1–120 mois requis");
  if (typeof raw.active !== "boolean")
    fail(`${path}.active`, "booléen attendu");
  const result: Recurrence = {
    id: id(raw.id, `${path}.id`),
    label: text(raw.label, `${path}.label`, 300),
    kind: enumValue(raw.kind, ["income", "expense"], `${path}.kind`),
    recurrenceType: enumValue(
      raw.recurrenceType,
      recurrenceTypes,
      `${path}.recurrenceType`,
    ),
    amountMinor: number(raw.amountMinor, `${path}.amountMinor`, false, true)!,
    currency: currency(raw.currency, `${path}.currency`),
    accountId:
      raw.accountId === null ? null : id(raw.accountId, `${path}.accountId`),
    category: text(raw.category, `${path}.category`, 200, true),
    day,
    intervalMonths: interval,
    startDate: date(raw.startDate, `${path}.startDate`)!,
    active: raw.active,
    source: source(raw.source, `${path}.source`),
    ...(raw.endDate === undefined
      ? {}
      : { endDate: date(raw.endDate, `${path}.endDate`, true) }),
    ...(raw.amountEffectiveFrom === undefined
      ? {}
      : {
          amountEffectiveFrom: date(
            raw.amountEffectiveFrom,
            `${path}.amountEffectiveFrom`,
          )!,
        }),
    ...(raw.amountHistory === undefined
      ? {}
      : {
          amountHistory: array(
            raw.amountHistory,
            `${path}.amountHistory`,
            recurrenceAmount,
            1000,
          ),
        }),
  };
  if (result.endDate && result.endDate < result.startDate)
    fail(path, "fin antérieure au début");
  // recurrenceType "income" is reserved for kind "income": it is what distinguishes a
  // récurrent revenue from the expense-only subscription/bill/saving classification.
  if ((result.recurrenceType === "income") !== (result.kind === "income"))
    fail(
      path,
      "la classification « revenu récurrent » doit correspondre à un type revenu",
    );
  // Amount history stays a strictly ordered chain of superseded amounts, each dated before
  // the current one took effect — the invariant `withRecurrenceAmount` always maintains.
  if (result.amountEffectiveFrom && result.amountEffectiveFrom < result.startDate)
    fail(path, "date d’effet du montant antérieure au début de la récurrence");
  if (result.amountHistory) {
    const currentFrom = result.amountEffectiveFrom ?? result.startDate;
    let previous: string | null = null;
    for (const entry of result.amountHistory) {
      if (entry.effectiveFrom >= currentFrom)
        fail(path, "historique de montant postérieur ou égal au montant courant");
      if (previous !== null && entry.effectiveFrom <= previous)
        fail(path, "historique de montant non strictement croissant");
      previous = entry.effectiveFrom;
    }
  }
  return result;
}
function goal(value: unknown, path: string): Goal {
  const raw = object(value, path, [
    "id",
    "name",
    "targetMinor",
    "reservedMinor",
    "currency",
    "accountId",
    "dueDate",
    "asOf",
    "source",
  ]);
  return {
    id: id(raw.id, `${path}.id`),
    name: text(raw.name, `${path}.name`, 300),
    targetMinor: number(raw.targetMinor, `${path}.targetMinor`, true, true),
    reservedMinor: number(
      raw.reservedMinor,
      `${path}.reservedMinor`,
      true,
      true,
    ),
    currency: currency(raw.currency, `${path}.currency`),
    accountId:
      raw.accountId === null ? null : id(raw.accountId, `${path}.accountId`),
    dueDate: date(raw.dueDate, `${path}.dueDate`, true),
    asOf: date(raw.asOf, `${path}.asOf`, true),
    source: source(raw.source, `${path}.source`),
  };
}
function position(value: unknown, path: string): Position {
  const raw = object(value, path, [
    "id",
    "accountId",
    "name",
    "symbol",
    "assetType",
    "quantity",
    "valueMinor",
    "currency",
    "asOf",
    "source",
  ]);
  if (
    raw.quantity !== null &&
    (typeof raw.quantity !== "string" ||
      !/^-?\d{1,24}(?:\.\d{1,18})?$/.test(raw.quantity))
  )
    fail(`${path}.quantity`, "quantité décimale ou null attendue");
  return {
    id: id(raw.id, `${path}.id`),
    accountId: id(raw.accountId, `${path}.accountId`),
    name: text(raw.name, `${path}.name`, 300),
    symbol: text(raw.symbol, `${path}.symbol`, 100, true),
    assetType: enumValue(
      raw.assetType,
      ["stock", "etf", "option", "crypto", "other"],
      `${path}.assetType`,
    ),
    quantity: raw.quantity as string | null,
    valueMinor: number(raw.valueMinor, `${path}.valueMinor`, true),
    currency: currency(raw.currency, `${path}.currency`),
    asOf: date(raw.asOf, `${path}.asOf`, true),
    source: source(raw.source, `${path}.source`),
  };
}
function document(value: unknown, path: string): Document {
  const raw = object(value, path, [
    "id",
    "name",
    "mimeType",
    "dataUrl",
    "url",
    "transactionId",
    "addedAt",
    "source",
  ]);
  const mimeType = enumValue(
    raw.mimeType,
    [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/webp",
      "text/plain",
      "text/csv",
      "application/octet-stream",
    ],
    `${path}.mimeType`,
  );
  let dataUrl: string | undefined;
  if (raw.dataUrl !== undefined) {
    dataUrl = text(
      raw.dataUrl,
      `${path}.dataUrl`,
      Math.ceil((MAX_ATTACHMENT * 4) / 3) + 100,
    );
    const match = dataUrl.match(
      /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/,
    );
    if (
      !match ||
      match[1] !== mimeType ||
      match[2].length === 0 ||
      match[2].length % 4 !== 0 ||
      Math.floor((match[2].length * 3) / 4) -
        (match[2].match(/=+$/)?.[0].length ?? 0) >
        MAX_ATTACHMENT
    )
      fail(
        `${path}.dataUrl`,
        "pièce jointe base64 invalide ou trop grande (8 Mo maximum)",
      );
  }
  return {
    id: id(raw.id, `${path}.id`),
    name: text(raw.name, `${path}.name`, 300),
    mimeType,
    addedAt: timestamp(raw.addedAt, `${path}.addedAt`),
    source: source(raw.source, `${path}.source`),
    ...(dataUrl === undefined ? {} : { dataUrl }),
    ...(raw.url === undefined ? {} : { url: url(raw.url, `${path}.url`) }),
    ...(raw.transactionId === undefined
      ? {}
      : {
          transactionId:
            raw.transactionId === null
              ? null
              : id(raw.transactionId, `${path}.transactionId`),
        }),
  };
}
function fx(value: unknown, path: string): FxRate {
  const raw = object(value, path, ["from", "to", "rate", "asOf", "source"]);
  const from = currency(raw.from, `${path}.from`),
    to = currency(raw.to, `${path}.to`);
  if (
    from === to ||
    typeof raw.rate !== "string" ||
    !/^\d{1,24}(?:\.\d{1,18})?$/.test(raw.rate) ||
    BigInt(raw.rate.replace(".", "")) <= 0n
  )
    fail(path, "taux positif décimal entre deux devises distinctes attendu");
  return {
    from,
    to,
    rate: raw.rate as string,
    asOf: date(raw.asOf, `${path}.asOf`)!,
    source: source(raw.source, `${path}.source`),
  };
}
function json(value: unknown, path: string, depth = 0): unknown {
  if (depth > 12) fail(path, "objet trop profond");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string")
    return text(value, path, MAX_ATTACHMENT * 2, true);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value))
    return array(value, path, (item, p) => json(item, p, depth + 1));
  const raw = object(value, path);
  return Object.fromEntries(
    Object.entries(raw).map(([key, item]) => [
      key,
      json(item, `${path}.${key}`, depth + 1),
    ]),
  );
}
function review(value: unknown, path: string): ReviewItem {
  const raw = object(value, path, ["id", "title", "reason", "source", "raw"]);
  return {
    id: id(raw.id, `${path}.id`),
    title: text(raw.title, `${path}.title`, 500),
    reason: text(raw.reason, `${path}.reason`, 8000),
    source: source(raw.source, `${path}.source`),
    ...(raw.raw === undefined
      ? {}
      : { raw: json(object(raw.raw, `${path}.raw`), `${path}.raw`) as Obj }),
  };
}
function unique(
  items: { id: string; source?: Source }[],
  path: string,
  originsRequired = true,
): void {
  const ids = new Set<string>(),
    origins = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) fail(path, `identifiant en doublon : ${item.id}`);
    ids.add(item.id);
    // The same source must not silently enter twice under different local IDs.
    if (
      originsRequired &&
      item.source?.sourceId &&
      ["notion", "import"].includes(item.source.system)
    ) {
      const key = `${item.source.system}:${item.source.sourceId}`;
      if (origins.has(key)) fail(path, "source en doublon");
      origins.add(key);
    }
  }
}

/** Strict private import boundary. Accepts version 1 (migrated in place, see `migration.ts`) or
 * the current version; always returns the current version. Returns a new validated object;
 * never mutates input. Missing financial observations stay null. A malformed import, and a
 * migration failure, are rejected atomically — nothing is written on either. */
export function validateData(input: unknown): FinanceData {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(input);
  } catch {
    return fail("Import", "JSON sérialisable attendu");
  }
  if (
    !serialized ||
    serialized.length > MAX_BYTES ||
    new TextEncoder().encode(serialized).length > MAX_BYTES
  )
    fail("Import", "sauvegarde absente ou trop grande (30 Mo maximum)");
  const raw = object(migrateToCurrentVersion(input), "Import", [
    "version",
    "accounts",
    "transactions",
    "recurrences",
    "goals",
    "positions",
    "documents",
    "fxRates",
    "reviewItems",
    "preferences",
    "importedAt",
  ]);
  if (raw.version !== CURRENT_DATA_VERSION)
    fail(
      "version",
      `seule la version ${CURRENT_DATA_VERSION} est prise en charge (ou la version 1, migrée automatiquement)`,
    );
  const prefs = object(raw.preferences, "preferences", [
    "baseCurrency",
    "locale",
  ]);
  const locale = text(prefs.locale, "preferences.locale", 50);
  try {
    new Intl.NumberFormat(locale);
  } catch {
    fail("preferences.locale", "locale invalide");
  }
  const data: FinanceData = {
    version: CURRENT_DATA_VERSION,
    accounts: array(raw.accounts, "accounts", account, 1000),
    transactions: array(raw.transactions, "transactions", transaction),
    recurrences: array(raw.recurrences, "recurrences", recurrence, 5000),
    goals: array(raw.goals, "goals", goal, 5000),
    positions: array(raw.positions, "positions", position),
    documents: array(raw.documents, "documents", document, 2000),
    fxRates: array(raw.fxRates, "fxRates", fx),
    reviewItems: array(raw.reviewItems, "reviewItems", review, 10000),
    preferences: {
      baseCurrency: currency(prefs.baseCurrency, "preferences.baseCurrency"),
      locale,
    },
    ...(raw.importedAt === undefined
      ? {}
      : { importedAt: timestamp(raw.importedAt, "importedAt") }),
  };
  for (const key of [
    "accounts",
    "transactions",
    "recurrences",
    "goals",
    "positions",
    "documents",
    "reviewItems",
  ] as const)
    unique(data[key], key, key !== "reviewItems");
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  const recurrenceIds = new Map(data.recurrences.map((r) => [r.id, r]));
  const transactionIds = new Set(data.transactions.map((t) => t.id));
  const accountRef = (ref: string | null | undefined, path: string) => {
    if (ref != null && !accounts.has(ref)) fail(path, "compte introuvable");
  };
  const occurrences = new Set<string>();
  for (const t of data.transactions) {
    accountRef(t.accountId, `transaction ${t.id}`);
    accountRef(t.destinationAccountId, `transaction ${t.id}.destination`);
    if (t.accountId && accounts.get(t.accountId)!.currency !== t.currency)
      fail(
        `transaction ${t.id}`,
        "devise différente de celle du compte source",
      );
    if (t.kind === "transfer") {
      const destination = accounts.get(t.destinationAccountId!)!;
      if (
        destination.currency !== t.currency &&
        t.destinationAmountMinor == null
      )
        fail(
          `transaction ${t.id}`,
          "montant reçu requis pour un virement entre devises",
        );
      if (
        destination.currency === t.currency &&
        t.destinationAmountMinor != null &&
        t.destinationAmountMinor !== t.amountMinor
      )
        fail(
          `transaction ${t.id}`,
          "montants source/destination différents : enregistrer les frais séparément",
        );
    }
    if (t.recurrenceId) {
      const recurrence = recurrenceIds.get(t.recurrenceId);
      if (!recurrence || recurrence.kind !== t.kind)
        fail(`transaction ${t.id}`, "récurrence introuvable ou incompatible");
      const key = `${t.recurrenceId}:${t.occurrenceDate}`;
      if (occurrences.has(key))
        fail("transactions", "occurrence de récurrence en doublon");
      occurrences.add(key);
    }
  }
  for (const r of data.recurrences) {
    accountRef(r.accountId, `recurrence ${r.id}`);
    if (r.accountId && accounts.get(r.accountId)!.currency !== r.currency)
      fail(`recurrence ${r.id}`, "devise différente de celle du compte");
  }
  for (const g of data.goals) accountRef(g.accountId, `goal ${g.id}`);
  for (const p of data.positions) {
    accountRef(p.accountId, `position ${p.id}`);
    if (accounts.get(p.accountId)!.kind !== "investment")
      fail(`position ${p.id}`, "compte d’investissement requis");
  }
  for (const doc of data.documents)
    if (doc.transactionId != null && !transactionIds.has(doc.transactionId))
      fail(`document ${doc.id}`, "opération introuvable");
  const fxKeys = new Set<string>();
  for (const rate of data.fxRates) {
    const key = `${rate.from}:${rate.to}:${rate.asOf}`;
    if (fxKeys.has(key)) fail("fxRates", "taux en doublon pour cette date");
    fxKeys.add(key);
  }
  guardArithmetic(data);
  return data;
}

/** Conservative arithmetic budget: every accepted value can safely be summed/converted.
 * This bound includes history, so an oversized backup is refused before replacing the vault. */
function guardArithmetic(data: FinanceData): void {
  const totals = new Map<string, bigint>(),
    counts = new Map<string, bigint>();
  const add = (currency: string, amount: number | null | undefined) => {
    if (amount != null) {
      totals.set(
        currency,
        (totals.get(currency) ?? 0n) + BigInt(Math.abs(amount)),
      );
      if (amount !== 0) counts.set(currency, (counts.get(currency) ?? 0n) + 1n);
    }
  };
  for (const account of data.accounts)
    for (const balance of account.balances)
      add(account.currency, balance.amountMinor);
  for (const row of data.transactions) add(row.currency, row.amountMinor);
  for (const row of data.recurrences) {
    add(row.currency, row.amountMinor);
    for (const entry of row.amountHistory ?? []) add(row.currency, entry.amountMinor);
  }
  for (const row of data.positions) add(row.currency, row.valueMinor);
  for (const row of data.goals) {
    add(row.currency, row.targetMinor);
    add(row.currency, row.reservedMinor);
  }
  const limits = new Map<string, Map<string, bigint>>();
  for (const [currency, amount] of totals)
    limits.set(currency, new Map([[currency, amount]]));
  const put = (
    from: string,
    to: string,
    numerator: bigint,
    denominator: bigint,
  ) => {
    // Each independent observation is rounded separately. ceil(sum) alone is not
    // an upper bound for sum(round(each)); reserve up to one cent per extra value.
    const count = counts.get(from) ?? 0n;
    const roundingMargin =
      numerator % denominator !== 0n && count > 1n ? count - 1n : 0n;
    const converted =
      ((totals.get(from) ?? 0n) * numerator + denominator - 1n) / denominator +
      roundingMargin;
    const current = limits.get(to) ?? new Map<string, bigint>();
    if (converted > (current.get(from) ?? 0n)) current.set(from, converted);
    limits.set(to, current);
  };
  for (const rate of data.fxRates) {
    const [whole, fractional = ""] = rate.rate.split(".");
    const numerator = BigInt(whole + fractional),
      denominator = 10n ** BigInt(fractional.length);
    put(rate.from, rate.to, numerator, denominator);
    put(rate.to, rate.from, denominator, numerator);
  }
  for (const amounts of limits.values())
    if (
      [...amounts.values()].reduce((total, value) => total + value, 0n) >
      BigInt(Number.MAX_SAFE_INTEGER)
    )
      fail(
        "Import",
        "les montants cumulés ou convertis dépassent la précision sûre",
      );
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([key]) => key !== "importedAt")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function fingerprint(value: unknown): string {
  let hash = 14695981039346656037n;
  for (const char of stable(value)) {
    hash ^= BigInt(char.charCodeAt(0));
    hash = BigInt.asUintN(64, hash * 1099511628211n);
  }
  return hash.toString(16);
}
function origin(value: { source: Source }): string | null {
  return value.source.sourceId &&
    ["notion", "import"].includes(value.source.system)
    ? `${value.source.system}:${value.source.sourceId}`
    : null;
}

/** Idempotent, non-destructive merge of two COMPLETE valid current-version datasets.
 * Matching stable ID or source identity: exact values are ignored; any content change is
 * quarantined in reviewItems.raw, preserving existing/manual edits. A human must resolve it.
 * Foreign keys are remapped if an import uses a new local ID for the same source.
 * Preferences remain those of the existing vault. No implicit deletion or balance update. */
export function mergeImport(
  existing: FinanceData,
  incoming: FinanceData,
): FinanceData {
  const result = validateData(existing),
    next = validateData(incoming);
  const addConflict = (
    collection: string,
    record: Obj,
    existingId: string,
    src: Source,
  ) => {
    const reviewId = `import-conflict:${collection}:${fingerprint({ record, existingId })}`;
    if (result.reviewItems.some((r) => r.id === reviewId)) return;
    result.reviewItems.push({
      id: reviewId,
      title: "Modification importée à rapprocher",
      reason: `${collection} : la valeur existante est conservée. Vérifier la proposition importée avant tout remplacement.`,
      source: src,
      raw: { collection, existingId, incoming: record },
    });
  };
  const merge = <T extends { id: string; source: Source }>(
    name: string,
    target: T[],
    incomingRecords: T[],
  ): Map<string, string> => {
    const mapping = new Map<string, string>();
    for (const record of incomingRecords) {
      const sourceKey = name === "reviewItems" ? null : origin(record);
      const byId = target.find((item) => item.id === record.id);
      const bySource =
        sourceKey === null
          ? undefined
          : target.find((item) => origin(item) === sourceKey);
      if (
        (byId && bySource && byId !== bySource) ||
        (byId && name !== "reviewItems" && origin(byId) !== sourceKey)
      )
        fail(
          `Import ${name}`,
          "identité ambiguë entre identifiant local et source ; rapprocher avant import",
        );
      const asTransaction = record as unknown as Transaction;
      const byOccurrence =
        name === "transactions" &&
        asTransaction.recurrenceId &&
        asTransaction.occurrenceDate
          ? target.find((item) => {
              const t = item as unknown as Transaction;
              return (
                t.recurrenceId === asTransaction.recurrenceId &&
                t.occurrenceDate === asTransaction.occurrenceDate
              );
            })
          : undefined;
      if (
        byOccurrence &&
        ((byId && byId !== byOccurrence) ||
          (bySource && bySource !== byOccurrence))
      )
        fail(`Import ${name}`, "occurrence ambiguë ; rapprocher avant import");
      const previous = byId ?? bySource ?? byOccurrence;
      if (!previous) {
        target.push(record);
        mapping.set(record.id, record.id);
        continue;
      }
      mapping.set(record.id, previous.id);
      const aligned = { ...record, id: previous.id };
      if (stable(previous) !== stable(aligned))
        addConflict(name, record as unknown as Obj, previous.id, record.source);
    }
    return mapping;
  };
  const accountIds = merge("accounts", result.accounts, next.accounts);
  const accountId = (id: string | null | undefined) =>
    id == null ? id : (accountIds.get(id) ?? id);
  const recurrenceIds = merge(
    "recurrences",
    result.recurrences,
    next.recurrences.map((r) => ({ ...r, accountId: accountId(r.accountId)! })),
  );
  const transactionIds = merge(
    "transactions",
    result.transactions,
    next.transactions.map((t) => ({
      ...t,
      accountId: accountId(t.accountId)!,
      ...(t.destinationAccountId === undefined
        ? {}
        : { destinationAccountId: accountId(t.destinationAccountId) }),
      ...(t.recurrenceId === undefined
        ? {}
        : {
            recurrenceId: recurrenceIds.get(t.recurrenceId) ?? t.recurrenceId,
          }),
    })),
  );
  merge(
    "goals",
    result.goals,
    next.goals.map((g) => ({ ...g, accountId: accountId(g.accountId)! })),
  );
  merge(
    "positions",
    result.positions,
    next.positions.map((p) => ({ ...p, accountId: accountId(p.accountId)! })),
  );
  merge(
    "documents",
    result.documents,
    next.documents.map((d) => ({
      ...d,
      ...(d.transactionId == null
        ? {}
        : {
            transactionId:
              transactionIds.get(d.transactionId) ?? d.transactionId,
          }),
    })),
  );
  merge("reviewItems", result.reviewItems, next.reviewItems);
  for (const rate of next.fxRates) {
    const prior = result.fxRates.find(
      (r) => r.from === rate.from && r.to === rate.to && r.asOf === rate.asOf,
    );
    if (!prior) result.fxRates.push(rate);
    else if (stable(prior) !== stable(rate))
      addConflict(
        "fxRates",
        rate as unknown as Obj,
        `${rate.from}:${rate.to}:${rate.asOf}`,
        rate.source,
      );
  }
  // A conflicting parent could make a newly imported child inconsistent. Rejecting atomically
  // is safer than importing it under an unintended account/currency; callers keep the old vault.
  return validateData(result);
}
