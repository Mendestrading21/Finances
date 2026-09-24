import { afterEach, describe, expect, it, vi } from "vitest";
import {
  availableSummary,
  cohortSummary,
  convertMinor,
  findOccurrenceTransaction,
  latestBalance,
  money,
  monthLabel,
  monthlyEquivalentMinor,
  monthSummary,
  nextOccurrenceDate,
  occurrenceCohort,
  parseMoney,
  projectedOccurrence,
  rankAccounts,
  rankByValue,
  recurrenceAmountAt,
  recurringFlowSummary,
  today,
  transactionsForMonth,
  wealthSummary,
  withOccurrenceAmount,
  withRecurrenceAmount,
} from "./finance";
import { mergeImport, validateData } from "./validation";
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
    const actionable =
      "Un changement de montant plus récent existe déjà. Choisissez « Ce mois seulement », ou modifiez à partir d’un mois plus récent.";
    expect(() => withRecurrenceAmount(second, 5000, "2026-06-01")).toThrow(
      actionable,
    );
    expect(() => withRecurrenceAmount(second, 5000, "2026-01-01")).toThrow(
      actionable,
    );
  });
  it("avance un changement déjà programmé quand « ce mois et les suivants » reprend le même montant", () => {
    // Facture 80 CHF le 5. « Octobre et suivants » 90, puis « Septembre et suivants » 90 :
    // septembre doit passer à 90 (avant le correctif, le montant égal rendait l'appel sans effet).
    const october = withRecurrenceAmount(bill, 9000, "2026-10-01");
    const september = withRecurrenceAmount(october, 9000, "2026-09-01");
    expect(september.amountEffectiveFrom).toBe("2026-09-01");
    expect(september.amountHistory).toEqual([
      { amountMinor: 8000, effectiveFrom: "2026-01-05" },
    ]);
    expect(recurrenceAmountAt(september, "2026-08-05")).toBe(8000);
    expect(recurrenceAmountAt(september, "2026-09-05")).toBe(9000);
    expect(recurrenceAmountAt(september, "2026-10-05")).toBe(9000);
    const d = billData({ recurrences: [september] });
    expect(occurrenceCohort(d, "2026-09")[0].dueAmountMinor).toBe(9000);
    expect(validateData(d)).toEqual(d);
    // Same amount, same or later date: nothing to change.
    expect(withRecurrenceAmount(september, 9000, "2026-09-01")).toBe(september);
    expect(withRecurrenceAmount(september, 9000, "2026-11-01")).toBe(september);
  });
  it("sans date explicite, un montant inchangé n'avance pas un changement programmé plus tard", () => {
    // Chemin de l'éditeur (resauvegarde d'un libellé, date d'effet par défaut aujourd'hui).
    const scheduled = withRecurrenceAmount(bill, 9000, "2099-01-01");
    expect(withRecurrenceAmount(scheduled, 9000)).toBe(scheduled);
  });
  it("ramène au début de la récurrence une date d'effet antérieure (premier jour du mois de départ)", () => {
    // bill starts 2026-01-05: "from 1 January" means from its first occurrence.
    const raised = withRecurrenceAmount(bill, 8500, "2026-01-01");
    expect(raised.amountEffectiveFrom).toBe("2026-01-05");
    expect(raised.amountHistory).toEqual([]);
    expect(recurrenceAmountAt(raised, "2026-01-05")).toBe(8500);
    expect(validateData(billData({ recurrences: [raised] }))).toBeTruthy();
    expect(withRecurrenceAmount(bill, 8000, "2026-01-01")).toBe(bill);
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
        projectedAmountMinor: 10000,
        adjusted: false,
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
  it("un règlement réglé dans une devise différente utilise sa propre devise et clôt l'échéance", () => {
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
    // The linked settlement is this occurrence's own record (no partial settlement in the
    // model): due = settled = 90 EUR × 0.95 = 85.50 CHF, never a 100 CHF projection left
    // "14.50 CHF reste dû" on an occurrence that is closed.
    expect(summary.dueMinor).toBe(8550);
    expect(summary.settledMinor).toBe(8550); // 9000 * 0.95, not treated as 9000 CHF
    expect(summary.remainingMinor).toBe(0);
    expect(occurrenceCohort(d, "2026-02")[0]).toMatchObject({
      dueAmountMinor: 9000,
      currency: "EUR",
      projectedAmountMinor: 10000,
      adjusted: true,
    });
  });
  it("convertit dû et réglé d'une échéance close à la même date, sans inventer de reste dû par le change", () => {
    // Due 28 Feb, paid 90 EUR on 2 Mar. Rates: 0.95 on 28 Feb, 0.96 on 1 Mar.
    // Expected (by hand): 9000 × 0.96 = 8640 on both sides, reste 0 — not 8550 − 8640 = −90.
    const d = data({
      recurrences: [lateRecurrence],
      transactions: [
        transaction({
          id: "rent:2026-02-28",
          currency: "EUR",
          amountMinor: 9000,
          status: "settled",
          date: "2026-03-02",
          recurrenceId: "rent",
          occurrenceDate: "2026-02-28",
        }),
      ],
      fxRates: [
        { from: "EUR", to: "CHF", rate: "0.95", asOf: "2026-02-28", source },
        { from: "EUR", to: "CHF", rate: "0.96", asOf: "2026-03-01", source },
      ],
    });
    expect(cohortSummary(d, "2026-02", "CHF")).toMatchObject({
      dueMinor: 8640,
      settledMinor: 8640,
      remainingMinor: 0,
      partial: false,
    });
  });
});

