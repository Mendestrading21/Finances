import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  type Account,
  type FinanceData,
  type Recurrence,
  type Source,
  type Transaction,
} from "../domain/types";
import { parseMoney, today, withRecurrenceAmount } from "../domain/finance";
import { Icon } from "./Icon";
/** Amount-related fields for a saved recurrence: routes an existing recurrence's amount
 * through `withRecurrenceAmount` (dating any real change and archiving the superseded amount)
 * instead of overwriting it directly, which would silently drop `amountHistory` on every save.
 * A brand-new recurrence (no `existing`) has no prior amount to preserve. Exported for direct
 * unit testing of this exact merge, independent of form/DOM plumbing. */
export function recurrenceAmountFields(
  existing: Recurrence | undefined,
  amountMinor: number,
): Pick<Recurrence, "amountMinor" | "amountEffectiveFrom" | "amountHistory"> {
  return existing ? withRecurrenceAmount(existing, amountMinor) : { amountMinor };
}
/** Resolves the date/budgetMonth pair a transaction save should carry, given the quick
 * editor's single Mois field and the date/budgetMonth values present before this save (read
 * from the visible fields in the full editor, or from the hidden inputs in the quick editor).
 * The full editor never passes `quick: true`, so it always keeps its own visible date/
 * budgetMonth untouched — `originalDate`/`originalBudgetMonth` pass straight through. In the
 * quick editor, if the month field wasn't actually changed, the original date/budgetMonth come
 * out byte-for-byte identical; if it was changed, the precise day is unknown, so `date` is
 * cleared and `budgetMonth` carries the new month instead — the same "month without a precise
 * day" concept `transactionsForMonth` already resolves via `date?.slice(0,7) ?? budgetMonth`
 * (src/domain/finance.ts). Exported for direct unit testing of this exact merge, independent
 * of form/DOM plumbing. */
