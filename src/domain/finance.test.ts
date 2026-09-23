import { afterEach, describe, expect, it, vi } from "vitest";
import {
  availableSummary,
  cohortSummary,
  convertMinor,
  latestBalance,
  money,
  monthLabel,
  monthlyEquivalentMinor,
  monthSummary,
  nextOccurrenceDate,
  occurrenceCohort,
  parseMoney,
  rankAccounts,
  rankByValue,
  recurrenceAmountAt,
  recurringFlowSummary,
  today,
  transactionsForMonth,
  wealthSummary,
  withRecurrenceAmount,
} from "./finance";
import {
  emptyData,
  type Account,
  type FinanceData,
  type Recurrence,
  type Transaction,
} from "./types";

const source = { system: "manual" as const };
const account = (
  id = "bank",
  amount: number | null = 100000,
  asOf: string | null = "2026-09-17",
  extra: Partial<Account> = {},
): Account => ({
  id,
  name: id,
  institution: "",
  kind: "bank",
  currency: "CHF",
  valuationMode: "total",
  balances: [{ id: `${id}:balance`, amountMinor: amount, asOf, source }],
  source,
  ...extra,
});
const transaction = (extra: Partial<Transaction> = {}): Transaction => ({
  id: "expense",
  label: "Dépense",
  kind: "expense",
  amountMinor: 15000,
  currency: "CHF",
  status: "planned",
  date: "2026-09-20",
  accountId: "bank",
  category: "",
  source,
  ...extra,
});
const recurrence = (extra: Partial<Recurrence> = {}): Recurrence => ({
  id: "rent",
  label: "Loyer",
  kind: "expense",
  recurrenceType: "bill",
  amountMinor: 200000,
  currency: "CHF",
  accountId: "bank",
  category: "",
  day: 31,
  intervalMonths: 1,
  startDate: "2026-01-31",
  active: true,
  source,
  ...extra,
});
const data = (extra: Partial<FinanceData> = {}): FinanceData => ({
  ...emptyData(),
  ...extra,
});
afterEach(() => vi.useRealTimers());

describe("montants exacts", () => {
  it("accepte les centimes et formats suisse/français sans utiliser un flottant", () => {
    expect(parseMoney("1’234.05")).toBe(123405);
    expect(parseMoney("1 234,50")).toBe(123450);
    expect(parseMoney("0.29")).toBe(29);
    expect(parseMoney("-1.01")).toBe(-101);
    expect(parseMoney("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("refuse précision excessive, séparateurs ambigus, exponentiel et dépassement", () => {
    for (const value of [
      "1.001",
      "1,234.00",
      "1 23",
      "1e3",
      "CHF 10",
      "",
      "Infinity",
      "90071992547409.92",
    ])
      expect(() => parseMoney(value)).toThrow();
  });
  it("distingue montant absent et zéro explicite à l’affichage", () => {
    expect(money(null)).toBe("—");
    expect(money(0)).toContain("0.00");
    expect(money(123405)).toContain("234.05");
    expect(money(Number.MAX_SAFE_INTEGER)).toContain(".91");
    expect(money(-1)).toContain("-0.01");
    expect(() => money(10.5)).toThrow();
  });
  it("arrondit la conversion décimale seulement au centime final", () => {
    const rates = [
      { from: "USD", to: "CHF", rate: "0.915", asOf: "2026-09-01", source },
    ];
    expect(convertMinor(100, "USD", "CHF", rates, "2026-09-17")).toBe(92);
    expect(convertMinor(-100, "USD", "CHF", rates, "2026-09-17")).toBe(-92);
    expect(convertMinor(915, "CHF", "USD", rates, "2026-09-17")).toBe(1000);
  });
  it("n’utilise ni taux futur ni parité inventée", () => {
    expect(convertMinor(100, "EUR", "CHF", [], "2026-09-17")).toBeNull();
    expect(
      convertMinor(
        100,
        "EUR",
        "CHF",
        [{ from: "EUR", to: "CHF", rate: "1.1", asOf: "2026-10-01", source }],
        "2026-09-17",
      ),
    ).toBeNull();
  });
  it("garde le jour local", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 17, 0, 2));
    expect(today()).toBe("2026-09-17");
    expect(monthLabel("2026-09")).toContain("septembre");
  });
});