// "Factures" : a fixed monthly bill of 80.00 CHF due on the 5th. "Ce mois seulement" persists
// one planned transaction linked to that occurrence; every page then reads that same record.
const bill = recurrence({
  id: "internet",
  label: "Internet",
  amountMinor: 8000,
  day: 5,
  intervalMonths: 1,
  startDate: "2026-01-05",
});
const billData = (extra: Partial<FinanceData> = {}) =>
  data({ accounts: [account()], recurrences: [bill], ...extra });
const billLines = (d: FinanceData, month: string) =>
  transactionsForMonth(d, month).filter((t) => t.recurrenceId === "internet");

describe("montant d'une seule échéance (withOccurrenceAmount)", () => {
  it("fixe septembre à 85 sans toucher la règle ni octobre", () => {
    const base = billData();
    const d = withOccurrenceAmount(base, "internet", "2026-09-05", 8500);
    // Persisted exactly as the virtual projection, with the adjusted amount.
    expect(d.transactions).toEqual([
      {
        id: "internet:2026-09-05",
        label: "Internet",
        kind: "expense",
        amountMinor: 8500,
        currency: "CHF",
        status: "planned",
        date: "2026-09-05",
        accountId: "bank",
        category: "",
        recurrenceId: "internet",
        occurrenceDate: "2026-09-05",
        source,
      },
    ]);
    expect(d.recurrences).toBe(base.recurrences); // the rule itself is untouched
    expect(base.transactions).toEqual([]); // pure: input not mutated
    // Mon mois: one single line for the occurrence, at 85 — no duplicate projection.
    expect(billLines(d, "2026-09")).toEqual([
      expect.objectContaining({ id: "internet:2026-09-05", amountMinor: 8500 }),
    ]);
    expect(monthSummary(d, "2026-09", "CHF").expensePlanned).toBe(8500);
    // Abonnements / Factures: same amount, flagged as adjusted, rule amount still visible.
    expect(occurrenceCohort(d, "2026-09")).toEqual([
      expect.objectContaining({
        occurrenceDate: "2026-09-05",
        dueAmountMinor: 8500,
        currency: "CHF",
        projectedAmountMinor: 8000,
        adjusted: true,
        settled: null,
      }),
    ]);
    expect(occurrenceCohort(d, "2026-10")).toEqual([
      expect.objectContaining({
        occurrenceDate: "2026-10-05",
        dueAmountMinor: 8000,
        projectedAmountMinor: 8000,
        adjusted: false,
        settled: null,
      }),
    ]);
    expect(billLines(d, "2026-10")).toEqual([
      expect.objectContaining({ amountMinor: 8000 }),
    ]);
    expect(cohortSummary(d, "2026-09", "CHF", ["bill"])).toMatchObject({
      dueMinor: 8500,
      settledMinor: 0,
      remainingMinor: 8500,
      activeCount: 1,
      partial: false,
    });
  });
  it("ne touche pas les opérations des autres mois", () => {
    const august = transaction({
      id: "internet:2026-08-05",
      label: "Internet",
      amountMinor: 8000,
      status: "settled",
      date: "2026-08-05",
      recurrenceId: "internet",
      occurrenceDate: "2026-08-05",
    });
    const base = billData({ transactions: [august] });
    const d = withOccurrenceAmount(base, "internet", "2026-09-05", 8500);
    expect(d.transactions).toHaveLength(2);
    expect(d.transactions[0]).toBe(august);
    expect(occurrenceCohort(d, "2026-08")[0]).toMatchObject({
      dueAmountMinor: 8000,
      adjusted: false,
      settled: { amountMinor: 8000 },
    });
  });
  it("une fois réglée, l'échéance ajustée est due 85, réglée 85, reste 0", () => {
    const planned = withOccurrenceAmount(
      billData(),
      "internet",
      "2026-09-05",
      8500,
    );
    const d: FinanceData = {
      ...planned,
      transactions: planned.transactions.map((t) =>
        t.id === "internet:2026-09-05"
          ? { ...t, status: "settled", date: "2026-09-06" }
          : t,
      ),
    };
    expect(cohortSummary(d, "2026-09", "CHF", ["bill"])).toMatchObject({
      dueMinor: 8500,
      settledMinor: 8500,
      remainingMinor: 0,
    });
    expect(occurrenceCohort(d, "2026-09")[0]).toMatchObject({
      dueAmountMinor: 8500,
      projectedAmountMinor: 8000,
      adjusted: true,
      settled: {
        transactionId: "internet:2026-09-05",
        date: "2026-09-06",
        amountMinor: 8500,
        currency: "CHF",
      },
    });
    expect(billLines(d, "2026-09")).toHaveLength(1);
    // Correcting a settled occurrence's amount keeps its status and date.
    const corrected = withOccurrenceAmount(d, "internet", "2026-09-05", 8600);
    expect(corrected.transactions).toEqual([
      { ...d.transactions[0], amountMinor: 8600 },
    ]);
    expect(cohortSummary(corrected, "2026-09", "CHF", ["bill"])).toMatchObject({
      dueMinor: 8600,
      settledMinor: 8600,
      remainingMinor: 0,
    });
  });
  it("un second appel met à jour la même opération sans la dupliquer", () => {
    const first = withOccurrenceAmount(
      billData(),
      "internet",
      "2026-09-05",
      8500,
    );
    const second = withOccurrenceAmount(first, "internet", "2026-09-05", 8700);
    expect(second.transactions).toEqual([
      { ...first.transactions[0], amountMinor: 8700 },
    ]);
    expect(billLines(second, "2026-09")).toEqual([
      expect.objectContaining({ amountMinor: 8700 }),
    ]);
    expect(occurrenceCohort(second, "2026-09")[0].dueAmountMinor).toBe(8700);
    // Back to the rule's amount: the bare adjustment is removed, the projection is back.
    const reset = withOccurrenceAmount(second, "internet", "2026-09-05", 8000);
    expect(reset.transactions).toEqual([]);
    expect(billLines(reset, "2026-09")).toEqual([
      expect.objectContaining({ amountMinor: 8000, status: "planned" }),
    ]);
    expect(occurrenceCohort(reset, "2026-09")[0]).toMatchObject({
      dueAmountMinor: 8000,
      adjusted: false,
    });
  });
  it("retrouve une opération d'un ancien export par son identifiant, sans champs de lien", () => {
    const legacy = transaction({
      id: "internet:2026-09-05",
      label: "Internet",
      amountMinor: 8000,
      status: "planned",
      date: "2026-09-05",
    });
    const d = withOccurrenceAmount(
      billData({ transactions: [legacy] }),
      "internet",
      "2026-09-05",
      8500,
    );
    expect(d.transactions).toEqual([{ ...legacy, amountMinor: 8500 }]);
    expect(billLines(d, "2026-09")).toHaveLength(0); // no link fields, but no projection either
    expect(transactionsForMonth(d, "2026-09")).toHaveLength(1);
    expect(occurrenceCohort(d, "2026-09")[0]).toMatchObject({
      dueAmountMinor: 8500,
      adjusted: true,
    });
  });
  it("refuse d'écraser un identifiant pris par l'opération d'une autre échéance", () => {
    const misnamed = transaction({
      id: "internet:2026-09-05",
      amountMinor: 8000,
      date: "2026-10-05",
      recurrenceId: "internet",
      occurrenceDate: "2026-10-05",
    });
    const base = billData({ transactions: [misnamed] });
    expect(() =>
      withOccurrenceAmount(base, "internet", "2026-09-05", 8500),
    ).toThrow("Identifiant d’échéance déjà utilisé par une autre opération.");
  });
  it("refuse une date qui n'est pas une échéance de cette récurrence", () => {
    const base = billData();
    for (const wrong of ["2026-09-06", "2025-12-05", "2026-02-30", "2026-09"])
      expect(() => withOccurrenceAmount(base, "internet", wrong, 8500)).toThrow(
        "Cette date n’est pas une échéance de cette récurrence.",
      );
    expect(() =>
      withOccurrenceAmount(base, "inconnue", "2026-09-05", 8500),
    ).toThrow("Récurrence introuvable.");
    // A 31st rule is due on the last day of February, not on "2026-02-31".
    const rent = data({ recurrences: [recurrence()] });
    expect(
      withOccurrenceAmount(rent, "rent", "2026-02-28", 190000).transactions[0],
    ).toMatchObject({ date: "2026-02-28", occurrenceDate: "2026-02-28" });
    expect(base.transactions).toEqual([]);
  });
  it("refuse un montant négatif, non entier ou hors plage sûre", () => {
    const base = billData();
    for (const wrong of [-1, 85.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])
      expect(() =>
        withOccurrenceAmount(base, "internet", "2026-09-05", wrong),
      ).toThrow("Montant invalide.");
    expect(
      withOccurrenceAmount(base, "internet", "2026-09-05", 0).transactions[0]
        .amountMinor,
    ).toBe(0); // a verified zero stays a valid, explicit amount
  });
  it("un changement « ce mois et les suivants » dès octobre n'efface pas l'ajustement de septembre", () => {
    const adjusted = withOccurrenceAmount(
      billData(),
      "internet",
      "2026-09-05",
      8500,
    );
    const d: FinanceData = {
      ...adjusted,
      recurrences: adjusted.recurrences.map((r) =>
        withRecurrenceAmount(r, 9000, "2026-10-01"),
      ),
    };
    const due = (month: string) => occurrenceCohort(d, month)[0];
    expect(due("2026-08")).toMatchObject({
      dueAmountMinor: 8000,
      adjusted: false,
    });
    expect(due("2026-09")).toMatchObject({
      dueAmountMinor: 8500,
      projectedAmountMinor: 8000,
      adjusted: true,
    });
    expect(due("2026-10")).toMatchObject({
      dueAmountMinor: 9000,
      projectedAmountMinor: 9000,
      adjusted: false,
    });
    expect(billLines(d, "2026-08")[0].amountMinor).toBe(8000);
    expect(billLines(d, "2026-09")[0].amountMinor).toBe(8500);
    expect(billLines(d, "2026-10")[0].amountMinor).toBe(9000);
  });
  it("un ajustement ponctuel reste prioritaire sur un changement de règle couvrant son mois", () => {
    // The caller applying "ce mois et les suivants" from September must also re-set that
    // month's own adjustment, otherwise September keeps its 85 (flagged adjusted vs 90).
    const adjusted = withOccurrenceAmount(
      billData(),
      "internet",
      "2026-09-05",
      8500,
    );
    const d: FinanceData = {
      ...adjusted,
      recurrences: adjusted.recurrences.map((r) =>
        withRecurrenceAmount(r, 9000, "2026-09-01"),
      ),
    };
    expect(occurrenceCohort(d, "2026-09")[0]).toMatchObject({
      dueAmountMinor: 8500,
      projectedAmountMinor: 9000,
      adjusted: true,
    });
    const aligned = withOccurrenceAmount(d, "internet", "2026-09-05", 9000);
    expect(occurrenceCohort(aligned, "2026-09")[0]).toMatchObject({
      dueAmountMinor: 9000,
      adjusted: false,
    });
  });
  it("une opération liée dans une autre devise est convertie avec sa propre devise", () => {
    // 90.00 EUR planned for September's 80 CHF bill; EUR→CHF 0.95 dated 1 September.
    // Expected (by hand): 9000 × 0.95 = 8550 due, 0 settled, 8550 remaining.
    const foreign = transaction({
      id: "internet:2026-09-05",
      label: "Internet",
      amountMinor: 9000,
      currency: "EUR",
      accountId: null,
      status: "planned",
      date: "2026-09-05",
      recurrenceId: "internet",
      occurrenceDate: "2026-09-05",
    });
    const rate = {
      from: "EUR",
      to: "CHF",
      rate: "0.95",
      asOf: "2026-09-01",
      source,
    };
    const d = billData({ transactions: [foreign], fxRates: [rate] });
    expect(occurrenceCohort(d, "2026-09")[0]).toMatchObject({
      dueAmountMinor: 9000,
      currency: "EUR",
      projectedAmountMinor: 8000,
      adjusted: true,
    });
    expect(cohortSummary(d, "2026-09", "CHF", ["bill"])).toMatchObject({
      dueMinor: 8550,
      settledMinor: 0,
      remainingMinor: 8550,
      partial: false,
    });
    // Without a dated rate the total is partial, never a 90 CHF or 80 CHF guess.
    expect(
      cohortSummary({ ...d, fxRates: [] }, "2026-09", "CHF", ["bill"]),
    ).toMatchObject({ dueMinor: null, partial: true, excluded: 1 });
    // Same number but another currency is still an adjustment.
    const sameDigits = billData({
      transactions: [{ ...foreign, amountMinor: 8000 }],
    });
    expect(occurrenceCohort(sameDigits, "2026-09")[0].adjusted).toBe(true);
  });
  it("le résultat passe validateData, créé, mis à jour puis réglé", () => {
    const created = withOccurrenceAmount(
      billData(),
      "internet",
      "2026-09-05",
      8500,
    );
    expect(validateData(created)).toEqual(created);
    const updated = withOccurrenceAmount(
      created,
      "internet",
      "2026-09-05",
      8700,
    );
    expect(validateData(updated)).toEqual(updated);
    const settled: FinanceData = {
      ...updated,
      transactions: updated.transactions.map((t) => ({
        ...t,
        status: "settled" as const,
        date: "2026-09-06",
      })),
    };
    expect(
      validateData(
        withOccurrenceAmount(settled, "internet", "2026-09-05", 8800),
      ),
    ).toBeTruthy();
  });
});

