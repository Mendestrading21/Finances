import { accountValue, today } from "./finance";
import type { Account, FinanceData } from "./types";

/** « Type de compte », comme dans le Notion de l'utilisateur : un libellé pour regrouper et
 * lire ses comptes (Compte courant, 3e pilier, Léna…). Chaque type prédéfini fixe aussi la
 * nature de calcul (`kind`) ; un type libre garde la nature choisie à côté. */
export type AccountTypePreset = {
  label: string;
  kind: Account["kind"];
  icon: AccountTypeIcon;
};
export type AccountTypeIcon =
  | "bank"
  | "vault"
  | "shield"
  | "document"
  | "umbrella"
  | "chart"
  | "briefcase"
  | "card"
  | "heart";

export const ACCOUNT_TYPES: readonly AccountTypePreset[] = [
  { label: "Compte courant", kind: "bank", icon: "bank" },
  { label: "Épargne", kind: "savings", icon: "vault" },
  { label: "Épargne secours", kind: "savings", icon: "shield" },
  { label: "Impôts", kind: "savings", icon: "document" },
  { label: "2e pilier", kind: "savings", icon: "umbrella" },
  { label: "3e pilier", kind: "savings", icon: "umbrella" },
  { label: "Trading", kind: "investment", icon: "chart" },
  { label: "Business", kind: "bank", icon: "briefcase" },
  { label: "Dette", kind: "debt", icon: "card" },
];

/** Type shown for an account without one: the preset matching its calculation nature. */
const BY_KIND: Record<Account["kind"], string> = {
  bank: "Compte courant",
  savings: "Épargne",
  investment: "Trading",
  debt: "Dette",
};

// Casse, accents composés ou non et espaces ignorés : « Léna », « léna » et « LÉNA » sont un type.
const normalized = (label: string) =>
  label.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");

/** The preset named `label` (case and spaces ignored), if any. */
export function accountTypePreset(label: string): AccountTypePreset | undefined {
  const key = normalized(label);
  return ACCOUNT_TYPES.find((preset) => normalized(preset.label) === key);
}

/** The account's type label: its own, else the one matching its nature. A preset keeps its
 * canonical spelling, so « 3E PILIER » and « 3e pilier » are one group. */
export function accountTypeOf(account: Pick<Account, "group" | "kind">): string {
  const own = account.group?.trim();
  if (!own) return BY_KIND[account.kind];
  return accountTypePreset(own)?.label ?? own;
}

/** A preset's icon; a type named by the person (e.g. « Léna ») gets the personal one. */
export function accountTypeIcon(label: string): AccountTypeIcon {
  return accountTypePreset(label)?.icon ?? "heart";
}

export type WealthGroup = {
  label: string;
  /** Sum of the accounts valued at `at`, in the display currency; null when none is. */
  totalMinor: number | null;
  count: number;
  /** Accounts left out (no dated balance, no exchange rate): the total is then partial. */
  excluded: number;
  accountIds: string[];
};

/** Patrimoine par type de compte, with the same per-account values as `wealthSummary` (so the
 * groups add up to its total), largest first; a debt counts negatively. Types differing only by
 * case or spacing are one group, named as first written. */
export function wealthByType(
  data: FinanceData,
  currency: string,
  at = today(),
): WealthGroup[] {
  const groups = new Map<string, WealthGroup>();
  for (const account of data.accounts) {
    const label = accountTypeOf(account);
    const key = normalized(label);
    const group =
      groups.get(key) ??
      ({ label, totalMinor: null, count: 0, excluded: 0, accountIds: [] } as WealthGroup);
    const { valueMinor } = accountValue(account, data.positions, currency, data.fxRates, at);
    group.count++;
    group.accountIds.push(account.id);
    if (valueMinor === null) group.excluded++;
    else group.totalMinor = (group.totalMinor ?? 0) + valueMinor;
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) =>
      (b.totalMinor ?? Number.NEGATIVE_INFINITY) - (a.totalMinor ?? Number.NEGATIVE_INFINITY) ||
      a.label.localeCompare(b.label, "fr"),
  );
}