describe("observations et patrimoine", () => {
  it("exclut les soldes non datés même quand l’import est daté", () => {
    const a = account("bank", 100000, null);
    a.balances[0].source = {
      system: "notion",
      importedAt: "2026-09-17T12:00:00Z",
    };
    expect(latestBalance(a, "2026-09-17")).toBeNull();
    expect(
      wealthSummary(data({ accounts: [a] }), "CHF", "2026-09-17"),
    ).toMatchObject({ totalMinor: null, partial: true, excluded: 1 });
  });
  it("prend la dernière observation d’une même journée et respecte une vue historique", () => {
    const a = account();
    a.balances = [
      { id: "old", amountMinor: 100, asOf: "2026-08-31", source },
      { id: "morning", amountMinor: 200, asOf: "2026-09-17", source },
      { id: "evening", amountMinor: 300, asOf: "2026-09-17", source },
      { id: "future", amountMinor: 400, asOf: "2026-10-01", source },
    ];
    expect(latestBalance(a, "2026-09-17")?.amountMinor).toBe(300);
    expect(latestBalance(a, "2026-09-01")?.amountMinor).toBe(100);
  });
  it("ne remplace pas une observation inconnue récente par une ancienne connue", () => {
    const a = account();
    a.balances.push({
      id: "unknown",
      amountMinor: null,
      asOf: "2026-09-18",
      source,
    });
    expect(
      wealthSummary(data({ accounts: [a] }), "CHF", "2026-09-18").totalMinor,
    ).toBeNull();
  });
  it("ne compte jamais positions et valeur totale de compte deux fois", () => {
    const holdings = [
      {
        id: "stock",
        accountId: "broker",
        name: "Action",
        symbol: "TEST",
        assetType: "stock" as const,
        quantity: "1",
        valueMinor: 40000,
        currency: "CHF",
        asOf: "2026-09-17",
        source,
      },
    ];
    const d = data({
      accounts: [
        account("broker", 100000, "2026-09-17", { kind: "investment" }),
      ],
      positions: holdings,
    });
    expect(wealthSummary(d, "CHF", "2026-09-17").totalMinor).toBe(100000);
    d.accounts[0].valuationMode = "components";
    expect(wealthSummary(d, "CHF", "2026-09-17").totalMinor).toBe(140000);
    d.positions[0].asOf = null as never;
    expect(wealthSummary(d, "CHF", "2026-09-17").totalMinor).toBeNull();
  });
  it("soustrait les dettes quelle que soit la convention de signe saisie", () => {
    expect(
      wealthSummary(
        data({
          accounts: [
            account("bank", 100000),
            account("debt", 20000, "2026-09-17", { kind: "debt" }),
          ],
        }),
        "CHF",
        "2026-09-17",
      ).totalMinor,
    ).toBe(80000);
    expect(
      wealthSummary(
        data({
          accounts: [account("debt", -20000, "2026-09-17", { kind: "debt" })],
        }),
        "CHF",
        "2026-09-17",
      ).totalMinor,
    ).toBe(-20000);
  });
  it("signale les comptes exclus faute de conversion", () => {
    const result = wealthSummary(
      data({
        accounts: [
          account(),
          account("foreign", 100000, "2026-09-17", { currency: "EUR" }),
        ],
      }),
      "CHF",
      "2026-09-17",
    );
    expect(result).toMatchObject({
      totalMinor: 100000,
      partial: true,
      excluded: 1,
    });
    expect(result.items[1].valueMinor).toBeNull();
  });
  it("refuse de déborder silencieusement lors de sommes", () => {
    expect(() =>
      wealthSummary(
        data({
          accounts: [account("a", Number.MAX_SAFE_INTEGER), account("b", 1)],
        }),
        "CHF",
        "2026-09-17",
      ),
    ).toThrow();
  });
});

describe("tri par valeur comparable", () => {
  it("classe du plus gros au plus petit", () => {
    const d = data({
      accounts: [
        account("small", 12845_00),
        account("big", 48150_00),
        account("mid", 36500_00),
      ],
    });
    const { ranked, toValue } = rankAccounts(d, "CHF", "2026-09-17");
    expect(ranked.map((r) => r.item.id)).toEqual(["big", "mid", "small"]);
    expect(toValue).toEqual([]);
  });
  it("classe une dette selon sa valeur patrimoniale signée, sans l'écarter en À valoriser", () => {
    const d = data({
      accounts: [
        account("bank", 50000, "2026-09-17"),
        account("debt", 20000, "2026-09-17", { kind: "debt" }),
      ],
    });
    const { ranked, toValue } = rankAccounts(d, "CHF", "2026-09-17");
    expect(ranked.map((r) => r.item.id)).toEqual(["bank", "debt"]);
    expect(ranked[1].valueMinor).toBe(-20000);
    expect(toValue).toEqual([]);
  });
  it("place les comptes sans taux commun dans À valoriser plutôt que de leur inventer un rang", () => {
    const d = data({
      accounts: [
        account("bank", 100000, "2026-09-17"),
        account("foreign", 50000, "2026-09-17", { currency: "EUR" }),
      ],
    });
    const { ranked, toValue } = rankAccounts(d, "CHF", "2026-09-17");
    expect(ranked.map((r) => r.item.id)).toEqual(["bank"]);
    expect(toValue.map((a) => a.id)).toEqual(["foreign"]);
  });
  it("place un compte à zéro dans le classement, pas dans À valoriser", () => {
    const d = data({ accounts: [account("zero", 0, "2026-09-17")] });
    const { ranked, toValue } = rankAccounts(d, "CHF", "2026-09-17");
    expect(ranked).toHaveLength(1);
    expect(ranked[0].valueMinor).toBe(0);
    expect(toValue).toEqual([]);
  });
  it("place un compte en composantes incomplètes dans À valoriser", () => {
    const d = data({
      accounts: [
        account("broker", 10000, "2026-09-17", {
          kind: "investment",
          valuationMode: "components",
        }),
      ],
      positions: [
        {
          id: "pos",
          accountId: "broker",
          name: "Action",
          symbol: "T",
          assetType: "stock",
          quantity: "1",
          valueMinor: null,
          currency: "CHF",
          asOf: "2026-09-17",
          source,
        },
      ],
    });
    const { ranked, toValue } = rankAccounts(d, "CHF", "2026-09-17");
    expect(ranked).toEqual([]);
    expect(toValue.map((a) => a.id)).toEqual(["broker"]);
  });
  it("départage des égalités par la clé secondaire, de façon stable et déterministe", () => {
    const d = data({
      accounts: [
        account("zeta", 10000, "2026-09-17"),
        account("alpha", 10000, "2026-09-17"),
      ],
    });
    const { ranked } = rankAccounts(d, "CHF", "2026-09-17");
    expect(ranked.map((r) => r.item.id)).toEqual(["alpha", "zeta"]);
  });
  it("ne normalise jamais une mesure elle-même : un rang brut annuel face à un mensuel doit être fourni déjà comparable par l'appelant", () => {
    // rankByValue only ranks and groups what `measure` gives it; it must never guess that
    // 120 (a yearly figure) and 11 (a monthly one) are on the same footing.
    const items = [
      { id: "yearly", amountMinor: 12000, valuationDate: "2026-09-01" },
      { id: "monthly", amountMinor: 1100, valuationDate: "2026-09-01" },
    ];
    const { ranked } = rankByValue(
      items,
      (i) => ({ valueMinor: i.amountMinor, valuationDate: i.valuationDate }),
      (i) => i.id,
    );
    // Ranked exactly by the raw values handed to it — 12000 > 1100 — proving no hidden
    // per-month/per-year normalization happens inside rankByValue itself.
    expect(ranked.map((r) => r.item.id)).toEqual(["yearly", "monthly"]);
  });
  it("groupe en À valoriser un élément sans date de valorisation même si sa valeur est connue", () => {
    const items = [{ id: "undated", valueMinor: 500 }];
    const { ranked, toValue } = rankByValue(
      items,
      (i) => ({ valueMinor: i.valueMinor, valuationDate: null }),
      (i) => i.id,
    );
    expect(ranked).toEqual([]);
    expect(toValue).toEqual(items);
  });
});

