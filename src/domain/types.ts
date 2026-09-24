export type Currency = string;
export type Source = {
  system: "manual" | "notion" | "import" | "demo";
  sourceId?: string;
  url?: string;
  importedAt?: string;
  updatedAt?: string;
  note?: string;
};
export type Balance = {
  id: string;
  amountMinor: number | null;
  asOf: string | null;
  source: Source;
};
export type Account = {
  id: string;
  name: string;
  institution: string;
  kind: "bank" | "savings" | "investment" | "debt";
  /** « Type de compte » as the person names it (Compte courant, 3e pilier, Léna…), used only
   * to group and label accounts; `kind` still drives every calculation. Absent: derived from
   * `kind` (see accountTypes.ts). */
  group?: string;
  currency: Currency;
  valuationMode: "total" | "components";
  balances: Balance[];
  source: Source;
};
export type Transaction = {
  id: string;
  label: string;
  kind: "income" | "expense" | "transfer";
  amountMinor: number;
  currency: Currency;
  status: "planned" | "settled" | "unknown";
  date: string | null;
  budgetMonth?: string;
  accountId: string | null;
  destinationAccountId?: string | null;
  destinationAmountMinor?: number | null;
  category: string;
  recurrenceId?: string;
  occurrenceDate?: string;
  source: Source;
};
/** A superseded recurrence amount: it applied from `effectiveFrom` (inclusive) until the next
 * dated change. Never rewritten once superseded — see `recurrenceAmountAt` in finance.ts. */
export type RecurrenceAmount = {
  amountMinor: number;
  effectiveFrom: string;
};
/** Classification distinct from `kind`: `income` is required exactly when `kind` is `"income"`.
 * `subscription`/`bill`/`saving` only apply to expense recurrences; `other` marks a value
 * migrated from a schema that had no classification, still to be verified by hand. */
export type RecurrenceType =
  | "subscription"
  | "bill"
  | "income"
  | "saving"
  | "other";
export type Recurrence = {
  id: string;
  label: string;
  kind: "income" | "expense";
  recurrenceType: RecurrenceType;
  /** Amount in effect from `amountEffectiveFrom` (or `startDate` if unset) onward. Editing it
   * must go through `withRecurrenceAmount` so earlier, still-unsettled virtual occurrences keep
   * the amount that was actually in effect for them instead of being rewritten retroactively. */
  amountMinor: number;
  /** Date from which `amountMinor` applies; defaults to `startDate` when absent. */
  amountEffectiveFrom?: string;
  /** Prior amounts, each dated from when it started applying, strictly before
   * `amountEffectiveFrom`. Populated automatically by `withRecurrenceAmount`; never read or
   * written by hand. */
  amountHistory?: RecurrenceAmount[];
  currency: Currency;
  accountId: string | null;
  category: string;
  day: number;
  intervalMonths: number;
  startDate: string;
  endDate?: string | null;
  active: boolean;
  source: Source;
};
export type Goal = {
  id: string;
  name: string;
  targetMinor: number | null;
  reservedMinor: number | null;
  currency: Currency;
  accountId: string | null;
  dueDate: string | null;
  asOf: string | null;
  source: Source;
};
export type Position = {
  id: string;
  accountId: string;
  name: string;
  symbol: string;
  assetType: "stock" | "etf" | "option" | "crypto" | "other";
  quantity: string | null;
  valueMinor: number | null;
  currency: Currency;
  asOf: string | null;
  source: Source;
};
export type Document = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl?: string;
  url?: string;
  transactionId?: string | null;
  addedAt: string;
  source: Source;
};
export type FxRate = {
  from: string;
  to: string;
  rate: string;
  asOf: string;
  source: Source;
};
export type ReviewItem = {
  id: string;
  title: string;
  reason: string;
  source: Source;
  raw?: Record<string, unknown>;
};
/** 1: no recurrence classification. 2: adds `Recurrence.recurrenceType`. A validated
 * `FinanceData` in memory is always the current version; `migrateToCurrentVersion` in
 * `migration.ts` upgrades older raw JSON before `validateData` runs. */
export type FinanceData = {
  version: 2;
  accounts: Account[];
  transactions: Transaction[];
  recurrences: Recurrence[];
  goals: Goal[];
  positions: Position[];
  documents: Document[];
  fxRates: FxRate[];
  reviewItems: ReviewItem[];
  preferences: { baseCurrency: Currency; locale: string };
  importedAt?: string;
};
export const emptyData = (): FinanceData => ({
  version: 2,
  accounts: [],
  transactions: [],
  recurrences: [],
  goals: [],
  positions: [],
  documents: [],
  fxRates: [],
  reviewItems: [],
  preferences: { baseCurrency: "CHF", locale: "fr-CH" },
});