export function transactionDateFields(
  quick: boolean,
  month: string,
  originalDate: string,
  originalBudgetMonth: string,
): Pick<Transaction, "date" | "budgetMonth"> {
  const originalMonth = originalDate.slice(0, 7) || originalBudgetMonth;
  return quick && month !== originalMonth
    ? { date: null, budgetMonth: month }
    : { date: originalDate || null, budgetMonth: originalBudgetMonth || undefined };
}
export type EditorSpec = {
  type:
    | "transaction"
    | "account"
    | "balance"
    | "goal"
    | "position"
    | "recurrence"
    | "fx";
  id?: string;
  kind?: "income" | "expense" | "transfer";
  /** Prefills a transaction editor from a not-yet-persisted occurrence (a virtual planned
   * projection from `transactionsForMonth`, not yet in `data.transactions`) instead of the
   * usual lookup by `id`. Used to open "Marquer payé/reçu" with the settlement date visible
   * and editable before it is actually saved, rather than writing it silently on click. */
  transaction?: Transaction;
  /** transaction only: render just Libellé/Montant/Mois (the pencil action on a not-yet-settled
   * row) instead of the full field set. Every other field is preserved unchanged via hidden
   * inputs — this narrows what is editable, not what is stored. */
  quick?: boolean;
  /** recurrence only: nature proposée pour une nouvelle récurrence (page Factures : "bill"). */
  recurrenceType?: Exclude<Recurrence["recurrenceType"], "income">;
};
const titles = {
  transaction: "Une opération",
  account: "Un compte",
  balance: "Actualiser le solde",
  goal: "Un projet",
  position: "Une position",
  recurrence: "Une récurrence",
  fx: "Un taux de change",
};
export default function Editor({
  spec,
  data,
  onSave,
  onClose,
}: {
  spec: EditorSpec;
  data: FinanceData;
  onSave: (data: FinanceData) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState(
    spec.kind ||
      data.transactions.find((t) => t.id === spec.id)?.kind ||
      "expense",
  );
  // "Tous les mois" saves a new income or expense as a monthly recurrence instead of a one-off.
  const [repeat, setRepeat] = useState<"once" | "monthly">("once");
  // recurrenceType "income" only applies to kind "income" (validation.ts enforces it), so it
  // is derived from recurrenceKind rather than stored directly — storing it directly and
  // forcing it to "income" while kind is income would overwrite whatever the user had chosen
  // on the expense side, losing it for good on the next switch back. Keeping the expense-side
  // choice in its own state means a Dépense → Revenu → Dépense round trip never loses it.
  const [recurrenceKind, setRecurrenceKind] = useState<"income" | "expense">(
    data.recurrences.find((r) => r.id === spec.id)?.kind ??
      (spec.type === "recurrence" && spec.kind === "income" ? "income" : "expense"),
  );
  const [expenseRecurrenceType, setExpenseRecurrenceType] = useState<
    Exclude<Recurrence["recurrenceType"], "income">
  >(() => {
    const existing = data.recurrences.find((r) => r.id === spec.id)
      ?.recurrenceType;
    return existing && existing !== "income"
      ? existing
      : (spec.recurrenceType ?? "subscription");
  });
  const recurrenceType: Recurrence["recurrenceType"] =
    recurrenceKind === "income" ? "income" : expenseRecurrenceType;
  const item =
    spec.type === "transaction"
      ? // spec.transaction must win: it carries the caller's explicit intent (e.g.
        // markSettled's status:"settled", date:today()) even when the same id already
        // has a persisted, stale record — the pencil/edit action never sets this field,
        // so it is unaffected and still resolves the persisted record as before.
        (spec.transaction ?? data.transactions.find((i) => i.id === spec.id))
      : spec.type === "account" || spec.type === "balance"
        ? data.accounts.find((i) => i.id === spec.id)
        : spec.type === "goal"
          ? data.goals.find((i) => i.id === spec.id)
          : spec.type === "position"
            ? data.positions.find((i) => i.id === spec.id)
            : spec.type === "recurrence"
              ? data.recurrences.find((i) => i.id === spec.id)
              : undefined;
  const initial = (item || {}) as unknown as Record<string, unknown>;
  const canRepeat =
    spec.type === "transaction" && !spec.quick && !item && kind !== "transfer";
  const monthly = canRepeat && repeat === "monthly";
  useEffect(() => {
    // Real defect, measured with a keyboard-only run (Tab/Enter/Escape, no mouse): closing
    // the editor left document.activeElement on <body> instead of the button that opened it,
    // forcing a keyboard user back to the top of the page. Root cause: the parent unmounts
    // this whole subtree (editor set to null) in the same commit that removes the dialog from
    // the document, and removing a focused element's ancestor drops focus to <body>
    // immediately — before this cleanup's dialog.close() ever runs, so native <dialog>
    // focus-restore has nothing live left to act on. Capturing and restoring the trigger
    // ourselves (WAI-ARIA dialog pattern: focus returns to the invoking control) fixes it
    // regardless of that native mechanism's fate.
    const trigger =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      if (trigger && document.body.contains(trigger)) trigger.focus();
    };
  }, []);
  const val = (name: string, fallback = "") =>
    initial[name] === null || initial[name] === undefined
      ? fallback
      : String(initial[name]);
  const amount = (name: string) =>
    typeof initial[name] === "number"
      ? String((initial[name] as number) / 100)
      : "";
  // The currency select is controlled so choosing an account can prefill its currency
  // (design: "préremplir seulement les informations déductibles du contexte choisi").
  const [currencyValue, setCurrencyValue] = useState(val("currency", "CHF"));
  const field = (
    label: string,
    name: string,
    options: {
      type?: string;
      defaultValue?: string;
      value?: string;
      onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
      required?: boolean;
      children?: ReactNode;
      min?: string;
      max?: string;
      step?: string;
      hint?: string;
    } = {},
  ) => (
    <label className="field" key={name}>
      <span>{label}</span>
      {options.children ? (
        <select
          aria-label={label}
          name={name}
          {...(options.value !== undefined
            ? { value: options.value }
            : { defaultValue: options.defaultValue ?? val(name) })}
          onChange={options.onChange}
          required={options.required}
        >
          {options.children}
        </select>
      ) : (
        <input
          aria-label={label}
          aria-describedby={options.hint ? `${name}-hint` : undefined}
          name={name}
          type={options.type || "text"}
          defaultValue={options.defaultValue ?? val(name)}
          required={options.required}
          min={options.min}
          max={options.max}
          step={options.step}
          maxLength={200}
          inputMode={
            name.toLowerCase().includes("amount") ||
            name.toLowerCase().includes("minor")
              ? "decimal"
              : undefined
          }
        />
      )}{" "}
      {/* aria-describedby above lets a screen reader announce this alongside the field
          instead of only sighted users seeing it. */}
      {options.hint && (
        <small id={`${name}-hint`}>{options.hint}</small>
      )}
    </label>
  );
  const accounts = (
    label = "Compte",
    name = "accountId",
    required = false,
    syncCurrency = false,
    onlyKind?: Account["kind"],
  ) => {
    const list = onlyKind
      ? data.accounts.filter((a) => a.kind === onlyKind)
      : data.accounts;
    return field(label, name, {
      required,
      onChange: syncCurrency
        ? (e) => {
            const found = data.accounts.find((a) => a.id === e.target.value);
            // Deducible from the chosen account: no need to re-ask its currency.
            if (found) setCurrencyValue(found.currency);
          }
        : undefined,
      children: (
        <>
          <option value="">Non renseigné</option>
          {list.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {a.currency}
            </option>
          ))}
        </>
      ),
    });
  };
  const currency = () =>
    field("Devise", "currency", {
      value: currencyValue,
      onChange: (e) => setCurrencyValue(e.target.value),
      required: true,
      children: (
        <>
          {["CHF", "EUR", "USD", "GBP"].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </>
      ),
    });
  const nullable = (value: FormDataEntryValue | null) =>
    value?.toString().trim() || null;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const f = new FormData(e.currentTarget),
        get = (n: string) => String(f.get(n) || "").trim(),
        num = (n: string) => parseMoney(get(n)),
        optional = (n: string) => (get(n) ? num(n) : null);
      const updated = structuredClone(data),
        id = spec.id || crypto.randomUUID();
      const source: Source = item
        ? {
            ...item.source,
            updatedAt: new Date().toISOString(),
            note: [
              item.source.note,
              "Modification manuelle le " + new Date().toISOString(),
            ]
              .filter(Boolean)
              .join(" · "),
          }
        : { system: "manual", updatedAt: new Date().toISOString() };
      if (spec.type === "account") {
        const previous = data.accounts.find((a) => a.id === id);
        const a = {
          id,
          name: get("name"),
          institution: get("institution"),
          kind: get("kind") as FinanceData["accounts"][number]["kind"],
          currency: get("currency"),
          valuationMode: get("valuationMode") as "total" | "components",
          balances: previous?.balances || [],
          source,
        };
        if (
          previous &&
          previous.currency !== a.currency &&
          previous.balances.length
        )
          throw new Error(
            "Créez un nouveau compte pour une autre devise : les anciens soldes doivent garder leur devise.",
          );
        updated.accounts = previous
          ? updated.accounts.map((v) => (v.id === id ? a : v))
          : [...updated.accounts, a];
      }
      if (spec.type === "balance") {
        const a = updated.accounts.find((a) => a.id === id);
        if (!a) throw new Error("Compte introuvable.");
        a.balances.push({
          id: crypto.randomUUID(),
          amountMinor: num("amountMinor"),
          asOf: get("asOf"),
          source: { system: "manual", updatedAt: new Date().toISOString() },
        });
      }
      if (spec.type === "transaction" && monthly) {
        const startDate = get("date") || today();
        const recurrence: Recurrence = {
          id,
          label: get("label"),
          kind: get("kind") as "income" | "expense",
          recurrenceType: (get("kind") === "income"
            ? "income"
            : get("recurrenceType")) as Recurrence["recurrenceType"],
          amountMinor: num("amountMinor"),
          currency: get("currency"),
          accountId: nullable(f.get("accountId")),
          category: get("category"),
          day: Number(startDate.slice(8, 10)),
          intervalMonths: 1,
          startDate,
          endDate: null,
          active: true,
          source,
        };
        updated.recurrences = [...updated.recurrences, recurrence];
        const status = get("status") as Transaction["status"];
        // Already paid or received this month: record this first occurrence as such.
        if (status !== "planned")
          updated.transactions = [
            ...updated.transactions,
            {
              id: crypto.randomUUID(),
              label: recurrence.label,
              kind: recurrence.kind,
              amountMinor: recurrence.amountMinor,
              currency: recurrence.currency,
              status,
              date: startDate,
              accountId: recurrence.accountId,
              category: recurrence.category,
              source,
              recurrenceId: recurrence.id,
              occurrenceDate: startDate,
            },
          ];
      } else if (spec.type === "transaction") {
        // Quick editor only exposes Libellé/Montant/Mois; date and budgetMonth come from
        // hidden inputs carrying the pre-edit value — transactionDateFields() decides whether
        // the month actually changed and resolves both fields from that (see its docstring).
        const { date, budgetMonth } = transactionDateFields(
          spec.quick === true,
          get("month"),
          get("date"),
          get("budgetMonth"),
        );
        const t = {
          id,
          label: get("label"),
          kind: get("kind") as "income" | "expense" | "transfer",
          amountMinor: num("amountMinor"),
          currency: get("currency"),
          status: get("status") as "planned" | "settled" | "unknown",
          date,
          budgetMonth,
          accountId: nullable(f.get("accountId")),
          destinationAccountId: nullable(f.get("destinationAccountId")),
          destinationAmountMinor: optional("destinationAmountMinor"),
          category: get("category"),
          source,
          ...(item && "recurrenceId" in item
            ? {
                recurrenceId: item.recurrenceId,
                occurrenceDate: item.occurrenceDate,
              }
            : {}),
        };
        updated.transactions = data.transactions.some((t) => t.id === id)
          ? updated.transactions.map((v) => (v.id === id ? t : v))
          : [...updated.transactions, t];
      }
      if (spec.type === "goal") {
        const g = {
          id,
          name: get("name"),
          targetMinor: optional("targetMinor"),
          reservedMinor: optional("reservedMinor"),
          currency: get("currency"),
          accountId: nullable(f.get("accountId")),
          dueDate: nullable(f.get("dueDate")),
          asOf: nullable(f.get("asOf")),
          source,
        };
        updated.goals = data.goals.some((g) => g.id === id)
          ? updated.goals.map((v) => (v.id === id ? g : v))
          : [...updated.goals, g];
      }
      if (spec.type === "position") {
        const p = {
          id,
          accountId: get("accountId"),
          name: get("name"),
          symbol: get("symbol"),
          assetType: get(
            "assetType",
          ) as FinanceData["positions"][number]["assetType"],
          quantity: nullable(f.get("quantity")),
          valueMinor: optional("valueMinor"),
          currency: get("currency"),
          asOf: nullable(f.get("asOf")),
          source,
        };
        updated.positions = data.positions.some((p) => p.id === id)
          ? updated.positions.map((v) => (v.id === id ? p : v))
          : [...updated.positions, p];
      }
      if (spec.type === "recurrence") {
        const existing = data.recurrences.find((r) => r.id === id);
        const amounts = recurrenceAmountFields(existing, num("amountMinor"));
        const r: Recurrence = {
          id,
          label: get("label"),
          kind: get("kind") as "income" | "expense",
          recurrenceType: get("recurrenceType") as Recurrence["recurrenceType"],
          amountMinor: amounts.amountMinor,
          amountEffectiveFrom: amounts.amountEffectiveFrom,
          amountHistory: amounts.amountHistory,
          currency: get("currency"),
          accountId: nullable(f.get("accountId")),
          category: get("category"),
          day: Number(get("day")),
          intervalMonths: Number(get("intervalMonths")),
          startDate: get("startDate"),
          endDate: nullable(f.get("endDate")),
          active: get("active") === "true",
          source,
        };
        updated.recurrences = existing
          ? updated.recurrences.map((v) => (v.id === id ? r : v))
          : [...updated.recurrences, r];
      }
      if (spec.type === "fx")
        updated.fxRates.push({
          from: get("from"),
          to: get("to"),
          rate: get("rate").replace(",", "."),
          asOf: get("asOf"),
          source,
        });
      await onSave(updated);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      onCancel={onClose}
      className="dialog"
      aria-labelledby="editor-title"
    >
      <div className="dialog-header">
        <div>
          <p className="eyebrow">FINANCE · SAISIE RAPIDE</p>
          <h2 id="editor-title">
            {spec.type === "recurrence" && !spec.id && recurrenceKind === "income"
              ? "Un revenu"
              : spec.type === "recurrence" && !spec.id && spec.recurrenceType === "bill"
                ? "Une facture"
                : titles[spec.type]}
          </h2>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={onClose}
          aria-label="Fermer"
        >
          <Icon name="close" />
        </button>
      </div>
      <form onSubmit={submit}>
        <div className="form-grid">
          {spec.type === "account" && (
            <>
              {field("Nom du compte", "name", { required: true })}
              {field("Établissement", "institution", { required: true })}
              {field("Type", "kind", {
                defaultValue: val("kind", "bank"),
                children: (
                  <>
                    <option value="bank">Compte bancaire</option>
                    <option value="savings">Épargne</option>
                    <option value="investment">Investissement</option>
                    <option value="debt">Dette</option>
                  </>
                ),
              })}
              {currency()}
              {field("Ce que représente le solde", "valuationMode", {
                defaultValue: val("valuationMode", "total"),
                children: (
                  <>
                    <option value="total">
                      Valeur totale, positions incluses
                    </option>
                    <option value="components">
                      Liquidités seules, ajouter les positions
                    </option>
                  </>
                ),
              })}
              <p className="footer-note field-full">
                Vous pourrez ensuite ajouter un solde daté. Le choix de
                valorisation évite de compter les investissements deux fois.
              </p>
            </>
          )}
          {spec.type === "balance" && (
            <>
              <p className="field-full">
                {val("name")} · {val("currency")}
              </p>
              {field("Solde observé", "amountMinor", {
                required: true,
                hint: "Montant du relevé, signe − si découvert.",
              })}
              {field("Date du solde", "asOf", {
                type: "date",
                required: true,
                defaultValue: today(),
                max: today(),
              })}
              <p className="footer-note field-full">
                L’historique est conservé. Cette observation n’ajoute ni revenu
                ni dépense.
              </p>
            </>
          )}
          {spec.type === "transaction" && (
            <>
              {spec.quick ? (
                <>
                  {field("Libellé", "label", { required: true })}
                  {field("Montant", "amountMinor", {
                    required: true,
                    defaultValue: amount("amountMinor"),
                  })}
                  {field("Mois", "month", {
                    type: "month",
                    required: true,
                    defaultValue:
                      val("date").slice(0, 7) ||
                      val("budgetMonth") ||
                      today().slice(0, 7),
                  })}
                  {/* Everything below preserves a field the full editor exposes but the
                      quick editor does not — narrows what is editable, not what is stored. */}
                  <input type="hidden" name="kind" value={val("kind", "expense")} />
                  <input
                    type="hidden"
                    name="currency"
                    value={val("currency", "CHF")}
                  />
                  <input type="hidden" name="accountId" value={val("accountId")} />
                  <input
                    type="hidden"
                    name="destinationAccountId"
                    value={val("destinationAccountId")}
                  />
                  <input
                    type="hidden"
                    name="destinationAmountMinor"
                    value={amount("destinationAmountMinor")}
                  />
                  <input
                    type="hidden"
                    name="status"
                    value={val("status", "planned")}
                  />
                  <input
                    type="hidden"
                    name="category"
                    value={val("category", "Divers")}
                  />
                  <input type="hidden" name="date" value={val("date")} />
                  <input
                    type="hidden"
                    name="budgetMonth"
                    value={val("budgetMonth")}
                  />
                </>
              ) : (
                <>
                  {field("Libellé", "label", { required: true })}
                  <label className="field">
                    <span>Type</span>
                    <select
                      aria-label="Type"
                      name="kind"
                      value={kind}
                      onChange={(e) => setKind(e.target.value as typeof kind)}
                    >
                      <option value="expense">Dépense</option>
                      <option value="income">Revenu</option>
                      <option value="transfer">Virement entre mes comptes</option>
                    </select>
                  </label>
                  {canRepeat && (
                    <div className="field field-full">
                      <span id="repeat-label">Répétition</span>
                      <div
                        className="tab-bar"
                        role="group"
                        aria-labelledby="repeat-label"
                      >
                        <button
                          type="button"
                          className={`tab-button${repeat === "once" ? " active" : ""}`}
                          aria-pressed={repeat === "once"}
                          onClick={() => setRepeat("once")}
                        >
                          Ce mois seulement
                        </button>
                        <button
                          type="button"
                          className={`tab-button${repeat === "monthly" ? " active" : ""}`}
                          aria-pressed={repeat === "monthly"}
                          onClick={() => setRepeat("monthly")}
                        >
                          Tous les mois
                        </button>
                      </div>
                    </div>
                  )}
                  {monthly && kind === "expense" &&
                    field("Nature", "recurrenceType", {
                      defaultValue: "bill",
                      children: (
                        <>
                          <option value="bill">Charge (loyer, assurance…)</option>
                          <option value="subscription">Abonnement</option>
                          <option value="saving">Épargne / mise de côté</option>
                          <option value="other">Autre à vérifier</option>
                        </>
                      ),
                    })}
                  {field("Montant", "amountMinor", {
                    required: true,
                    defaultValue: amount("amountMinor"),
                  })}
                  {currency()}
                  {accounts("Compte", "accountId", kind === "transfer", true)}
                  {field("Date de l’opération ou échéance", "date", {
                    type: "date",
                    defaultValue: val("date", item ? "" : today()),
                  })}
                  {!monthly &&
                    field("Mois de budget (facultatif)", "budgetMonth", {
                      type: "month",
                    })}
                  {field("État", "status", {
                    defaultValue: val("status", "planned"),
                    children: (
                      <>
                        <option value="planned">
                          {kind === "income"
                            ? "Pas encore reçu"
                            : kind === "expense"
                              ? "Pas encore payé"
                              : "Prévu"}
                        </option>
                        <option value="settled">
                          {kind === "income"
                            ? "Reçu"
                            : kind === "expense"
                              ? "Payé"
                              : "Réglé"}
                        </option>
                        <option value="unknown">À vérifier</option>
                      </>
                    ),
                  })}
                  {field("Catégorie", "category", {
                    defaultValue: val("category", "Divers"),
                    required: true,
                  })}
                  {kind === "transfer" && (
                    <>
                      {accounts(
                        "Compte destinataire",
                        "destinationAccountId",
                        true,
                      )}
                      {field(
                        "Montant reçu (devise du destinataire)",
                        "destinationAmountMinor",
                        {
                          defaultValue: amount("destinationAmountMinor"),
                          hint: "À renseigner pour un virement entre devises différentes.",
                        },
                      )}
                    </>
                  )}
                  <p className="footer-note field-full">
                    {monthly
                      ? "Enregistrée comme récurrence : elle revient chaque mois au même jour et se modifie depuis Abonnements. Chaque échéance reste à confirmer."
                      : "L’opération alimente votre mois. Les soldes restent des observations : actualisez-les depuis Mes comptes après rapprochement."}
                  </p>
                </>
              )}
            </>
          )}
          {spec.type === "goal" && (
            <>
              {field("Nom du projet", "name", { required: true })}
              {currency()}
              {field("Objectif", "targetMinor", {
                defaultValue: amount("targetMinor"),
              })}
              {field("Déjà réservé", "reservedMinor", {
                defaultValue: amount("reservedMinor"),
              })}
              {accounts("Réserve incluse dans ce compte", "accountId", false, true)}
              {field("Date de la réserve", "asOf", {
                type: "date",
                defaultValue: val("asOf", item ? "" : today()),
                max: today(),
              })}
              {field("Échéance", "dueDate", { type: "date" })}
              <p className="footer-note field-full">
                Une réserve fait partie du compte associé. Elle n’est pas
                ajoutée au patrimoine une seconde fois.
              </p>
            </>
          )}
          {spec.type === "position" && (
            <>
              {field("Nom du titre", "name", { required: true })}
              {field("Symbole", "symbol")}
              {accounts(
                "Compte d’investissement",
                "accountId",
                true,
                false,
                "investment",
              )}
              {!data.accounts.some((a) => a.kind === "investment") && (
                <p className="footer-note field-full">
                  Aucun compte de type Investissement pour l’instant. Créez-en
                  un depuis Mes comptes avant d’ajouter une position.
                </p>
              )}
              {field("Type d’actif", "assetType", {
                defaultValue: val("assetType", "stock"),
                children: (
                  <>
                    <option value="stock">Action</option>
                    <option value="etf">ETF</option>
                    <option value="option">Option</option>
                    <option value="crypto">Crypto</option>
                    <option value="other">Autre</option>
                  </>
                ),
              })}
              {field("Quantité", "quantity")}
              {field("Valeur totale de la position", "valueMinor", {
                defaultValue: amount("valueMinor"),
              })}
              {currency()}
              {field("Date de valorisation", "asOf", {
                type: "date",
                max: today(),
              })}
              <p className="footer-note field-full">
                Pour les options, saisir la valeur totale en tenant compte du
                multiplicateur du contrat. Aucun cours en temps réel n’est
                supposé.
              </p>
            </>
          )}
          {spec.type === "recurrence" && (
            <>
              {field("Libellé", "label", { required: true })}
              {field("Type", "kind", {
                value: recurrenceKind,
                onChange: (e) =>
                  setRecurrenceKind(e.target.value as "income" | "expense"),
                children: (
                  <>
                    <option value="expense">Dépense</option>
                    <option value="income">Revenu</option>
                  </>
                ),
              })}
              {field("Nature", "recurrenceType", {
                value: recurrenceType,
                onChange: (e) =>
                  setExpenseRecurrenceType(
                    e.target.value as Exclude<
                      Recurrence["recurrenceType"],
                      "income"
                    >,
                  ),
                children:
                  recurrenceKind === "income" ? (
                    <option value="income">Revenu récurrent</option>
                  ) : (
                    <>
                      <option value="subscription">Abonnement</option>
                      <option value="bill">
                        Charge (loyer, assurance…)
                      </option>
                      <option value="saving">Épargne / mise de côté</option>
                      <option value="other">Autre à vérifier</option>
                    </>
                  ),
              })}
              {field("Montant", "amountMinor", {
                defaultValue: amount("amountMinor"),
                required: true,
              })}
              {currency()}
              {accounts("Compte", "accountId", false, true)}
              {field("Catégorie", "category", {
                defaultValue: val(
                  "category",
                  spec.kind === "income"
                    ? "Revenus"
                    : spec.recurrenceType === "bill"
                      ? "Factures"
                      : "Abonnements",
                ),
                required: true,
              })}
              {field("Jour du mois", "day", {
                type: "number",
                defaultValue: val("day", "1"),
                required: true,
                min: "1",
                max: "31",
              })}
              {field("Tous les… mois", "intervalMonths", {
                defaultValue: val("intervalMonths", "1"),
                children: (
                  <>
                    <option value="1">Mois</option>
                    <option value="3">3 mois</option>
                    <option value="6">6 mois</option>
                    <option value="12">Ans</option>
                  </>
                ),
              })}
              {field("Début", "startDate", {
                type: "date",
                required: true,
                defaultValue: val("startDate", today()),
              })}
              {field("Fin (facultative)", "endDate", { type: "date" })}
              {field("Récurrence", "active", {
                defaultValue: val("active", "true"),
                children: (
                  <>
                    <option value="true">Active</option>
                    <option value="false">En pause</option>
                  </>
                ),
              })}
              <p className="footer-note field-full">
                Les échéances sont créées comme prévues. Chaque paiement doit
                être confirmé.
              </p>
            </>
          )}
          {spec.type === "fx" && (
            <>
              {field("Devise source", "from", {
                required: true,
                defaultValue: "EUR",
              })}
              {field("Devise cible", "to", {
                required: true,
                defaultValue: "CHF",
              })}
              {field("1 unité source vaut…", "rate", {
                required: true,
                hint: "Taux du relevé, pas un cours estimé.",
              })}
              {field("Date du taux", "asOf", {
                type: "date",
                required: true,
                defaultValue: today(),
                max: today(),
              })}
            </>
          )}
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Annuler
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