describe("retour au montant de la règle (withOccurrenceAmount, montant = projection)", () => {
  const adjusted = () =>
    withOccurrenceAmount(billData(), "internet", "2026-09-05", 8500);
  const back = (d: FinanceData) =>
    withOccurrenceAmount(d, "internet", "2026-09-05", 8000);
  it("sans opération liée, ne crée rien : même référence", () => {
    const base = billData();
    expect(back(base)).toBe(base);
  });
  it("retire un ajustement ponctuel qui ne portait qu'un montant", () => {
    const d = back(adjusted());
    expect(d.transactions).toEqual([]);
    expect(billLines(d, "2026-09")).toEqual([
      expect.objectContaining({ amountMinor: 8000, status: "planned" }),
    ]);
    expect(validateData(d)).toEqual(d);
  });
  it("garde l'opération, montant mis à jour, si un document y est lié", () => {
    const withDocument: FinanceData = {
      ...adjusted(),
      documents: [
        {
          id: "facture-sept",
          name: "facture.pdf",
          mimeType: "application/pdf",
          transactionId: "internet:2026-09-05",
          addedAt: "2026-09-02T08:00:00Z",
          source,
        },
      ],
    };
    const d = back(withDocument);
    expect(d.transactions).toEqual([
      { ...withDocument.transactions[0], amountMinor: 8000 },
    ]);
    expect(d.documents).toBe(withDocument.documents);
    expect(validateData(d)).toEqual(d);
  });
  it("garde une opération remise à prévu (trace d'un ancien règlement)", () => {
    const base = adjusted();
    const reset: FinanceData = {
      ...base,
      transactions: base.transactions.map((t) => ({
        ...t,
        source: {
          ...t.source,
          note: "Remis à prévu le 2026-09-06T10:00:00.000Z (réglé précédemment le 2026-09-05).",
        },
      })),
    };
    const d = back(reset);
    expect(d.transactions).toEqual([
      { ...reset.transactions[0], amountMinor: 8000 },
    ]);
    expect(validateData(d)).toEqual(d);
  });
  it("garde un règlement, une identité importée ou une date déplacée", () => {
    const base = adjusted();
    const variants: Partial<Transaction>[] = [
      { status: "settled", date: "2026-09-06" },
      { source: { system: "notion", sourceId: "ligne-42" } },
      { date: "2026-09-12" },
    ];
    for (const change of variants) {
      const kept: FinanceData = {
        ...base,
        transactions: [{ ...base.transactions[0], ...change }],
      };
      const d = back(kept);
      expect(d.transactions).toEqual([
        { ...kept.transactions[0], amountMinor: 8000 },
      ]);
      expect(validateData(d)).toEqual(d);
    }
  });
});

