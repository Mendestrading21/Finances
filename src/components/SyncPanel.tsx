import { useState, type FormEvent } from "react";
import { Icon } from "./Icon";

export type SyncView =
  | { state: "off" }
  | { state: "reconfigure" }
  | {
      state:
        | "idle"
        | "syncing"
        | "ok"
        | "offline"
        | "error"
        | "conflict"
        | "foreign";
      repo: string;
      lastSyncAt?: string;
      detail?: string;
    };

export type SyncInput = {
  owner: string;
  repo: string;
  path: string;
  token: string;
};

export const DEFAULT_SYNC_PATH = "finance-coffre.json";

export function SyncFields({ idPrefix }: { idPrefix: string }) {
  return (
    <>
      <label className="field">
        <span>Propriétaire GitHub</span>
        <input
          name="owner"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="votre-identifiant"
          required
        />
      </label>
      <label className="field">
        <span>Dépôt privé</span>
        <input
          name="repo"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="finance-coffre"
          required
        />
      </label>
      <label className="field">
        <span>Fichier du coffre</span>
        <input
          name="path"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={DEFAULT_SYNC_PATH}
          required
        />
      </label>
      <label className="field">
        <span>Jeton d’accès</span>
        <input
          name="token"
          type="password"
          // Ni enregistré ni proposé comme mot de passe par le navigateur ou un gestionnaire.
          autoComplete="off"
          data-1p-ignore=""
          data-lpignore="true"
          data-bwignore=""
          spellCheck={false}
          aria-describedby={`${idPrefix}-token-help`}
          required
        />
      </label>
      <p className="meta" id={`${idPrefix}-token-help`}>
        Jeton « fine-grained » (il commence par github_pat_) limité à ce seul
        dépôt, permission Contents en lecture et écriture.
      </p>
    </>
  );
}

export function readSyncInput(form: FormData): SyncInput {
  const get = (name: string) => String(form.get(name) || "").trim();
  return {
    owner: get("owner"),
    repo: get("repo"),
    path: get("path") || DEFAULT_SYNC_PATH,
    token: get("token"),
  };
}

export function dateTimeLabel(iso?: string): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "date inconnue";
  return d.toLocaleString("fr-CH", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function syncStatusText(view: SyncView): string {
  switch (view.state) {
    case "off":
      return "Non configurée sur cet appareil.";
    case "reconfigure":
      return "À reconfigurer : le jeton enregistré ne correspond plus à ce coffre.";
    case "syncing":
      return "Synchronisation en cours…";
    case "ok":
      return `Synchronisé${view.lastSyncAt ? ` · ${dateTimeLabel(view.lastSyncAt)}` : ""}.`;
    case "idle":
      return "Configurée, en attente de la première synchronisation.";
    case "offline":
      return "Hors ligne : la synchronisation reprendra plus tard.";
    case "conflict":
      return "Choix nécessaire : ce coffre a changé ici et sur un autre appareil.";
    case "foreign":
      return "Arrêtée : ce dépôt contient un autre coffre. Rien n’a été modifié.";
    case "error":
      return view.detail || "La synchronisation a échoué.";
  }
}

export function SyncCard({
  view,
  demo,
  busy,
  onConfigure,
  onSyncNow,
  onDisable,
}: {
  view: SyncView;
  demo: boolean;
  busy: boolean;
  onConfigure: (input: SyncInput) => Promise<void>;
  onSyncNow: () => void;
  onDisable: () => void;
}) {
  const [error, setError] = useState("");
  const configured = view.state !== "off" && view.state !== "reconfigure";
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const form = e.currentTarget;
    try {
      await onConfigure(readSyncInput(new FormData(form)));
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Configuration impossible.");
    }
  }
  if (demo)
    return (
      <p className="footer-note">
        La synchronisation entre appareils se configure une fois votre coffre
        ouvert.
      </p>
    );
  return (
    <div className="sync-panel">
      <p
        className={`sync-status sync-${view.state}`}
        role="status"
        aria-live="polite"
      >
        <Icon
          name={
            view.state === "ok"
              ? "check"
              : view.state === "syncing"
                ? "refresh"
                : view.state === "off"
                  ? "lock"
                  : "alert"
          }
          size={16}
        />
        <span>
          {configured && "repo" in view && (
            <strong>{view.repo} · </strong>
          )}
          {syncStatusText(view)}
        </span>
      </p>
      {configured ? (
        <div className="action-stack">
          <button
            className="button secondary"
            disabled={busy || view.state === "syncing"}
            onClick={onSyncNow}
          >
            <Icon name="refresh" />
            Synchroniser maintenant
          </button>
          <button className="button secondary" disabled={busy} onClick={onDisable}>
            <Icon name="close" />
            Désactiver sur cet appareil
          </button>
          <p className="meta">
            Désactiver ne supprime ni le fichier du dépôt ni le jeton : révoquez
            le jeton sur GitHub si besoin. L’historique du dépôt garde les
            anciennes versions chiffrées.
          </p>
        </div>
      ) : (
        <form className="sync-form" onSubmit={submit}>
          <p className="footer-note">
            Un seul coffre pour tous vos appareils : seule sa version chiffrée
            est envoyée dans un dépôt GitHub privé qui vous appartient. La
            phrase secrète ne quitte jamais l’appareil.
          </p>
          <SyncFields idPrefix="sync-settings" />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary" disabled={busy}>
            <Icon name="refresh" />
            {busy ? "Vérification…" : "Activer la synchronisation"}
          </button>
        </form>
      )}
    </div>
  );
}