describe("mois et récurrences", () => {
  it("rabats le 31 au dernier jour de février, y compris année bissextile", () => {
    const d = data({ recurrences: [recurrence()] });
    expect(transactionsForMonth(d, "2026-02")[0].date).toBe("2026-02-28");
    expect(transactionsForMonth(d, "2028-02")[0].date).toBe("2028-02-29");
    expect(transactionsForMonth(d, "2026-03")[0].date).toBe("2026-03-31");
  });
  it("respecte le début, la fin et les intervalles annuels", () => {
    const d = data({
      recurrences: [
        recurrence({
          startDate: "2025-12-31",
          intervalMonths: 12,
          endDate: "2026-12-31",
        }),
      ],
    });
    expect(transactionsForMonth(d, "2026-11")).toHaveLength(0);
    expect(transactionsForMonth(d, "2026-12")).toHaveLength(1);
    expect(transactionsForMonth(d, "2027-12")).toHaveLength(0);
  });
  it("ne double pas une récurrence réglée et prend le mois réel d’un paiement tardif", () => {
    const d = data({
      recurrences: [recurrence()],
      transactions: [
        transaction({
          id: "payment",
          recurrenceId: "rent",
          occurrenceDate: "2026-09-30",
          status: "settled",
          date: "2026-10-02",
        }),
      ],
    });
    expect(transactionsForMonth(d, "2026-09")).toHaveLength(0);
    expect(
      transactionsForMonth(d, "2026-10").filter((t) => t.id === "payment"),
    ).toHaveLength(1);
  });
  it("ne réécrit pas rétroactivement une occurrence virtuelle passée après une hausse de prix", () => {
    // Créée en janvier 2026 à 20.00 CHF/mois. L’occurrence de juin, jamais réglée, doit
    // rester à 20.00 CHF même après la hausse à 30.00 CHF décidée en septembre.
    const rule = recurrence({
      id: "sub",
      amountMinor: 2000,
      day: 1,
      startDate: "2026-01-01",
    });
    const d = data({ recurrences: [rule] });
    expect(
      transactionsForMonth(d, "2026-06").find((t) => t.recurrenceId === "sub")
        ?.amountMinor,
    ).toBe(2000);
    const raised = withRecurrenceAmount(rule, 3000, "2026-09-17");
    const raisedData = data({ recurrences: [raised] });
    // L’occurrence passée non réglée garde l’ancien montant : ce cas échouait avant le
    // correctif (elle affichait rétroactivement 30.00 CHF).
    expect(
      transactionsForMonth(raisedData, "2026-06").find(
        (t) => t.recurrenceId === "sub",
      )?.amountMinor,
    ).toBe(2000);
    // Les occurrences à partir de la date d’effet utilisent le nouveau montant.
    expect(
      transactionsForMonth(raisedData, "2026-10").find(
        (t) => t.recurrenceId === "sub",
      )?.amountMinor,
    ).toBe(3000);
    // Un paiement déjà confirmé (Transaction persistante) n’est jamais réécrit par la
    // récurrence, quel que soit son montant d’origine.
    const settledData = data({
      recurrences: [raised],
      transactions: [
        transaction({
          id: "sub:2026-06-01",
          recurrenceId: "sub",
          occurrenceDate: "2026-06-01",
          status: "settled",
          date: "2026-06-01",
          amountMinor: 2000,
        }),
      ],
    });
    expect(
      transactionsForMonth(settledData, "2026-06").find(
        (t) => t.id === "sub:2026-06-01",
      )?.amountMinor,
    ).toBe(2000);
  });
  it("résout le montant en vigueur d’une récurrence à une date donnée, y compris sans historique", () => {
    const rule = recurrence({
      amountMinor: 2000,
      startDate: "2026-01-01",
    });
    expect(recurrenceAmountAt(rule, "2026-06-30")).toBe(2000);
    const raised = withRecurrenceAmount(rule, 3000, "2026-09-17");
    expect(recurrenceAmountAt(raised, "2026-09-16")).toBe(2000);
    expect(recurrenceAmountAt(raised, "2026-09-17")).toBe(3000);
    expect(recurrenceAmountAt(raised, "2026-12-01")).toBe(3000);
    // Un montant inchangé ne crée pas d’entrée d’historique inutile.
    expect(withRecurrenceAmount(raised, 3000, "2026-11-01")).toBe(raised);
    // Une seconde hausse conserve les deux paliers précédents.
    const raisedAgain = withRecurrenceAmount(raised, 4000, "2026-12-01");
    expect(recurrenceAmountAt(raisedAgain, "2026-03-01")).toBe(2000);
    expect(recurrenceAmountAt(raisedAgain, "2026-09-20")).toBe(3000);
    expect(recurrenceAmountAt(raisedAgain, "2026-12-01")).toBe(4000);
  });
  it("corrige un changement de montant encore en attente le même jour au lieu de l’archiver", () => {
    // Bug réel : deux modifications le même jour (cas courant, l’éditeur date par défaut à
    // aujourd’hui) créaient une entrée d’historique datée du jour même que le nouveau montant
    // courant, ce que validateData rejette ensuite comme incohérent.
    const rule = recurrence({ amountMinor: 2000, startDate: "2026-01-01" });
    const first = withRecurrenceAmount(rule, 3000, "2026-09-23");
    const corrected = withRecurrenceAmount(first, 3500, "2026-09-23");
    expect(corrected.amountMinor).toBe(3500);
    expect(corrected.amountEffectiveFrom).toBe("2026-09-23");
    // Le montant intermédiaire (3000) n’a jamais été en vigueur pour une occurrence : il n’est
    // pas archivé, l’historique garde uniquement le palier réellement passé (2000).
    expect(corrected.amountHistory).toEqual([
      { amountMinor: 2000, effectiveFrom: "2026-01-01" },
    ]);
    expect(recurrenceAmountAt(corrected, "2026-09-22")).toBe(2000);
    expect(recurrenceAmountAt(corrected, "2026-09-23")).toBe(3500);
  });
  it("corrige la date d’effet du changement courant vers une date plus tôt sans inverser les montants", () => {
    const rule = recurrence({ amountMinor: 2000, startDate: "2026-01-01" });
    const first = withRecurrenceAmount(rule, 3000, "2026-06-01");
    // La hausse devait en fait s’appliquer dès mars, pas juin : corriger la date d’effet du
    // changement encore courant (pas encore archivé) reste cohérent, pas seulement le montant.
    const corrected = withRecurrenceAmount(first, 4000, "2026-03-01");
    expect(corrected.amountHistory).toEqual([
      { amountMinor: 2000, effectiveFrom: "2026-01-01" },
    ]);
    // Avant le correctif, une date de juillet (après les deux dates d’effet) renvoyait à tort
    // le montant intermédiaire (3000) tandis qu’une date d’avril (avant) renvoyait le nouveau
    // montant (4000) — inversion chronologique. Les deux doivent maintenant renvoyer 4000.
    expect(recurrenceAmountAt(corrected, "2026-04-01")).toBe(4000);
    expect(recurrenceAmountAt(corrected, "2026-07-01")).toBe(4000);
    expect(recurrenceAmountAt(corrected, "2026-02-01")).toBe(2000);
  });
  it("refuse de reculer la date d’effet au-delà d’un changement déjà archivé", () => {
    const rule = recurrence({ amountMinor: 2000, startDate: "2026-01-01" });
    const first = withRecurrenceAmount(rule, 3000, "2026-06-01"); // history: [{2000, 2026-01-01}]
    const second = withRecurrenceAmount(first, 4000, "2026-09-01"); // archives {3000, 2026-06-01}
    expect(() => withRecurrenceAmount(second, 5000, "2026-06-01")).toThrow();
    expect(() => withRecurrenceAmount(second, 5000, "2026-01-01")).toThrow();
  });
  it("distingue prévu/reçu et prévu/payé, les transferts sont neutres", () => {
    const d = data({
      transactions: [
        transaction({
          id: "income1",
          kind: "income",
          status: "settled",
          amountMinor: 500000,
        }),
        transaction({ id: "income2", kind: "income", amountMinor: 100000 }),
        transaction({ id: "out1", status: "settled", amountMinor: 200000 }),
        transaction({ id: "out2", amountMinor: 50000 }),
        transaction({ id: "transfer", kind: "transfer", amountMinor: 900000 }),
      ],
    });
    expect(monthSummary(d, "2026-09", "CHF")).toEqual({
      incomePlanned: 100000,
      incomeSettled: 500000,
      expensePlanned: 50000,
      expenseSettled: 200000,
      remaining: 350000,
      unknownCount: 0,
    });
  });
  it("conserve le mois budgétaire sans inventer une date journalière", () => {
    const d = data({
      transactions: [
        transaction({ date: null, budgetMonth: "2026-09", status: "unknown" }),
      ],
    });
    expect(transactionsForMonth(d, "2026-09")[0].date).toBeNull();
    expect(transactionsForMonth(d, "2026-10")).toHaveLength(0);
    expect(monthSummary(d, "2026-09", "CHF").unknownCount).toBe(1);
    expect(monthSummary(d, "2026-10", "CHF").unknownCount).toBe(0);
  });
  it("ne confond pas le mois budgétaire et le mois de règlement d’une opération payée sans date", () => {
    const d = data({
      transactions: [
        transaction({
          id: "undated-income",
          kind: "income",
          status: "settled",
          date: null,
          budgetMonth: "2026-09",
        }),
        transaction({ status: "settled" }),
      ],
    });
    expect(transactionsForMonth(d, "2026-09")).toHaveLength(2);
    expect(monthSummary(d, "2026-09", "CHF")).toMatchObject({
      incomeSettled: null,
      expenseSettled: 15000,
      remaining: null,
      unknownCount: 1,
    });
    d.transactions[0].status = "planned";
    expect(monthSummary(d, "2026-09", "CHF").incomePlanned).toBe(15000);
  });
  it("absence de lignes n’est pas une valeur égale à zéro", () => {
    expect(monthSummary(emptyData(), "2026-09", "CHF")).toMatchObject({
      incomePlanned: null,
      incomeSettled: null,
      expensePlanned: null,
      expenseSettled: null,
      remaining: null,
    });
  });
  it("statut inconnu, date absente et FX manquant invalident la projection", () => {
    const d = data({
      transactions: [
        transaction({ id: "unknown", status: "unknown" }),
        transaction({ id: "undated", date: null }),
        transaction({ id: "fx", currency: "USD" }),
      ],
    });
    expect(monthSummary(d, "2026-09", "CHF")).toMatchObject({
      remaining: null,
      unknownCount: 3,
    });
  });
  it("les lignes mises en attente rendent la projection incomplète", () => {
    const d = data({
      transactions: [
        transaction(),
        transaction({ id: "salary", kind: "income" }),
      ],
      reviewItems: [
        {
          id: "review",
          title: "Montant à vérifier",
          reason: "Import partiel",
          source,
        },
      ],
    });
    expect(monthSummary(d, "2026-09", "CHF").remaining).toBeNull();
  });
  it("exclut une mise de côté réglée de expenseSettled, sans la confondre avec une vraie dépense", () => {
    const saving = recurrence({
      id: "saving",
      recurrenceType: "saving",
      amountMinor: 20000,
      day: 5,
      startDate: "2026-01-05",
    });
    const savingSettled = transaction({
      id: "saving:2026-09-05",
      amountMinor: 20000,
      status: "settled",
      date: "2026-09-05",
      recurrenceId: "saving",
      occurrenceDate: "2026-09-05",
    });
    const realExpense = transaction({
      id: "groceries",
      status: "settled",
      amountMinor: 15000,
    });
    const d = data({
      recurrences: [saving],
      transactions: [savingSettled, realExpense],
    });
    expect(monthSummary(d, "2026-09", "CHF")).toMatchObject({
      expenseSettled: 15000, // not 35000 (20000 de mise de côté + 15000 de vraie dépense)
    });
  });
  it("une mise de côté réglée sans date n’incrémente pas unknownCount (hors périmètre, pas inconnue)", () => {
    const saving = recurrence({
      id: "saving",
      recurrenceType: "saving",
      amountMinor: 20000,
      day: 5,
      startDate: "2026-01-05",
    });
    const savingUndated = transaction({
      id: "saving-undated",
      amountMinor: 20000,
      status: "settled",
      date: null,
      recurrenceId: "saving",
      occurrenceDate: "2026-09-05",
    });
    const d = data({ recurrences: [saving], transactions: [savingUndated] });
    expect(monthSummary(d, "2026-09", "CHF").unknownCount).toBe(0);
  });
});

