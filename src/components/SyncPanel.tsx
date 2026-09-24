import { useState, type FormEvent } from "react";
import { detectSyncRepos } from "../sync";
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
const DEFAULT_SYNC_REPO = "finance-coffre";
// Pages GitHub préremplies : nouveau dépôt privé, et clé d'accès limitée au contenu des dépôts.
const NEW_REPO_URL = `https://github.com/new?name=${DEFAULT_SYNC_REPO}&visibility=private&description=${encodeURIComponent("Coffre chiffré de Finance")}`;
const NEW_TOKEN_URL = `https://github.com/settings/personal-access-tokens/new?name=Finance&description=${encodeURIComponent("Synchronisation du coffre chiffré Finance")}&expires_in=365&contents=write`;

/** Trois étapes guidées : créer le dépôt, créer la clé, coller la clé. Le reste est détecté. */
export function SyncFields({ idPrefix }: { idPrefix: string }) {
  return (
    <>
      <ol className="sync-steps">
        <li>
          <a className="button secondary small" href={NEW_REPO_URL} target="_blank" rel="noreferrer">
            1. Créer le dépôt privé
          </a>
          <span className="meta">
            Sur GitHub, gardez le nom {DEFAULT_SYNC_REPO} et « Private », puis « Create repository ».
          </span>
        </li>
        <li>
          <a className="button secondary small" href={NEW_TOKEN_URL} target="_blank" rel="noreferrer">
            2. Créer la clé d’accès
          </a>
          <span className="meta">
            Choisissez « Only select repositories » → {DEFAULT_SYNC_REPO}, vérifiez
            « Contents : Read and write », puis « Generate token » et copiez la clé.
          </span>
        </li>
      </ol>
      <label className="field">
        <span>3. Clé d’accès</span>
        <input
          name="token"
          type="password"
          // Ni enregistrée ni proposée comme mot de passe par le navigateur ou un gestionnaire.
          autoComplete="off"
          data-1p-ignore=""
          data-lpignore="true"
          data-bwignore=""
          spellCheck={false}
          placeholder="github_pat_…"
          aria-describedby={`${idPrefix}-token-help`}
          required
        />
      </label>
      <p className="meta" id={`${idPrefix}-token-help`}>
        Collez la clé : Finance retrouve seul votre identifiant et votre dépôt.
      </p>
      <details className="sync-advanced">
        <summary>Options avancées</summary>
        <label className="field">
          <span>Propriétaire GitHub</span>
          <input
            name="owner"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="détecté automatiquement"
          />
        </label>
        <label className="field">
          <span>Dépôt privé</span>
          <input
            name="repo"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="détecté automatiquement"
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
          />
        </label>
      </details>
    </>
  );
}

/** Complète propriétaire et dépôt depuis la seule clé quand ils ne sont pas indiqués. */
export async function resolveSyncInput(input: SyncInput): Promise<SyncInput> {
  if (input.owner && input.repo) return input;
  const { owner, repos } = await detectSyncRepos(input.token);
  // Propriétaire indiqué autre que le titulaire de la clé : sa liste ne dit rien de ses dépôts.
  if (!input.repo && input.owner && input.owner.toLowerCase() !== owner.toLowerCase())
    throw new Error(
      `Indiquez aussi le dépôt de ${input.owner} dans « Options avancées ».`,
    );
  const repo = input.repo
    ? input.repo
    : repos.includes(DEFAULT_SYNC_REPO)
      ? DEFAULT_SYNC_REPO
      : repos.length === 1
        ? repos[0]
        : null;
  if (!repo)
    throw new Error(
      repos.length
        ? `Plusieurs dépôts privés sont accessibles avec cette clé (${repos.join(", ")}). Indiquez lequel dans « Options avancées ».`
        : `Aucun dépôt privé accessible avec cette clé : à l’étape 2, choisissez le dépôt ${DEFAULT_SYNC_REPO}.`,
    );
  return { ...input, owner: input.owner || owner, repo };
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
  onCreateLink,
}: {
  view: SyncView;
  demo: boolean;
  busy: boolean;
  onConfigure: (input: SyncInput) => Promise<void>;
  onSyncNow: () => void;
  onDisable: () => void;
  /** Lien d'ajout d'un autre appareil (réglages et jeton chiffrés avec la clé du coffre). */
  onCreateLink?: () => Promise<string>;
}) {
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [linkNote, setLinkNote] = useState("");
  async function makeLink() {
    if (!onCreateLink) return;
    setLinkNote("");
    try {
      setLink(await onCreateLink());
    } catch (err) {
      setLinkNote(err instanceof Error ? err.message : "Lien impossible à créer.");
    }
  }
  async function shareLink() {
    try {
      await navigator.share({ title: "Finance", text: "Ajouter un appareil à Finance", url: link });
    } catch {
      // Partage annulé : le lien reste affiché et copiable.
    }
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setLinkNote("Lien copié. Collez-le dans Finance sur l’autre appareil.");
    } catch {
      setLinkNote("Copie impossible ici : sélectionnez le lien et copiez-le.");
    }
  }
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
          {onCreateLink && (
            <button className="button secondary" disabled={busy} onClick={makeLink}>
              <Icon name="plus" />
              Ajouter un appareil
            </button>
          )}
          {link && (
            <div className="device-link">
              <p className="meta">
                Sur l’autre appareil : ouvrez ce lien (ou touchez « J’ai déjà
                un compte sur un autre appareil » et collez-le), puis tapez
                votre phrase secrète.
              </p>
              <input
                readOnly
                value={link}
                aria-label="Lien d’ajout d’appareil"
                onFocus={(e) => e.currentTarget.select()}
              />
              <div className="action-row">
                {typeof navigator.share === "function" && (
                  <button className="button secondary small" onClick={shareLink}>
                    <Icon name="upload" />
                    Partager
                  </button>
                )}
                <button className="button secondary small" onClick={copyLink}>
                  <Icon name="document" />
                  Copier
                </button>
              </div>
              <p className="meta">
                Le lien contient l’accès au dépôt, chiffré avec votre phrase
                secrète : envoyez-le seulement à vous-même.
              </p>
            </div>
          )}
          {linkNote && (
            <p className="meta" role="status">
              {linkNote}
            </p>
          )}
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