describe("provenance des échéances matérialisées (projectedOccurrence)", () => {
  const notionSource = {
    system: "notion" as const,
    sourceId: "n-1",
    url: "https://www.notion.so/n1",
    importedAt: "2026-09-01T10:00:00Z",
    note: "Base Charges",
  };
  const notionBill = { ...bill, source: notionSource };
  const settle = (date: string, paidOn: string): Transaction => ({
    ...projectedOccurrence(notionBill, date),
    status: "settled",
    date: paidOn,
  });
  const notionData = () =>
    withOccurrenceAmount(
      billData({
        recurrences: [notionBill],
        transactions: [
          settle("2026-07-05", "2026-07-05"),
          settle("2026-08-05", "2026-08-06"),
        ],
      }),
      "internet",
      "2026-09-05",
      8500,
    );
  it("garde la provenance de la récurrence sans son sourceId", () => {
    expect(projectedOccurrence(notionBill, "2026-09-05").source).toEqual({
      system: "notion",
      url: "https://www.notion.so/n1",
      importedAt: "2026-09-01T10:00:00Z",
      note: "Base Charges",
    });
    expect(notionBill.source.sourceId).toBe("n-1"); // not mutated
    const virtual = billLines(
      billData({ recurrences: [notionBill] }),
      "2026-09",
    );
    expect(virtual[0].source).not.toHaveProperty("sourceId");
  });
  it("deux mois réglés et un troisième ajusté passent validateData", () => {
    const d = notionData();
    expect(d.transactions.map((t) => t.id)).toEqual([
      "internet:2026-07-05",
      "internet:2026-08-05",
      "internet:2026-09-05",
    ]);
    expect(validateData(d)).toEqual(d);
    // The previous shape (each occurrence carrying the recurrence's sourceId) was refused.
    expect(() =>
      validateData({
        ...d,
        transactions: d.transactions.map((t) => ({
          ...t,
          source: notionSource,
        })),
      }),
    ).toThrow("source en doublon");
  });
  it("un réimport de la même récurrence ou du même coffre ne crée aucun doublon", () => {
    const d = notionData();
    const again = mergeImport(d, d);
    expect(again.transactions).toHaveLength(3);
    expect(again.recurrences).toHaveLength(1);
    expect(again.reviewItems).toEqual([]);
    // Notion re-import under a new local id: matched by its source, occurrences untouched.
    const reimported = mergeImport(
      d,
      billData({ recurrences: [{ ...notionBill, id: "notion-internet" }] }),
    );
    expect(reimported.recurrences.map((r) => r.id)).toEqual(["internet"]);
    expect(reimported.transactions).toEqual(d.transactions);
    expect(reimported.reviewItems).toEqual([]);
  });
});