// The mandatory example from abonnements.md "Calculs": a 100 CHF charge due 28 February, paid
// 2 March. February's cohort must show it 100% due, 100% "réglé" (dated 2 March); February's
// flux (transactionsForMonth) must show 0 for it; March's flux must show 100; March's own
// occurrence must remain separate and unrelated. Shared by both the cohort and its summary.
const lateRecurrence = recurrence({
  id: "rent",
  label: "Loyer",
  amountMinor: 10000,
  day: 28,
  intervalMonths: 1,
  startDate: "2026-01-28",
});
const settledInMarch = transaction({
  id: "rent:2026-02-28",
  label: "Loyer",
  amountMinor: 10000,
  status: "settled",
  date: "2026-03-02",
  recurrenceId: "rent",
  occurrenceDate: "2026-02-28",
});

describe("cohorte d'échéances (occurrenceCohort)", () => {
  it("reste dû à zéro et date le règlement même réglé un autre mois", () => {
    const d = data({
      recurrences: [lateRecurrence],
      transactions: [settledInMarch],
    });
    const february = occurrenceCohort(d, "2026-02");
    expect(february).toEqual([
      {
        recurrenceId: "rent",
        occurrenceDate: "2026-02-28",
        dueAmountMinor: 10000,
        currency: "CHF",
        accountId: "bank",
        kind: "expense",
        recurrenceType: "bill",
        label: "Loyer",
        settled: {
          transactionId: "rent:2026-02-28",
          date: "2026-03-02",
          amountMinor: 10000,
          currency: "CHF",
        },
      },
    ]);
  });
  it("l'échéance propre au mois du règlement reste distincte, non réglée", () => {
    const d = data({
      recurrences: [lateRecurrence],
      transactions: [settledInMarch],
    });
    const march = occurrenceCohort(d, "2026-03");
    expect(march).toEqual([
      expect.objectContaining({ occurrenceDate: "2026-03-28", settled: null }),
    ]);
  });
  it("le flux réalisé de février est nul, celui de mars inclut le règlement tardif", () => {
    const d = data({
      recurrences: [lateRecurrence],
      transactions: [settledInMarch],
    });
    expect(
      transactionsForMonth(d, "2026-02").some((t) => t.recurrenceId === "rent"),
    ).toBe(false);
    const marchFlow = transactionsForMonth(d, "2026-03").find(
      (t) => t.id === "rent:2026-02-28",
    );
    expect(marchFlow).toMatchObject({ status: "settled", date: "2026-03-02" });
  });
  it("une occurrence encore due n'a pas de règlement", () => {
    const d = data({ recurrences: [lateRecurrence] });
    expect(occurrenceCohort(d, "2026-02")).toEqual([
      expect.objectContaining({ occurrenceDate: "2026-02-28", settled: null }),
    ]);
  });
  it("un lien vers une transaction encore planifiée ou à vérifier ne règle pas l'occurrence", () => {
    const d = data({
      recurrences: [lateRecurrence],
      transactions: [
        transaction({
          id: "rent:2026-02-28",
          status: "planned",
          date: "2026-02-28",
          recurrenceId: "rent",
          occurrenceDate: "2026-02-28",
        }),
      ],
    });
    expect(occurrenceCohort(d, "2026-02")).toEqual([
      expect.objectContaining({ settled: null }),
    ]);
  });
  it("une récurrence inactive ne crée plus de nouvelles occurrences, sans effacer son historique", () => {
    const d = data({
      recurrences: [{ ...lateRecurrence, active: false }],
      transactions: [settledInMarch],
    });
    expect(occurrenceCohort(d, "2026-04")).toEqual([]);
    // Its already-settled occurrence still exists as a real transaction, unaffected.
    expect(
      d.transactions.find((t) => t.id === "rent:2026-02-28")?.status,
    ).toBe("settled");
  });
  it("garde un montant nul quand le règlement lui-même n'a pas de date", () => {
    const d = data({
      recurrences: [lateRecurrence],
      transactions: [
        transaction({
          id: "rent:2026-02-28",
          amountMinor: 10000,
          status: "settled",
          date: null,
          recurrenceId: "rent",
          occurrenceDate: "2026-02-28",
        }),
      ],
    });
    expect(occurrenceCohort(d, "2026-02")).toEqual([
      expect.objectContaining({
        settled: {
          transactionId: "rent:2026-02-28",
          date: null,
          amountMinor: 10000,
          currency: "CHF",
        },
      }),
    ]);
  });
  it("un changement de montant futur n'altère pas les occurrences des mois antérieurs", () => {
    const raised = withRecurrenceAmount(lateRecurrence, 12000, "2026-03-01");
    const d = data({ recurrences: [raised] });
    expect(occurrenceCohort(d, "2026-02")[0].dueAmountMinor).toBe(10000);
    expect(occurrenceCohort(d, "2026-03")[0].dueAmountMinor).toBe(12000);
  });
});

