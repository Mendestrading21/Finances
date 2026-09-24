import { emptyData, type FinanceData, type Source } from "./domain/types";
const source: Source = {
  system: "demo",
  note: "Données fictives de démonstration",
};
export function demoData(): FinanceData {
  const data = emptyData();
  const day = new Date().toLocaleDateString("en-CA");
  const date = /^\d{4}-/.test(day)
    ? day
    : new Date().toISOString().slice(0, 10);
  const month = date.slice(0, 7);
  data.accounts = [
    {
      id: "demo-bank",
      name: "Compte quotidien",
      institution: "Banque Horizon",
      kind: "bank",
      currency: "CHF",
      valuationMode: "total",
      source,
      balances: [{ id: "b1", amountMinor: 1284500, asOf: date, source }],
    },
    {
      id: "demo-save",
      name: "Réserve & projets",
      institution: "Banque Horizon",
      kind: "savings",
      currency: "CHF",
      valuationMode: "total",
      source,
      balances: [{ id: "b2", amountMinor: 3650000, asOf: date, source }],
    },
    {
      id: "demo-invest",
      name: "Portefeuille long terme",
      institution: "Invest Exemple",
      kind: "investment",
      currency: "CHF",
      valuationMode: "total",
      source,
      balances: [{ id: "b3", amountMinor: 4815000, asOf: date, source }],
    },
  ];
  for (let i = 5; i > 0; i--) {
    const d = new Date(
      Number(month.slice(0, 4)),
      Number(month.slice(5, 7)) - 1 - i,
      28,
    );
    const at = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-28`;
    data.accounts.forEach((a, k) =>
      a.balances.unshift({
        id: `history-${k}-${i}`,
        amountMinor:
          [1284500, 3650000, 4815000][k] - i * [17000, 80000, 96000][k],
        asOf: at,
        source,
      }),
    );
  }
  data.transactions = [
    {
      id: "demo-pay",
      label: "Salaire",
      kind: "income",
      amountMinor: 840000,
      currency: "CHF",
      status: "settled",
      date: `${month}-01`,
      accountId: "demo-bank",
      category: "Revenus",
      source,
    },
    {
      id: "demo-rent",
      label: "Loyer",
      kind: "expense",
      amountMinor: 245000,
      currency: "CHF",
      status: "settled",
      date: `${month}-02`,
      accountId: "demo-bank",
      category: "Logement",
      recurrenceId: "demo-rent-bill",
      occurrenceDate: `${month}-02`,
      source,
    },
    {
      id: "demo-shop",
      label: "Courses du quotidien",
      kind: "expense",
      amountMinor: 46250,
      currency: "CHF",
      status: "settled",
      date: `${month}-03`,
      accountId: "demo-bank",
      category: "Alimentation",
      source,
    },
    {
      id: "demo-fund",
      label: "Épargne du mois",
      kind: "transfer",
      amountMinor: 150000,
      currency: "CHF",
      status: "planned",
      date: `${month}-28`,
      accountId: "demo-bank",
      destinationAccountId: "demo-save",
      category: "Épargne",
      source,
    },
  ];
  data.recurrences = [
    // Factures fixes : le loyer est déjà payé ce mois-ci, l'assurance reste à payer.
    {
      id: "demo-rent-bill",
      label: "Loyer",
      kind: "expense",
      recurrenceType: "bill",
      amountMinor: 245000,
      currency: "CHF",
      accountId: "demo-bank",
      category: "Logement",
      day: 2,
      intervalMonths: 1,
      startDate: `${month}-01`,
      active: true,
      source,
    },
    {
      id: "demo-health-bill",
      label: "Assurance santé",
      kind: "expense",
      recurrenceType: "bill",
      amountMinor: 42000,
      currency: "CHF",
      accountId: "demo-bank",
      category: "Assurances",
      day: 25,
      intervalMonths: 1,
      startDate: `${month}-01`,
      active: true,
      source,
    },
    {
      id: "demo-stream",
      label: "Abonnement musique",
      kind: "expense",
      recurrenceType: "subscription",
      amountMinor: 1590,
      currency: "CHF",
      accountId: "demo-bank",
      category: "Abonnements",
      day: 21,
      intervalMonths: 1,
      startDate: `${month}-01`,
      active: true,
      source,
    },
  ];
  data.goals = [
    {
      id: "demo-tax",
      name: "Réserve impôts",
      targetMinor: 2500000,
      reservedMinor: 1800000,
      currency: "CHF",
      accountId: "demo-save",
      dueDate: `${Number(month.slice(0, 4)) + 1}-03-31`,
      asOf: date,
      source,
    },
    {
      id: "demo-trip",
      name: "Notre prochain voyage",
      targetMinor: 600000,
      reservedMinor: 390000,
      currency: "CHF",
      accountId: "demo-save",
      dueDate: null,
      asOf: date,
      source,
    },
  ];
  data.positions = [
    {
      id: "demo-etf",
      name: "ETF Monde",
      symbol: "MONDE",
      assetType: "etf",
      quantity: "200",
      valueMinor: 3215000,
      currency: "CHF",
      accountId: "demo-invest",
      asOf: date,
      source,
    },
    {
      id: "demo-stock",
      name: "Actions diversifiées",
      symbol: "ACTIONS",
      assetType: "stock",
      quantity: "100",
      valueMinor: 1600000,
      currency: "CHF",
      accountId: "demo-invest",
      asOf: date,
      source,
    },
  ];
  return data;
}
