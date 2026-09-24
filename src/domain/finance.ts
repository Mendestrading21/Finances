import type {
  Account,
  Balance,
  FinanceData,
  FxRate,
  Position,
  Recurrence,
  RecurrenceAmount,
  Transaction,
} from "./types";

const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const MIN = -MAX;
function safeNumber(value: bigint): number {
  if (value < MIN || value > MAX)
    throw new Error("Le montant dépasse la précision sûre.");
  return Number(value);
}
function sum(values: number[]): number {
  return safeNumber(values.reduce((total, value) => total + BigInt(value), 0n));
}

/** Money is stored in integer hundredths; null is an explicitly unknown amount. */
export function money(minor: number | null, currency = "CHF"): string {
  if (minor === null) return "—";
  if (!Number.isSafeInteger(minor))
    throw new Error("Montant monétaire invalide.");
  const absolute = BigInt(minor < 0 ? -minor : minor);
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  const formatted = new Intl.NumberFormat("fr-CH", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .formatToParts(absolute / 100n)
    .map((part) => (part.type === "fraction" ? fraction : part.value))
    .join("");
  return `${minor < 0 ? "-" : ""}${formatted}`;
}

/** Strict decimal parsing. Accepts Swiss grouping (1’234.50) and French decimals (1 234,50). */
export function parseMoney(input: string): number {
  const raw = input
    .trim()
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/[’‘]/g, "'");
  if (!raw) throw new Error("Indiquez un montant.");
  const match = raw.match(
    /^([+-]?)(\d+|\d{1,3}(?: \d{3})+|\d{1,3}(?:'\d{3})+)(?:[.,](\d+))?$/,
  );
  if (!match) throw new Error("Montant invalide. Exemple : 1’234.50.");
  if ((match[3]?.length ?? 0) > 2)
    throw new Error("Deux décimales maximum ; aucun arrondi implicite.");
  const whole = match[2].replace(/[ ']/g, "");
  const value = BigInt(whole) * 100n + BigInt((match[3] ?? "").padEnd(2, "0"));
  return safeNumber(match[1] === "-" ? -value : value);
}

/** Local calendar day (never UTC slicing, which changes the day around midnight). */
export function today(): string {
  const date = new Date();
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
function monthParts(month: string): [number, number] {
  if (!/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new Error("Mois invalide.");
  return [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
}
export function monthLabel(month: string): string {
  monthParts(month);
  return new Intl.DateTimeFormat("fr-CH", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T12:00:00Z`));
}
/** "28 avr. 2026" — same locale/timezone convention as monthLabel, for a full YYYY-MM-DD. */
export function dateLabel(date: string): string {
  if (!isDate(date)) throw new Error("Date invalide.");
  return new Intl.DateTimeFormat("fr-CH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}
function daysInMonth(year: number, month: number): number {
  return month === 2
    ? year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
      ? 29
      : 28
    : [4, 6, 9, 11].includes(month)
      ? 30
      : 31;
}

/** A balance observation requires its own date. Import dates never substitute for asOf. */
export function latestBalance(account: Account, at = today()): Balance | null {
  if (!isDate(at)) throw new Error("Date d’évaluation invalide.");
  return account.balances.reduce<Balance | null>(
    (latest, balance) =>
      balance.asOf !== null &&
      isDate(balance.asOf) &&
      balance.asOf <= at &&
      (!latest || balance.asOf >= latest.asOf!)
        ? balance
        : latest,
    null,
  );
}

/** Date from which `recurrence.amountMinor` (its current amount) has applied. */
function currentAmountFrom(recurrence: Recurrence): string {
  return recurrence.amountEffectiveFrom ?? recurrence.startDate;
}

/** Amount in effect for an occurrence dated `at`: the most recent dated change (current or
 * historical) whose effectiveFrom is not after `at`. A modification never rewrites the amount
 * of an occurrence dated before its effective date — only `withRecurrenceAmount` may extend
 * `amountHistory`, and it always dates the superseded amount from when it actually started. */
export function recurrenceAmountAt(recurrence: Recurrence, at: string): number {
  const currentFrom = currentAmountFrom(recurrence);
  const past = (recurrence.amountHistory ?? []).reduce<RecurrenceAmount | null>(
    (latest, candidate) =>
      candidate.effectiveFrom <= at &&
      (!latest || candidate.effectiveFrom > latest.effectiveFrom)
        ? candidate
        : latest,
    null,
  );
  if (currentFrom <= at && (!past || currentFrom >= past.effectiveFrom))
    return recurrence.amountMinor;
  return past ? past.amountMinor : recurrence.amountMinor;
}

/** Pure, no-op-safe amount change: the previous amount is preserved in `amountHistory`, dated
 * from when it actually took effect, so occurrences before `effectiveFrom` keep showing it.
 * Only occurrences from `effectiveFrom` onward see the new amount. Never touches settled or
 * otherwise materialized Transactions, which already carry their own frozen amount.
 * An `effectiveFrom` at or before the recurrence's currently active effective date (e.g. two
 * edits the same day, since callers commonly default to `today()`) amends that still-pending
 * change in place instead of archiving it: it was never actually in effect for any occurrence,
 * so archiving it would put a history entry at or after the new current date, corrupting
 * `amountHistory`'s strictly-increasing invariant (validateData would then reject the result)
 * and, short of that, making `recurrenceAmountAt` return an older amount for a later date than
 * for an earlier one. Reaching further back, past an already-archived change, is rejected —
 * this pure function cannot safely re-splice history that far.
 * The current amount with an EXPLICIT earlier date is not a no-op: it brings that scheduled
 * change forward (90 from October, then "90 from September" → September is 90 too). Without
 * a date (an editor re-saving an unchanged amount, dated today by default) it stays a no-op, so
 * a label edit never advances a change scheduled for later. A date before `startDate` means
 * "from the start" and is clamped to it (no occurrence exists before; validateData rejects an
 * `amountEffectiveFrom` earlier than `startDate`) — e.g. the first day of the start month. */
export function withRecurrenceAmount(
  recurrence: Recurrence,
  amountMinor: number,
  effectiveFrom?: string,
): Recurrence {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0)
    throw new Error("Montant de récurrence invalide.");
  const requested = effectiveFrom ?? today();
  if (!isDate(requested)) throw new Error("Date d’effet invalide.");
  const from =
    requested < recurrence.startDate ? recurrence.startDate : requested;
  const currentFrom = currentAmountFrom(recurrence);
  if (
    amountMinor === recurrence.amountMinor &&
    (effectiveFrom === undefined || from >= currentFrom)
  )
    return recurrence;
  const history = recurrence.amountHistory ?? [];
  if (from > currentFrom)
    return {
      ...recurrence,
      amountMinor,
      amountEffectiveFrom: from,
      amountHistory: [
        ...history,
        { amountMinor: recurrence.amountMinor, effectiveFrom: currentFrom },
      ],
    };
  const archivedBoundary = history.length
    ? history[history.length - 1].effectiveFrom
    : null;
  if (archivedBoundary !== null && from <= archivedBoundary)
    throw new Error(
      "Un changement de montant plus récent existe déjà. Choisissez « Ce mois seulement », ou modifiez à partir d’un mois plus récent.",
    );
  return {
    ...recurrence,
    amountMinor,
    amountEffectiveFrom: from,
    amountHistory: history,
  };
}

/** Normalizes any cadence to a monthly figure for comparison — e.g. 1200/year and 100/month
 * both become 100 — rounded half away from zero to the nearest cent, exactly once. Never used
 * as the real due/settled amount (that stays the actual per-occurrence debit, per
 * amelioration-v2.md "ne pas... classer un débit annuel réel avec un équivalent mensuel
 * caché"): only for the "Montant mensuel" sort/display, always labeled as an equivalent. */
export function monthlyEquivalentMinor(
  recurrence: Recurrence,
  at = today(),
): number {
  return roundRatio(
    BigInt(recurrenceAmountAt(recurrence, at)),
    BigInt(recurrence.intervalMonths),
  );
}

/** The date `recurrence`'s occurrence is due in `month`, or null if it has none there
 * (inactive, before its start, after its end, or `month` isn't a multiple of
 * `intervalMonths` away from `startDate`). Shared by `transactionsForMonth` (which only
 * needs the still-unlinked case) and `occurrenceCohort` (which needs every due occurrence
 * regardless of whether or when it was settled). */
function occurrenceDueDate(recurrence: Recurrence, month: string): string | null {
  if (!recurrence.active) return null;
  const [year, monthNumber] = monthParts(month);
  const [startYear, startMonth] = monthParts(recurrence.startDate.slice(0, 7));
  const distance = (year - startYear) * 12 + monthNumber - startMonth;
  if (distance < 0 || distance % recurrence.intervalMonths !== 0) return null;
  const date = `${month}-${String(Math.min(recurrence.day, daysInMonth(year, monthNumber))).padStart(2, "0")}`;
  if (date < recurrence.startDate || (recurrence.endDate && date > recurrence.endDate))
    return null;
  return date;
}

/** The planned transaction `recurrence` projects for its occurrence due on `date` (a real due
 * date, e.g. from `occurrenceCohort`; not re-checked here). The single shape shared by
 * `transactionsForMonth`'s virtual line, `withOccurrenceAmount` and the app's "Payer", so
 * persisting an occurrence never changes its identity (id, link, account). Its provenance is
 * the recurrence's WITHOUT `sourceId`: that id names the one imported record (the recurrence),
 * and validation.ts `unique()` rejects two transactions sharing it ("source en doublon") — so
 * copying it made the 2nd materialized occurrence of a Notion/import recurrence unsavable.
 * system, url, importedAt, updatedAt and note are kept. */
export function projectedOccurrence(
  recurrence: Recurrence,
  date: string,
  amountMinor = recurrenceAmountAt(recurrence, date),
): Transaction {
  const source = { ...recurrence.source };
  delete source.sourceId;
  return {
    id: `${recurrence.id}:${date}`,
    label: recurrence.label,
    kind: recurrence.kind,
    amountMinor,
    currency: recurrence.currency,
    status: "planned",
    date,
    accountId: recurrence.accountId,
    category: recurrence.category,
    recurrenceId: recurrence.id,
    occurrenceDate: date,
    source,
  };
}

/** The explicit transaction recorded for `recurrenceId`'s occurrence due on `date`, if any —
 * the one rule every view uses to replace the projection (see `occurrenceLinks`). */
export function findOccurrenceTransaction(
  transactions: Transaction[],
  recurrenceId: string,
  date: string,
): Transaction | undefined {
  return occurrenceLinks(transactions)(recurrenceId, date);
}

/** Finds the explicit transaction recorded for an occurrence: by its persisted link
 * (recurrenceId + occurrenceDate) or, for older exports that never persisted those fields, by
 * the projection's own id `${recurrenceId}:${date}`. The id fallback only accepts a
 * transaction carrying no link at all: one whose link names another occurrence is that
 * occurrence's record, never this one's. Shared by `transactionsForMonth`, `occurrenceCohort`
 * and `withOccurrenceAmount`, so Mon mois, Abonnements and Factures agree on every occurrence. */
function occurrenceLinks(
  transactions: Transaction[],
): (recurrenceId: string, date: string) => Transaction | undefined {
  const byLink = new Map<string, Transaction>();
  const byLegacyId = new Map<string, Transaction>();
  for (const t of transactions) {
    if (t.recurrenceId && t.occurrenceDate)
      byLink.set(`${t.recurrenceId}:${t.occurrenceDate}`, t);
    else if (!t.recurrenceId && !t.occurrenceDate) byLegacyId.set(t.id, t);
  }
  return (recurrenceId, date) =>
    byLink.get(`${recurrenceId}:${date}`) ??
    byLegacyId.get(`${recurrenceId}:${date}`);
}

/** Virtual planned occurrences are replaced by an explicit transaction linked to that occurrence,
 * even if its payment date moves to another month. Only actual transaction dates determine cash month. */
export function transactionsForMonth(
  data: FinanceData,
  month: string,
): Transaction[] {
  monthParts(month); // validates even when nothing below happens to call it
  const result = data.transactions.filter(
    (transaction) =>
      (transaction.date?.slice(0, 7) ?? transaction.budgetMonth) === month,
  );
  // Link fields first; the projection's id is a second guard only for older exports that never
  // persisted them — a transaction linked to ANOTHER occurrence does not hide this one.
  const linkedTo = occurrenceLinks(data.transactions);
  for (const recurrence of data.recurrences) {
    const date = occurrenceDueDate(recurrence, month);
    if (date === null || linkedTo(recurrence.id, date)) continue;
    result.push(projectedOccurrence(recurrence, date));
  }
  return result.sort(
    (a, b) =>
      (a.date ?? "").localeCompare(b.date ?? "") || a.id.localeCompare(b.id),
  );
}

export type OccurrenceCohortItem = {
  recurrenceId: string;
  occurrenceDate: string;
  /** Amount due for THIS occurrence, in `currency`: the linked transaction's own amount when one
   * exists (adjusted for this month only, or actually settled), else the rule's projection. */
  dueAmountMinor: number;
  currency: string;
  /** The rule's amount for this date (`recurrenceAmountAt`), in the recurrence's currency. */
  projectedAmountMinor: number;
  /** True when a linked transaction exists and its amount or currency differs from the rule. */
  adjusted: boolean;
  accountId: string | null;
  kind: "income" | "expense";
  recurrenceType: Recurrence["recurrenceType"];
  label: string;
  /** The settled transaction linked to this occurrence, whichever month it actually
   * happened in — null while still due. Only status "settled" closes an occurrence; one
   * left "planned" or "unknown" is not a règlement. `date` mirrors the transaction's own
   * (nullable) date: a settlement recorded without a date cannot be dated "payé le …", but
   * it is still a settlement — see monthSummary's identical treatment of this case.
   * `currency` is the settled transaction's own currency, not assumed to match the
   * recurrence's: the editor lets a settlement's currency be corrected before saving. */
  settled: {
    transactionId: string;
    date: string | null;
    amountMinor: number;
    currency: string;
  } | null;
};
/** Every occurrence due in `month`, "cohorte d'échéances"-style: unlike `transactionsForMonth`,
 * always includes an occurrence whose due date falls in `month` even if it was actually
 * settled in a different month — see amelioration-v2.md/abonnements.md "Calculs": a charge
 * due 28 February and paid 2 March is 100% due and 100% "réglé" in February's cohort (dated
 * "payé le 2 mars"), while March's own occurrence remains separate and unrelated. This is the
 * complement to `transactionsForMonth`/`monthSummary`'s "flux réalisé", which already buckets
 * settlements by their real date and needs no change for that side.
 * A transaction linked to the occurrence (any status, same keys as `transactionsForMonth`) is its
 * explicit record — amount adjusted for this month only, or amount actually settled — so it
 * replaces the projection as `dueAmountMinor`/`currency`, exactly as Mon mois shows it; the model
 * has no partial settlement, so a linked settlement closes the occurrence (reste dû 0). */
export function occurrenceCohort(
  data: FinanceData,
  month: string,
): OccurrenceCohortItem[] {
  monthParts(month);
  const linkedTo = occurrenceLinks(data.transactions);
  const items: OccurrenceCohortItem[] = [];
  for (const recurrence of data.recurrences) {
    const date = occurrenceDueDate(recurrence, month);
    if (date === null) continue;
    const projectedAmountMinor = recurrenceAmountAt(recurrence, date);
    const linked = linkedTo(recurrence.id, date);
    items.push({
      recurrenceId: recurrence.id,
      occurrenceDate: date,
      dueAmountMinor: linked ? linked.amountMinor : projectedAmountMinor,
      currency: linked ? linked.currency : recurrence.currency,
      projectedAmountMinor,
      adjusted:
        !!linked &&
        (linked.amountMinor !== projectedAmountMinor ||
          linked.currency !== recurrence.currency),
      accountId: recurrence.accountId,
      kind: recurrence.kind,
      recurrenceType: recurrence.recurrenceType,
      label: recurrence.label,
      settled:
        linked?.status === "settled"
          ? {
              transactionId: linked.id,
              date: linked.date,
              amountMinor: linked.amountMinor,
              currency: linked.currency,
            }
          : null,
    });
  }
  return items.sort(
    (a, b) =>
      a.occurrenceDate.localeCompare(b.occurrenceDate) ||
      a.recurrenceId.localeCompare(b.recurrenceId),
  );
}

export type CohortSummary = {
  dueMinor: number | null;
  settledMinor: number | null;
  remainingMinor: number | null;
  activeCount: number;
  partial: boolean;
  excluded: number;
};
/** amelioration-v2.md's résumé compact for expense-kind recurring occurrences: "Dû en <mois>",
 * "Réglé pour <mois>" and "Reste dû", each converted to `currency`. Without `types`, income
 * recurrences don't fit "due" framing and are excluded from this aggregate — their own settlement still shows
 * per-occurrence (`occurrenceCohort`) and in the realized flow (`monthSummary`). A `saving`
 * recurrence (mise de côté) is excluded too, per abonnements.md "les transferts et mises de
 * côté ne gonflent pas dépenses et revenus" — it still shows per-occurrence in `occurrenceCohort`
 * itself. `activeCount` counts every active recurrence regardless of kind or classification. A
 * month with no due occurrence at all is a confident, computed 0 — that absence is a fact about
 * the recurrence rules, not a missing observation — but a missing FX rate on any due or settled
 * amount makes the whole trio null/partial instead of silently treating that one item as zero,
 * mirroring wealthSummary.
 * With `types` (e.g. ["bill"] or ["income"] for Factures), the scope is instead the occurrences
 * whose classification is listed — no implicit saving exclusion; "income" is reserved for income
 * recurrences (validation.ts), so ["income"] reads as "attendu / reçu / reste à recevoir" — and
 * `activeCount` counts only the active recurrences of those types. Without it, both are unchanged.
 * A settled occurrence's due amount IS its settlement (see occurrenceCohort), so both sides are
 * converted at the same date — the settlement's, as before — rather than letting two dated rates
 * invent a non-zero "reste dû" on an occurrence that is closed. */
export function cohortSummary(
  data: FinanceData,
  month: string,
  currency: string,
  types?: readonly Recurrence["recurrenceType"][],
): CohortSummary {
  const items = occurrenceCohort(data, month).filter((i) =>
    types
      ? types.includes(i.recurrenceType)
      : i.kind === "expense" && i.recurrenceType !== "saving",
  );
  const dueParts: number[] = [];
  const settledParts: number[] = [];
  let excluded = 0;
  for (const item of items) {
    const dueValue = convertMinor(
      item.dueAmountMinor,
      item.currency,
      currency,
      data.fxRates,
      item.settled?.date ?? item.occurrenceDate,
    );
    if (dueValue === null) {
      excluded++;
      continue;
    }
    dueParts.push(dueValue);
    if (item.settled) {
      const settledValue = convertMinor(
        item.settled.amountMinor,
        item.settled.currency,
        currency,
        data.fxRates,
        item.settled.date ?? item.occurrenceDate,
      );
      if (settledValue === null) {
        excluded++;
        continue;
      }
      settledParts.push(settledValue);
    }
  }
  const partial = excluded > 0;
  const dueMinor = partial ? null : sum(dueParts);
  const settledMinor = partial ? null : sum(settledParts);
  return {
    dueMinor,
    settledMinor,
    remainingMinor:
      dueMinor !== null && settledMinor !== null
        ? sum([dueMinor, -settledMinor])
        : null,
    activeCount: data.recurrences.filter(
      (r) => r.active && (!types || types.includes(r.recurrenceType)),
    ).length,
    partial,
    excluded,
  };
}

/** "Ce mois seulement" : fixes the amount of ONE occurrence, leaving its recurrence and every
 * other month untouched (for "ce mois et les suivants", use `withRecurrenceAmount` from the
 * month's first day instead). The occurrence's linked transaction (`findOccurrenceTransaction`),
 * if any, gets only its `amountMinor` replaced — status, dates, documents and provenance stay as
 * they are. Otherwise the projection (`projectedOccurrence`) is persisted, status "planned",
 * with this amount — so Mon mois, Abonnements and Factures all read the same single record, and
 * a later recurrence amount change never overrides it. `amountMinor` is read in the currency of
 * the record it lands on: the linked transaction's own (cohort item `currency`) when one
 * exists, else the recurrence's.
 * Asking for the rule's own amount (`recurrenceAmountAt`) returns to the projection: nothing is
 * created (same `data` reference), and a linked transaction that only carried an amount
 * (`isBareProjection`) is removed; one holding any other fact — a settlement, a document, a
 * « Remis à prévu » trace, an imported identity or any edited field — is kept, amount updated. */
export function withOccurrenceAmount(
  data: FinanceData,
  recurrenceId: string,
  occurrenceDate: string,
  amountMinor: number,
): FinanceData {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0)
    throw new Error("Montant invalide.");
  const recurrence = data.recurrences.find((r) => r.id === recurrenceId);
  if (!recurrence) throw new Error("Récurrence introuvable.");
  if (
    !isDate(occurrenceDate) ||
    occurrenceDueDate(recurrence, occurrenceDate.slice(0, 7)) !== occurrenceDate
  )
    throw new Error("Cette date n’est pas une échéance de cette récurrence.");
  const projected = projectedOccurrence(recurrence, occurrenceDate);
  const backToRule = amountMinor === projected.amountMinor;
  const linked = findOccurrenceTransaction(
    data.transactions,
    recurrence.id,
    occurrenceDate,
  );
  if (!linked) {
    if (backToRule) return data;
    // Its id is taken by a transaction linked to another occurrence: never overwrite or
    // duplicate it.
    if (data.transactions.some((t) => t.id === projected.id))
      throw new Error(
        "Identifiant d’échéance déjà utilisé par une autre opération.",
      );
    return {
      ...data,
      transactions: [...data.transactions, { ...projected, amountMinor }],
    };
  }
  if (backToRule && isBareProjection(data, recurrence, linked, projected))
    return {
      ...data,
      transactions: data.transactions.filter((t) => t !== linked),
    };
  if (linked.amountMinor === amountMinor) return data;
  return {
    ...data,
    transactions: data.transactions.map((t) =>
      t === linked ? { ...t, amountMinor } : t,
    ),
  };
}

/** The app stamps « Modification manuelle le <horodatage> » on every manual change: that trace
 * records an edit, not a fact about the occurrence, so it never blocks returning to the rule. */
function withoutManualTraces(note: string): string {
  return note
    .split(" · ")
    .filter((part) => !/^Modification manuelle le \d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(part))
    .join(" · ");
}

/** True when `linked` states nothing the projection doesn't, apart from its amount — so
 * removing it loses no fact: still "planned", no document attached, no « Remis à prévu »
 * trace of an earlier settlement (nor any other note), no imported identity of its own, and
 * the same id, label, kind, currency, date, account and category as the projection. */
function isBareProjection(
  data: FinanceData,
  recurrence: Recurrence,
  linked: Transaction,
  projected: Transaction,
): boolean {
  const note = linked.source.note ?? "";
  return (
    linked.status === "planned" &&
    !data.documents.some((d) => d.transactionId === linked.id) &&
    !note.includes("Remis à prévu") &&
    withoutManualTraces(note) === withoutManualTraces(projected.source.note ?? "") &&
    linked.source.system === projected.source.system &&
    (linked.source.sourceId === undefined ||
      linked.source.sourceId === recurrence.source.sourceId) &&
    linked.budgetMonth === undefined &&
    (
      [
        "id",
        "label",
        "kind",
        "currency",
        "date",
        "accountId",
        "category",
      ] as const
    ).every((key) => linked[key] === projected[key])
  );
}

export type RecurringFlowSummary = {
  paidMinor: number | null;
  receivedMinor: number | null;
  partial: boolean;
  excluded: number;
};
/** "Payé en <mois>" / "Reçu en <mois>", scoped to recurrence-linked settlements — the flux
 * réalisé side of the Abonnements page's résumé, kept separate from `cohortSummary`'s cohort
 * totals per amelioration-v2.md. Reuses `transactionsForMonth`, which already buckets a
 * settlement by its real date regardless of which month the occurrence was due in — so a
 * charge due in February and paid in March counts here in March, matching monthSummary. A
 * transfer/saving recurrence is excluded from both sides (amelioration-v2.md: "les transferts
 * et mises de côté ne gonflent pas dépenses et revenus"); a settled-but-undated transaction
 * makes the total partial rather than being silently skipped or counted as today. */
export function recurringFlowSummary(
  data: FinanceData,
  month: string,
  currency: string,
): RecurringFlowSummary {
  // A recurrence's own `kind` is only ever "income"/"expense" (see Recurrence in types.ts),
  // never "transfer" — so a `saving` recurrence's linked transactions must be recognized by
  // this lookup, not by `t.kind`, to actually honor "les mises de côté ne gonflent pas..." above.
  const recurrenceById = new Map(data.recurrences.map((r) => [r.id, r]));
  const paidParts: number[] = [];
  const receivedParts: number[] = [];
  let excluded = 0;
  for (const t of transactionsForMonth(data, month)) {
    if (!t.recurrenceId || t.status !== "settled" || t.kind === "transfer")
      continue;
    if (recurrenceById.get(t.recurrenceId)?.recurrenceType === "saving") continue;
    if (t.date === null) {
      excluded++;
      continue;
    }
    const value = convertMinor(t.amountMinor, t.currency, currency, data.fxRates, t.date);
    if (value === null) {
      excluded++;
      continue;
    }
    (t.kind === "income" ? receivedParts : paidParts).push(value);
  }
  const partial = excluded > 0;
  return {
    paidMinor: partial ? null : sum(paidParts),
    receivedMinor: partial ? null : sum(receivedParts),
    partial,
    excluded,
  };
}

/** The next date `recurrence` is due on or after `from` (inclusive), or null once it has none
 * left (inactive, or every remaining occurrence is past `endDate`). For a page listing
 * upcoming subscriptions/charges, not the cohort of a specific already-chosen month. Scans
 * forward month by month, bounded the same way `availableSummary` bounds its own scan (1200
 * months / 100 years comfortably covers `intervalMonths`'s 1–120 range). */
export function nextOccurrenceDate(
  recurrence: Recurrence,
  from = today(),
): string | null {
  if (!isDate(from)) throw new Error("Date de référence invalide.");
  if (!recurrence.active) return null;
  if (recurrence.endDate && from > recurrence.endDate) return null;
  const [fromYear, fromMonth] = monthParts(
    (from > recurrence.startDate ? from : recurrence.startDate).slice(0, 7),
  );
  for (let offset = 0; offset < 1200; offset++) {
    const absoluteMonth = fromYear * 12 + fromMonth - 1 + offset;
    const year = Math.floor(absoluteMonth / 12),
      monthNumber = (absoluteMonth % 12) + 1;
    const month = `${String(year).padStart(4, "0")}-${String(monthNumber).padStart(2, "0")}`;
    const due = occurrenceDueDate(recurrence, month);
    if (due !== null && due >= from) return due;
  }
  return null;
}

function rateFraction(rate: string): [bigint, bigint] {
  if (!/^\d{1,24}(?:\.\d{1,18})?$/.test(rate))
    throw new Error("Taux de change décimal invalide.");
  const [whole, decimal = ""] = rate.split(".");
  const numerator = BigInt(whole + decimal);
  if (numerator <= 0n) throw new Error("Le taux de change doit être positif.");
  return [numerator, 10n ** BigInt(decimal.length)];
}
function roundRatio(numerator: bigint, denominator: bigint): number {
  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator < 0n ? -numerator : numerator;
  return safeNumber(sign * ((absolute + denominator / 2n) / denominator));
}

/** Exact rational FX, round half away from zero once to a hundredth. Direct/inverse only;
 * missing dated rates return null. No 1:1 assumption, triangulation or future rates. */
export function convertMinor(
  amount: number,
  from: string,
  to: string,
  rates: FxRate[],
  at = today(),
): number | null {
  if (!Number.isSafeInteger(amount))
    throw new Error("Montant monétaire invalide.");
  if (!isDate(at)) throw new Error("Date de conversion invalide.");
  if (from === to) return amount;
  const rate = rates
    .filter(
      (r) =>
        r.asOf <= at &&
        ((r.from === from && r.to === to) || (r.from === to && r.to === from)),
    )
    .sort(
      (a, b) => b.asOf.localeCompare(a.asOf) || (a.from === from ? -1 : 1),
    )[0];
  if (!rate) return null;
  const [numerator, denominator] = rateFraction(rate.rate);
  return rate.from === from
    ? roundRatio(BigInt(amount) * numerator, denominator)
    : roundRatio(BigInt(amount) * denominator, numerator);
}

export type MonthSummary = {
  incomePlanned: number | null;
  incomeSettled: number | null;
  expensePlanned: number | null;
  expenseSettled: number | null;
  /** Monthly projection, never a bank balance or spendable money. Unknown perimeter gives null. */
  remaining: number | null;
  unknownCount: number;
};
export function monthSummary(
  data: FinanceData,
  month: string,
  currency: string,
): MonthSummary {
  // A `saving` recurrence (mise de côté) is out of scope here exactly like a transfer, per
  // abonnements.md "les transferts et mises de côté ne gonflent pas dépenses et revenus" —
  // its own `kind` is only ever "income"/"expense" (see Recurrence in types.ts), never
  // "transfer", so it must be recognized by its linked recurrence's classification, not by
  // the transaction's own kind. cohortSummary/recurringFlowSummary already honor this; this
  // mirrors that exclusion for the realized-flow totals Mon mois and Accueil actually show.
  const savingRecurrenceIds = new Set(
    data.recurrences
      .filter((r) => r.recurrenceType === "saving")
      .map((r) => r.id),
  );
  const outOfScope = (t: Transaction) =>
    t.kind === "transfer" ||
    (!!t.recurrenceId && savingRecurrenceIds.has(t.recurrenceId));
  const buckets = {
    incomePlanned: [] as number[],
    incomeSettled: [] as number[],
    expensePlanned: [] as number[],
    expenseSettled: [] as number[],
  };
  // Undated income/expense cannot be assigned to a month: disclose incomplete projection.
  let unknownCount =
    data.transactions.filter(
      (t) => !outOfScope(t) && t.date === null && !t.budgetMonth,
    ).length + data.reviewItems.length;
  for (const transaction of transactionsForMonth(data, month)) {
    if (outOfScope(transaction)) continue;
    // A budget month is not evidence of the month in which money was settled.
    if (
      transaction.status === "unknown" ||
      (transaction.status === "settled" && transaction.date === null)
    ) {
      unknownCount++;
      continue;
    }
    const amount =
      transaction.currency === currency
        ? transaction.amountMinor
        : transaction.date === null
          ? null
          : convertMinor(
              transaction.amountMinor,
              transaction.currency,
              currency,
              data.fxRates,
              transaction.date,
            );
    if (amount === null) {
      unknownCount++;
      continue;
    }
    const key =
      `${transaction.kind}${transaction.status === "settled" ? "Settled" : "Planned"}` as keyof typeof buckets;
    buckets[key].push(amount);
  }
  const hasIncome =
    buckets.incomePlanned.length + buckets.incomeSettled.length > 0;
  const hasExpense =
    buckets.expensePlanned.length + buckets.expenseSettled.length > 0;
  const incomePlanned = hasIncome ? sum(buckets.incomePlanned) : null,
    incomeSettled = hasIncome ? sum(buckets.incomeSettled) : null;
  const expensePlanned = hasExpense ? sum(buckets.expensePlanned) : null,
    expenseSettled = hasExpense ? sum(buckets.expenseSettled) : null;
  return {
    incomePlanned,
    incomeSettled,
    expensePlanned,
    expenseSettled,
    remaining:
      unknownCount || !hasIncome || !hasExpense
        ? null
        : sum([
            incomePlanned!,
            incomeSettled!,
            -expensePlanned!,
            -expenseSettled!,
          ]),
    unknownCount,
  };
}

export type ValueMeasure = {
  valueMinor: number | null;
  valuationDate: string | null;
};
/** total: balance is the full account value. components: balance is cash, plus positions.
 * A missing component invalidates that account, rather than pretending it is zero. A debt's
 * value is always negative regardless of how its sign was entered. `valuationDate` is the
 * account's own latest balance date; for `components` mode this is the cash leg's date, not a
 * synthetic date spanning every position — a caller needing a stricter common date across a
 * components account's positions must still check each position's own `asOf` itself. */
export function accountValue(
  account: Account,
  positions: Position[],
  currency: string,
  rates: FxRate[],
  at = today(),
): ValueMeasure {
  const observation = latestBalance(account, at);
  let valueMinor =
    observation?.amountMinor == null
      ? null
      : convertMinor(
          observation.amountMinor,
          account.currency,
          currency,
          rates,
          at,
        );
  if (account.valuationMode === "components") {
    const parts: number[] = valueMinor === null ? [] : [valueMinor];
    let incomplete = valueMinor === null;
    for (const position of positions.filter((p) => p.accountId === account.id)) {
      const value =
        position.asOf === null ||
        position.asOf > at ||
        position.valueMinor === null
          ? null
          : convertMinor(
              position.valueMinor,
              position.currency,
              currency,
              rates,
              at,
            );
      if (value === null) incomplete = true;
      else parts.push(value);
    }
    valueMinor = incomplete ? null : sum(parts);
  }
  if (valueMinor !== null && account.kind === "debt")
    valueMinor = -Math.abs(valueMinor);
  return {
    valueMinor,
    valuationDate: valueMinor === null ? null : (observation?.asOf ?? null),
  };
}

export type WealthSummary = {
  totalMinor: number | null;
  partial: boolean;
  excluded: number;
  items: { accountId: string; valueMinor: number | null }[];
};
export function wealthSummary(
  data: FinanceData,
  currency: string,
  at = today(),
): WealthSummary {
  if (!isDate(at)) throw new Error("Date d’évaluation invalide.");
  const items = data.accounts.map((account) => ({
    accountId: account.id,
    valueMinor: accountValue(account, data.positions, currency, data.fxRates, at)
      .valueMinor,
  }));
  const known = items.flatMap((item) =>
    item.valueMinor === null ? [] : [item.valueMinor],
  );
  const excluded = items.length - known.length;
  return {
    totalMinor: known.length ? sum(known) : null,
    partial: excluded > 0 || items.length === 0,
    excluded,
    items,
  };
}

export type Ranked<T> = { item: T; valueMinor: number; valuationDate: string };
export type RankedList<T> = { ranked: Ranked<T>[]; toValue: T[] };
/** Descending by value, ties broken by `secondaryKey` (ascending; `Array.prototype.sort` is
 * itself stable, so this is the only tiebreaker applied — no further invented order). Anything
 * without both a comparable value and a valuation date goes to `toValue` ("À valoriser")
 * instead of being placed by a guessed order — see amelioration-v2.md "Listes et ordre".
 * `measure` decides what "comparable value" means for `T`; this function only ranks and
 * groups, it never normalizes or converts a value itself (e.g. an annual amount is not
 * silently turned into a monthly equivalent — the caller's `measure` must already return
 * values on the same footing before comparing them). */
export function rankByValue<T>(
  items: T[],
  measure: (item: T) => ValueMeasure,
  secondaryKey: (item: T) => string,
): RankedList<T> {
  const ranked: Ranked<T>[] = [];
  const toValue: T[] = [];
  for (const item of items) {
    const { valueMinor, valuationDate } = measure(item);
    if (valueMinor === null || valuationDate === null) toValue.push(item);
    else ranked.push({ item, valueMinor, valuationDate });
  }
  ranked.sort((a, b) =>
    a.valueMinor === b.valueMinor
      ? secondaryKey(a.item).localeCompare(secondaryKey(b.item))
      : a.valueMinor > b.valueMinor
        ? -1
        : 1,
  );
  return { ranked, toValue };
}

/** Accounts ranked from largest to smallest comparable value in `currency`, matching
 * docs/AUDIT_UI_V2.md's "du plus gros au plus petit" requirement. A debt's negative value
 * still sorts by that signed value (amelioration-v2.md: "dettes traitées selon la valeur
 * patrimoniale affichée") — a larger debt ranks lower, it is not moved to `toValue`. */
export function rankAccounts(
  data: FinanceData,
  currency: string,
  at = today(),
): RankedList<Account> {
  return rankByValue(
    data.accounts,
    (account) => accountValue(account, data.positions, currency, data.fxRates, at),
    (account) => account.id,
  );
}

export type AvailableSummary = {
  amountMinor: number | null;
  asOf: string | null;
  partial: boolean;
};
/** Conservative current bank cash projection. Only today's observed balances may be called
 * available; historical balances remain visible in wealth, with their original date. */
export function availableSummary(
  data: FinanceData,
  currency: string,
  month: string,
): AvailableSummary {
  monthParts(month);
  const at = today();
  const unknown: AvailableSummary = {
    amountMinor: null,
    asOf: null,
    partial: true,
  };
  if (month !== at.slice(0, 7) || data.reviewItems.length > 0) return unknown;
  const banks = data.accounts.filter((a) => a.kind === "bank");
  if (!banks.length) return unknown;
  const ids = new Set(banks.map((a) => a.id));
  const amounts: number[] = [];
  for (const bank of banks) {
    const balance = latestBalance(bank, at);
    if (!balance || balance.asOf !== at || balance.amountMinor === null)
      return unknown;
    const value = convertMinor(
      balance.amountMinor,
      bank.currency,
      currency,
      data.fxRates,
      at,
    );
    if (value === null) return unknown;
    amounts.push(value);
  }
  // An unallocated reserve cannot safely be assumed to concern another account.
  for (const goal of data.goals.filter(
    (g) => g.accountId === null || ids.has(g.accountId),
  )) {
    if (
      goal.accountId === null ||
      goal.reservedMinor === null ||
      goal.asOf === null ||
      goal.asOf > at
    )
      return unknown;
    const value = convertMinor(
      goal.reservedMinor,
      goal.currency,
      currency,
      data.fxRates,
      at,
    );
    if (value === null) return unknown;
    amounts.push(-value);
  }
  if (
    data.transactions.some(
      (t) => t.kind !== "income" && t.status !== "settled" && t.date === null,
    )
  )
    return unknown;
  // An undated settlement cannot be reconciled to the observed balance; a day-only
  // balance also cannot establish whether it includes a settlement on that same day.
  if (
    data.transactions.some(
      (t) =>
        t.status === "settled" &&
        (t.date === null || t.date === at) &&
        (t.accountId === null ||
          ids.has(t.accountId) ||
          (t.destinationAccountId && ids.has(t.destinationAccountId))),
    )
  )
    return unknown;
  const commitments = transactionsForMonth(data, month);
  // Keep explicit prior-month unpaid commitments until the user settles or removes them.
  commitments.push(
    ...data.transactions.filter(
      (t) =>
        t.date !== null && t.date.slice(0, 7) < month && t.status !== "settled",
    ),
  );
  // Older virtual occurrences are not proof of either payment or a remaining liability.
  // Require reconciliation of them before making a spendable-money claim.
  const reconciledOccurrences = new Set(
    data.transactions
      .filter((t) => t.recurrenceId && t.occurrenceDate)
      .map((t) => `${t.recurrenceId}:${t.occurrenceDate}`),
  );
  for (const recurrence of data.recurrences.filter(
    (r) =>
      r.active &&
      r.kind === "expense" &&
      (r.accountId === null || ids.has(r.accountId)),
  )) {
    const [startYear, startMonth] = monthParts(
      recurrence.startDate.slice(0, 7),
    );
    const [targetYear, targetMonth] = monthParts(month);
    const monthCount = (targetYear - startYear) * 12 + targetMonth - startMonth;
    for (
      let offset = 0, inspected = 0;
      offset < monthCount;
      offset += recurrence.intervalMonths
    ) {
      if (++inspected > 1200) return unknown;
      const absoluteMonth = startYear * 12 + startMonth - 1 + offset;
      const year = Math.floor(absoluteMonth / 12),
        monthNumber = (absoluteMonth % 12) + 1;
      const due = `${String(year).padStart(4, "0")}-${String(monthNumber).padStart(2, "0")}-${String(Math.min(recurrence.day, daysInMonth(year, monthNumber))).padStart(2, "0")}`;
      if (due < recurrence.startDate) continue;
      if (recurrence.endDate && due > recurrence.endDate) break;
      if (!reconciledOccurrences.has(`${recurrence.id}:${due}`)) return unknown;
    }
  }
  for (const transaction of commitments) {
    if (transaction.kind === "income" || transaction.status === "settled")
      continue;
    if (transaction.accountId === null) return unknown;
    if (!ids.has(transaction.accountId)) continue;
    if (transaction.status === "unknown") return unknown;
    // Past unpaid planned expenses are still commitments, including overdue ones this month.
    if (
      transaction.kind === "transfer" &&
      transaction.destinationAccountId &&
      ids.has(transaction.destinationAccountId)
    )
      continue;
    const value = convertMinor(
      transaction.amountMinor,
      transaction.currency,
      currency,
      data.fxRates,
      at,
    );
    if (value === null) return unknown;
    amounts.push(-value);
  }
  return { amountMinor: sum(amounts), asOf: at, partial: false };
}