describe("résumé de la cohorte (cohortSummary)", () => {
  it("dû/réglé/reste dû exacts sur l'exemple obligatoire, réglé un autre mois", () => {
    const d = data({
      recurrences: [lateRecurrence],
      transactions: [settledInMarch],
    });
    expect(cohortSummary(d, "2026-02", "CHF")).toMatchObject({
      dueMinor: 10000,
      settledMinor: 10000,
      remainingMinor: 0,
      activeCount: 1,
      partial: false,
      excluded: 0,
    });
  });
  it("reste dû non nul tant qu'aucun règlement n'est rapproché", () => {
    const d = data({ recurrences: [lateRecurrence] });
    expect(cohortSummary(d, "2026-02", "CHF")).toMatchObject({
      dueMinor: 10000,
      settledMinor: 0,
      remainingMinor: 10000,
    });
  });
  it("un mois sans aucune occurrence due est un zéro confiant, pas un inconnu", () => {
    // lateRecurrence starts 2026-01-28: December 2025 precedes it entirely.
    const d = data({ recurrences: [lateRecurrence] });
    expect(cohortSummary(d, "2025-12", "CHF")).toMatchObject({
      dueMinor: 0,
      settledMinor: 0,
      remainingMinor: 0,
      partial: false,
    });
  });
  it("exclut les revenus récurrents de l'agrégat dû/réglé, sans les faire disparaître ailleurs", () => {
    const d = data({
      recurrences: [
        lateRecurrence,
        recurrence({
          id: "salary",
          kind: "income",
          recurrenceType: "income",
          amountMinor: 500000,
          day: 25,
          startDate: "2026-01-25",
        }),
      ],
    });
    const summary = cohortSummary(d, "2026-02", "CHF");
    expect(summary.dueMinor).toBe(10000); // only the expense, not +500000
    expect(summary.activeCount).toBe(2); // counts both regardless of kind
    expect(occurrenceCohort(d, "2026-02")).toHaveLength(2); // income still in the cohort itself
  });
  it("exclut une mise de côté de l'agrégat dû/réglé, sans la faire disparaître ailleurs", () => {
    const saving = recurrence({
      id: "saving",
      recurrenceType: "saving",
      amountMinor: 20000,
      day: 5,
      startDate: "2026-01-05",
    });
    const d = data({ recurrences: [lateRecurrence, saving] });
    const summary = cohortSummary(d, "2026-02", "CHF");
    expect(summary.dueMinor).toBe(10000); // only the bill, not +20000 of saving
    expect(summary.activeCount).toBe(2); // counts both regardless of classification
    expect(occurrenceCohort(d, "2026-02")).toHaveLength(2); // saving still in the cohort itself
  });
  it("compte les récurrences actives même sans occurrence due ce mois-ci", () => {
    const quarterly = recurrence({
      id: "insurance",
      day: 1,
      intervalMonths: 3,
      startDate: "2026-01-01",
    });
    const d = data({ recurrences: [quarterly] });
    expect(cohortSummary(d, "2026-02", "CHF").activeCount).toBe(1);
  });
  it("ne compte pas une récurrence en pause dans activeCount", () => {
    const d = data({ recurrences: [{ ...lateRecurrence, active: false }] });
    expect(cohortSummary(d, "2026-02", "CHF").activeCount).toBe(0);
  });
  it("un taux manquant rend le total partiel plutôt que de traiter la ligne comme zéro", () => {
    const foreign = recurrence({
      id: "foreign-rent",
      currency: "EUR",
      day: 5,
      startDate: "2026-01-05",
    });
    const d = data({ recurrences: [foreign] });
    expect(cohortSummary(d, "2026-02", "CHF")).toMatchObject({
      dueMinor: null,
      settledMinor: null,
      remainingMinor: null,
      partial: true,
      excluded: 1,
    });
  });
  it("un règlement réglé dans une devise différente utilise sa propre devise, pas celle de la récurrence", () => {
    const foreignSettlement = transaction({
      id: "rent:2026-02-28",
      currency: "EUR",
      amountMinor: 9000,
      status: "settled",
      date: "2026-02-28",
      recurrenceId: "rent",
      occurrenceDate: "2026-02-28",
    });
    const d = data({
      recurrences: [lateRecurrence],
      transactions: [foreignSettlement],
      fxRates: [
        { from: "EUR", to: "CHF", rate: "0.95", asOf: "2026-02-28", source },
      ],
    });
    const summary = cohortSummary(d, "2026-02", "CHF");
    expect(summary.dueMinor).toBe(10000);
    expect(summary.settledMinor).toBe(8550); // 9000 * 0.95, not treated as 9000 CHF
  });
});

