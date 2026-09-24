import { describe, expect, it } from "vitest";
import {
  ACCOUNT_TYPES,
  accountTypeIcon,
  accountTypeOf,
  wealthByType,
} from "./accountTypes";
import { wealthSummary } from "./finance";
import { emptyData, type Account, type FinanceData } from "./types";
import { validateData } from "./validation";

const source = { system: "manual" as const };
const account = (
  id: string,
  amountMinor: number | null,
  extra: Partial<Account> = {},
): Account => ({
  id,
  name: id,
  institution: "Banque",
  kind: "savings",
  currency: "CHF",
  valuationMode: "total",
  balances:
    amountMinor === null
      ? []
      : [{ id: `${id}:b`, amountMinor, asOf: "2026-09-20", source }],
  source,
  ...extra,
});
const data = (accounts: Account[], extra: Partial<FinanceData> = {}): FinanceData => ({
  ...emptyData(),
  accounts,
  ...extra,
});

describe("types de compte", () => {
  it("prend le type choisi, sinon celui de la nature, avec l'orthographe du type prédéfini", () => {
    expect(accountTypeOf({ kind: "bank" })).toBe("Compte courant");
    expect(accountTypeOf({ kind: "investment", group: "  " })).toBe("Trading");
    expect(accountTypeOf({ kind: "debt" })).toBe("Dette");
    expect(accountTypeOf({ kind: "savings", group: "3E PILIER " })).toBe("3e pilier");
    expect(accountTypeOf({ kind: "savings", group: " Léna " })).toBe("Léna");
    expect(accountTypeIcon("Léna")).toBe("heart");
    expect(accountTypeIcon("2e pilier")).toBe("umbrella");
    // Chaque nature a un type par défaut qui existe dans la liste.
    for (const kind of ["bank", "savings", "investment", "debt"] as const)
      expect(ACCOUNT_TYPES.some((t) => t.label === accountTypeOf({ kind }))).toBe(true);
  });

  it("additionne le patrimoine par type, du plus grand au plus petit, comme le total", () => {
    const d = data(
      [
        account("bcge", 20373600, { group: "Impôts" }),
        account("ubs", 20000000, { group: "Épargne" }),
        account("cash", 300000, { group: "épargne" }),
        account("poste", 829500, { group: "3e pilier" }),
        account("helvetia", 531000, { group: "3e pilier" }),
        account("lena", 1115000, { group: "Léna" }),
        account("lena-3a", 200000, { group: "Léna" }),
        account("card", 300000, { kind: "debt", group: "Dette" }),
        account("ib", 620000, { kind: "investment", currency: "USD", group: "Trading" }),
        account("revolut", null, { kind: "bank", group: "Compte courant" }),
      ],
      {
        fxRates: [{ from: "USD", to: "CHF", rate: "0.8", asOf: "2026-09-01", source }],
      },
    );
    const groups = wealthByType(d, "CHF", "2026-09-24");
    expect(groups.map((g) => [g.label, g.totalMinor, g.count, g.excluded])).toEqual([
      ["Impôts", 20373600, 1, 0],
      ["Épargne", 20300000, 2, 0],
      ["3e pilier", 1360500, 2, 0],
      ["Léna", 1315000, 2, 0],
      ["Trading", 496000, 1, 0],
      ["Dette", -300000, 1, 0],
      ["Compte courant", null, 1, 1],
    ]);
    const total = wealthSummary(d, "CHF", "2026-09-24").totalMinor;
    expect(groups.reduce((s, g) => s + (g.totalMinor ?? 0), 0)).toBe(total);
    expect(validateData(d)).toEqual(d);
  });

  it("regroupe un type écrit avec une autre casse, d'autres espaces ou des accents décomposés", () => {
    const groups = wealthByType(
      data([
        account("a", 100000, { group: "Léna" }),
        account("b", 50000, { group: "léna" }),
        account("c", 20000, { group: " LÉNA  " }),
        account("d", 10000, { group: "Le\u0301na" }),
        account("e", 5000, { group: "Mia" }),
      ]),
      "CHF",
      "2026-09-24",
    );
    expect(groups.map((g) => [g.label, g.totalMinor, g.accountIds])).toEqual([
      ["Léna", 180000, ["a", "b", "c", "d"]],
      ["Mia", 5000, ["e"]],
    ]);
  });

  it("valide le type : texte court, facultatif", () => {
    const withType = data([account("a", 100, { group: "Léna" })]);
    expect(validateData(withType)).toEqual(withType);
    expect(() => validateData(data([account("a", 100, { group: "x".repeat(61) })]))).toThrow();
    expect(() => validateData(data([account("a", 100, { group: "" })]))).toThrow();
  });
});