describe("règles partagées de rapprochement d'une échéance", () => {
  it("un règlement importé d'un montant différent clôt l'échéance, l'écart reste visible", () => {
    // Rule 100.00 CHF due 28 Feb; Notion shows 85.00 CHF actually paid. No partial settlement
    // in the model: cohort 85 due / 85 settled / 0 remaining, 100 still shown as projected.
    const imported = transaction({
      id: "notion-paiement-1",
      label: "Loyer",
      amountMinor: 8500,
      status: "settled",
      date: "2026-02-28",
      recurrenceId: "rent",
      occurrenceDate: "2026-02-28",
      source: { system: "notion", sourceId: "paiement-1" },
    });
    const d = data({
      accounts: [account()],
      recurrences: [lateRecurrence],
      transactions: [imported],
    });
    expect(occurrenceCohort(d, "2026-02")[0]).toMatchObject({
      dueAmountMinor: 8500,
      projectedAmountMinor: 10000,
      adjusted: true,
      settled: { transactionId: "notion-paiement-1", amountMinor: 8500 },
    });
    expect(cohortSummary(d, "2026-02", "CHF")).toMatchObject({
      dueMinor: 8500,
      settledMinor: 8500,
      remainingMinor: 0,
    });
    expect(transactionsForMonth(d, "2026-02")).toEqual([imported]);
    expect(validateData(d)).toEqual(d);
  });
  it("un identifiant de septembre lié à octobre ne cache pas la projection de septembre", () => {
    const misnamed = transaction({
      id: "internet:2026-09-05",
      label: "Internet",
      amountMinor: 9500,
      date: "2026-10-05",
      recurrenceId: "internet",
      occurrenceDate: "2026-10-05",
    });
    const d = billData({ transactions: [misnamed] });
    // September: its own projection, same as the cohort.
    expect(billLines(d, "2026-09")).toEqual([
      expect.objectContaining({
        occurrenceDate: "2026-09-05",
        amountMinor: 8000,
        status: "planned",
      }),
    ]);
    expect(occurrenceCohort(d, "2026-09")[0]).toMatchObject({
      dueAmountMinor: 8000,
      adjusted: false,
    });
    // October: the linked record replaces the projection, once.
    expect(billLines(d, "2026-10")).toEqual([misnamed]);
    expect(occurrenceCohort(d, "2026-10")[0]).toMatchObject({
      dueAmountMinor: 9500,
      adjusted: true,
    });
    expect(
      findOccurrenceTransaction(d.transactions, "internet", "2026-09-05"),
    ).toBeUndefined();
    expect(
      findOccurrenceTransaction(d.transactions, "internet", "2026-10-05"),
    ).toBe(misnamed);
  });
  it("findOccurrenceTransaction retrouve aussi une opération d'ancien export sans lien", () => {
    const legacy = transaction({
      id: "internet:2026-09-05",
      date: "2026-09-05",
    });
    expect(findOccurrenceTransaction([legacy], "internet", "2026-09-05")).toBe(
      legacy,
    );
    expect(
      findOccurrenceTransaction([legacy], "internet", "2026-10-05"),
    ).toBeUndefined();
  });
});