describe("flux réalisé récurrent (recurringFlowSummary)", () => {
  it("sur l'exemple obligatoire, la charge compte dans le flux de mars, pas de février", () => {
    const d = data({
      recurrences: [lateRecurrence],
      transactions: [settledInMarch],
    });
    expect(recurringFlowSummary(d, "2026-02", "CHF")).toMatchObject({
      paidMinor: 0,
      receivedMinor: 0,
      partial: false,
    });
    expect(recurringFlowSummary(d, "2026-03", "CHF")).toMatchObject({
      paidMinor: 10000,
      receivedMinor: 0,
      partial: false,
    });
  });
  it("sépare payé (dépense) et reçu (revenu)", () => {
    const salary = recurrence({
      id: "salary",
      kind: "income",
      recurrenceType: "income",
      amountMinor: 500000,
      day: 25,
      startDate: "2026-01-25",
    });
    const salaryReceived = transaction({
      id: "salary:2026-02-25",
      kind: "income",
      amountMinor: 500000,
      status: "settled",
      date: "2026-02-25",
      recurrenceId: "salary",
      occurrenceDate: "2026-02-25",
    });
    const d = data({
      recurrences: [lateRecurrence, salary],
      transactions: [settledInMarch, salaryReceived],
    });
    expect(recurringFlowSummary(d, "2026-02", "CHF")).toMatchObject({
      paidMinor: 0,
      receivedMinor: 500000,
    });
  });
  it("exclut une mise de côté réglée : elle ne gonfle pas payé ni reçu", () => {
    const saving = recurrence({
      id: "saving",
      recurrenceType: "saving",
      amountMinor: 20000,
      day: 5,
      startDate: "2026-01-05",
    });
    const savingSettled = transaction({
      id: "saving:2026-02-05",
      amountMinor: 20000,
      status: "settled",
      date: "2026-02-05",
      recurrenceId: "saving",
      occurrenceDate: "2026-02-05",
    });
    const d = data({
      recurrences: [lateRecurrence, saving],
      transactions: [settledInMarch, savingSettled],
    });
    expect(recurringFlowSummary(d, "2026-02", "CHF")).toMatchObject({
      paidMinor: 0, // not +20000 of the settled saving occurrence
      receivedMinor: 0,
      partial: false,
    });
  });
  it("ignore un lien non lié à une récurrence et une opération encore planifiée", () => {
    const d = data({
      recurrences: [lateRecurrence],
      transactions: [
        transaction({ id: "one-off", status: "settled", date: "2026-02-10" }),
        transaction({
          id: "rent:2026-02-28",
          status: "planned",
          date: "2026-02-28",
          recurrenceId: "rent",
          occurrenceDate: "2026-02-28",
        }),
      ],
    });
    expect(recurringFlowSummary(d, "2026-02", "CHF")).toMatchObject({
      paidMinor: 0,
      receivedMinor: 0,
    });
  });
  it("un règlement lié mais sans date rend le total partiel plutôt que de l'ignorer", () => {
    const d = data({
      recurrences: [lateRecurrence],
      transactions: [
        transaction({
          id: "rent:2026-02-28",
          status: "settled",
          date: null,
          budgetMonth: "2026-02",
          recurrenceId: "rent",
          occurrenceDate: "2026-02-28",
        }),
      ],
    });
    expect(recurringFlowSummary(d, "2026-02", "CHF")).toMatchObject({
      paidMinor: null,
      receivedMinor: null,
      partial: true,
      excluded: 1,
    });
  });
});

