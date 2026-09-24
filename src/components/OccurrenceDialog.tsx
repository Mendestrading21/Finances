import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Recurrence } from "../domain/types";
import { monthLabel, money, parseMoney } from "../domain/finance";
import { Icon } from "./Icon";

export type OccurrenceScope = "month" | "following";

/** Petit changement sur une charge récurrente : ce mois seulement, ou ce mois et les suivants. */
export default function OccurrenceDialog({
  recurrence,
  occurrenceDate,
  amountMinor,
  currency,
  usualAmountMinor,
  settled,
  onSave,
  onEditAll,
  onClose,
}: {
  recurrence: Recurrence;
  occurrenceDate: string;
  /** Montant de cette échéance (ajusté ou réglé s'il y en a un). */
  amountMinor: number;
  currency: string;
  /** Montant habituel de la règle pour ce mois, hors ajustement. */
  usualAmountMinor: number;
  settled: boolean;
  onSave: (scope: OccurrenceScope, amountMinor: number) => Promise<void>;
  onEditAll: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const amountInput = useRef<HTMLInputElement>(null);
  const [scope, setScope] = useState<OccurrenceScope>("month");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // Même motif que l'éditeur : le focus revient au bouton qui a ouvert la fenêtre.
    const trigger =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    // Après showModal (qui place le focus sur « Fermer ») : le montant est ce qu'on vient changer.
    amountInput.current?.focus();
    amountInput.current?.select();
    return () => {
      dialog.current?.close();
      if (trigger && document.body.contains(trigger)) trigger.focus();
    };
  }, []);
  const month = occurrenceDate.slice(0, 7);
  const monthName = monthLabel(month);
  const income = recurrence.kind === "income";
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const value = parseMoney(
        String(new FormData(e.currentTarget).get("amount") || ""),
      );
      if (value < 0) throw new Error("Indiquez un montant positif.");
      await onSave(scope, value);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      onCancel={onClose}
      className="dialog"
      aria-labelledby="occurrence-title"
    >
      <div className="dialog-header">
        <div>
          <p className="eyebrow">FINANCE · {monthName.toUpperCase()}</p>
          <h2 id="occurrence-title">Modifier {recurrence.label}</h2>
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
          {/* Pas de date : le mois est dans l'en-tête, seuls l'état et le montant habituel comptent. */}
          {(settled || amountMinor !== usualAmountMinor) && (
            <p className="meta field-full">
              {[
                settled ? (income ? "Déjà reçu" : "Déjà payé") : null,
                amountMinor !== usualAmountMinor
                  ? `${settled ? "montant" : "Montant"} habituel ${money(usualAmountMinor, recurrence.currency)}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          <label className="field field-full">
            <span>Montant ({currency})</span>
            <input
              name="amount"
              inputMode="decimal"
              autoComplete="off"
              ref={amountInput}
              aria-describedby="occurrence-scope-note"
              defaultValue={String(amountMinor / 100)}
              required
            />
          </label>
          <div className="field field-full">
            <span id="occurrence-scope-label">S’applique à</span>
            <div
              className="tab-bar"
              role="group"
              aria-labelledby="occurrence-scope-label"
            >
              {(
                [
                  ["month", "Ce mois seulement"],
                  ["following", "Ce mois et les suivants"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`tab-button${scope === value ? " active" : ""}`}
                  aria-pressed={scope === value}
                  onClick={() => setScope(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="footer-note field-full" id="occurrence-scope-note">
            {scope === "month"
              ? settled
                ? `Corrige le montant ${income ? "reçu" : "payé"} pour ${monthName}. Les autres mois ne changent pas.`
                : `Seule l’échéance de ${monthName} change. Les autres mois ne changent pas.`
              : `Nouveau montant habituel à partir de ${monthName}. Les mois précédents gardent leur montant${
                  settled
                    ? `, et le ${income ? "montant reçu" : "paiement"} déjà enregistré pour ${monthName} garde le sien`
                    : ""
                }. Un mois déjà modifié seul garde son montant.`}
          </p>
          <button
            type="button"
            className="text-button field-full"
            onClick={onEditAll}
          >
            Modifier le nom, le compte, la répétition ou l’arrêter
          </button>
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