describe("cohorte filtrée par classification (cohortSummary types)", () => {
  const netflix = recurrence({
    id: "netflix",
    label: "Netflix",
    recurrenceType: "subscription",
    amountMinor: 2000,
    day: 10,
    startDate: "2026-01-10",
  });
  const saving = recurrence({
    id: "saving",
    recurrenceType: "saving",
    amountMinor: 20000,
    day: 25,
    startDate: "2026-01-25",
  });
  const pausedBill = recurrence({
    id: "old-phone",
    amountMinor: 5000,
    day: 15,
    startDate: "2026-01-15",
    active: false,
  });
  const d = data({
    accounts: [account()],
    recurrences: [bill, netflix, saving, pausedBill],
  });
  it("ne retient que les factures : l'abonnement et la mise de côté sont exclus", () => {
    expect(cohortSummary(d, "2026-09", "CHF", ["bill"])).toMatchObject({
      dueMinor: 8000,
      settledMinor: 0,
      remainingMinor: 8000,
      activeCount: 1, // internet only: paused bill and other types not counted
      partial: false,
    });
    expect(cohortSummary(d, "2026-09", "CHF", ["subscription"])).toMatchObject({
      dueMinor: 2000,
      activeCount: 1,
    });
    expect(
      cohortSummary(d, "2026-09", "CHF", ["bill", "subscription"]),
    ).toMatchObject({ dueMinor: 10000, activeCount: 2 });
    expect(cohortSummary(d, "2026-09", "CHF", [])).toMatchObject({
      dueMinor: 0,
      activeCount: 0,
    });
  });
  it("sans filtre, comportement inchangé : dépenses hors mise de côté, toutes récurrences actives", () => {
    expect(cohortSummary(d, "2026-09", "CHF")).toMatchObject({
      dueMinor: 10000, // 80 + 20, saving excluded
      activeCount: 3, // internet, netflix, saving
    });
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