describe("équivalent mensuel (monthlyEquivalentMinor)", () => {
  it("120/an et 10/mois donnent le même équivalent, sans classer un débit annuel comme mensuel", () => {
    const yearly = recurrence({
      amountMinor: 12000,
      intervalMonths: 12,
      startDate: "2026-01-01",
    });
    const monthly = recurrence({
      id: "other",
      amountMinor: 1000,
      intervalMonths: 1,
      startDate: "2026-01-01",
    });
    expect(monthlyEquivalentMinor(yearly)).toBe(1000);
    expect(monthlyEquivalentMinor(monthly)).toBe(1000);
    // The real due amount is untouched — the equivalent is a separate, explicitly labeled figure.
    expect(recurrenceAmountAt(yearly, "2026-01-01")).toBe(12000);
  });
  it("arrondit au centime le plus proche, moitié loin de zéro", () => {
    const quarterly = recurrence({ amountMinor: 100, intervalMonths: 3 });
    expect(monthlyEquivalentMinor(quarterly)).toBe(33); // 33.33 -> 33
    const quarterlyRoundUp = recurrence({ amountMinor: 200, intervalMonths: 3 });
    expect(monthlyEquivalentMinor(quarterlyRoundUp)).toBe(67); // 66.67 -> 67
  });
  it("suit l'historique de montant, pas seulement le montant courant", () => {
    const raised = withRecurrenceAmount(
      recurrence({ amountMinor: 10000, intervalMonths: 12, startDate: "2026-01-01" }),
      24000,
      "2026-06-01",
    );
    expect(monthlyEquivalentMinor(raised, "2026-01-01")).toBe(833); // 10000/12
    expect(monthlyEquivalentMinor(raised, "2026-06-01")).toBe(2000); // 24000/12
  });
});

describe("prochaine échéance (nextOccurrenceDate)", () => {
  it("reste dans le mois courant si le jour n'est pas encore passé, sinon avance d'un mois", () => {
    const monthly = recurrence({ day: 15, startDate: "2026-01-15" });
    expect(nextOccurrenceDate(monthly, "2026-06-01")).toBe("2026-06-15");
    expect(nextOccurrenceDate(monthly, "2026-06-15")).toBe("2026-06-15");
    expect(nextOccurrenceDate(monthly, "2026-06-16")).toBe("2026-07-15");
  });
  it("respecte l'intervalle trimestriel en sautant les mois non dus", () => {
    const quarterly = recurrence({
      day: 10,
      intervalMonths: 3,
      startDate: "2026-01-10",
    });
    expect(nextOccurrenceDate(quarterly, "2026-02-01")).toBe("2026-04-10");
    expect(nextOccurrenceDate(quarterly, "2026-04-11")).toBe("2026-07-10");
  });
  it("traverse une frontière d'année pour une récurrence annuelle", () => {
    const yearly = recurrence({
      day: 1,
      intervalMonths: 12,
      startDate: "2026-03-01",
    });
    expect(nextOccurrenceDate(yearly, "2026-04-01")).toBe("2027-03-01");
  });
  it("rabat le 31 au dernier jour du mois, y compris février", () => {
    const monthly = recurrence({
      day: 31,
      intervalMonths: 1,
      startDate: "2026-01-31",
    });
    expect(nextOccurrenceDate(monthly, "2026-02-01")).toBe("2026-02-28");
  });
  it("renvoie null une fois la date de fin dépassée", () => {
    const ending = recurrence({
      day: 1,
      startDate: "2026-01-01",
      endDate: "2026-03-01",
    });
    expect(nextOccurrenceDate(ending, "2026-02-02")).toBe("2026-03-01");
    expect(nextOccurrenceDate(ending, "2026-03-02")).toBeNull();
  });
  it("renvoie null pour une récurrence en pause", () => {
    const paused = recurrence({ active: false });
    expect(nextOccurrenceDate(paused, "2026-06-01")).toBeNull();
  });
  it("ignore les occurrences déjà passées avant startDate", () => {
    const notStartedYet = recurrence({
      day: 5,
      startDate: "2026-08-05",
    });
    expect(nextOccurrenceDate(notStartedYet, "2026-01-01")).toBe("2026-08-05");
  });
});

describe("argent disponible prudent", () => {
  const now = () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 17, 12));
  };
  it("soustrait réserves et engagements présents et en retard", () => {
    now();
    const d = data({
      accounts: [account()],
      transactions: [
        transaction(),
        transaction({ id: "late", date: "2026-08-12", amountMinor: 10000 }),
      ],
      goals: [
        {
          id: "tax",
          name: "Impôts",
          targetMinor: 100000,
          reservedMinor: 20000,
          currency: "CHF",
          accountId: "bank",
          dueDate: null,
          asOf: "2026-09-17",
          source,
        },
      ],
    });
    expect(availableSummary(d, "CHF", "2026-09")).toEqual({
      amountMinor: 55000,
      asOf: "2026-09-17",
      partial: false,
    });
  });
  it("n’annonce pas un ancien solde comme disponible aujourd’hui", () => {
    now();
    expect(
      availableSummary(
        data({ accounts: [account("bank", 100000, "2026-09-16")] }),
        "CHF",
        "2026-09",
      ).amountMinor,
    ).toBeNull();
  });
  it("invalide le disponible après paiement au lieu de le faire artificiellement remonter", () => {
    now();
    const d = data({
      accounts: [account()],
      transactions: [transaction({ date: "2026-09-17", status: "settled" })],
    });
    expect(availableSummary(d, "CHF", "2026-09").amountMinor).toBeNull();
  });
  it("invalide le disponible pour un règlement non daté concernant les comptes bancaires", () => {
    now();
    for (const related of [
      { accountId: "bank" },
      { accountId: null },
      { accountId: "savings", destinationAccountId: "bank", kind: "transfer" as const },
    ]) {
      const d = data({
        accounts: [account(), account("savings", 50000, "2026-09-17", { kind: "savings" })],
        transactions: [transaction({
          ...related,
          status: "settled",
          date: null,
          budgetMonth: "2026-09",
        })],
      });
      expect(availableSummary(d, "CHF", "2026-09")).toMatchObject({
        amountMinor: null,
        partial: true,
      });
    }
  });
  it("signale les réserves inconnues et les anciennes récurrences non rapprochées", () => {
    now();
    expect(
      availableSummary(
        data({ accounts: [account()], recurrences: [recurrence()] }),
        "CHF",
        "2026-09",
      ).amountMinor,
    ).toBeNull();
    expect(
      availableSummary(
        data({
          accounts: [account()],
          goals: [
            {
              id: "goal",
              name: "Réserve",
              targetMinor: null,
              reservedMinor: null,
              currency: "CHF",
              accountId: "bank",
              dueDate: null,
              asOf: null,
              source,
            },
          ],
        }),
        "CHF",
        "2026-09",
      ).amountMinor,
    ).toBeNull();
  });
});
