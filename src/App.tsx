import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  emptyData,
  type FinanceData,
  type Account,
  type Recurrence,
  type Source,
  type Transaction,
} from "./domain/types";
import {
  cohortSummary,
  convertMinor,
  isDate,
  latestBalance,
  money,
  monthLabel,
  monthSummary,
  monthlyEquivalentMinor,
  nextOccurrenceDate,
  occurrenceCohort,
  rankAccounts,
  rankByValue,
  recurringFlowSummary,
  today,
  transactionsForMonth,
  wealthSummary,
  findOccurrenceTransaction,
  projectedOccurrence,
  transactionMonth,
  rhythmLabel,
  withOccurrenceAmount,
  withRecurrenceAmount,
} from "./domain/finance";
import { validateData, mergeImport } from "./domain/validation";
import {
  createVault,
  unlockVault,
  saveVault,
  vaultExists,
  exportVault,
  importVault,
} from "./vault";
import { demoData } from "./demo";
import { parseTransactionCsv, CSV_TEMPLATE } from "./importCsv";
import { Icon, type IconName } from "./components/Icon";
import {
  accountTypeIcon,
  accountTypeOf,
  wealthByType,
} from "./domain/accountTypes";
import {
  SPARKLINE_MIN_POINTS,
  Sparkline,
  WealthChart,
} from "./components/Charts";
import Editor, { type EditorSpec } from "./components/Editor";
import OccurrenceDialog, { type OccurrenceScope } from "./components/OccurrenceDialog";
import { MonthPicker } from "./components/MonthPicker";
import {
  SyncCard,
  SyncFields,
  dateTimeLabel,
  readSyncInput,
  resolveSyncInput,
  type SyncInput,
  type SyncView,
} from "./components/SyncPanel";
import {
  configureSync,
  disableSync,
  loadSyncState,
  openFromGitHub,
  resolveConflict,
  syncNow,
  SyncOfflineError,
  VaultChangedError,
} from "./sync";
import { vaultRevision } from "./vault";
import { quickUnlock, quickUnlockEnabled } from "./quickUnlock";
import {
  createDeviceLink,
  openFromDeviceLink,
  readDeviceLink,
  type DeviceLink,
} from "./deviceLink";
import { QuickUnlockCard } from "./components/QuickUnlockCard";
import { UPDATE_READY_EVENT } from "./swUpdateEvent";
const pages = [
  { id: "overview", name: "Vue d’ensemble", short: "Accueil", icon: "home" },
  { id: "month", name: "Mon mois", short: "Mon mois", icon: "calendar" },
  { id: "bills", name: "Factures", short: "Factures", icon: "document" },
  { id: "accounts", name: "Mes comptes", short: "Comptes", icon: "wallet" },
  {
    id: "subscriptions",
    name: "Abonnements",
    short: "Abonnements",
    icon: "refresh",
  },
  { id: "goals", name: "Épargne et projets", short: "Projets", icon: "target" },
  {
    id: "investments",
    name: "Investissements",
    short: "Investir",
    icon: "chart",
  },
  {
    id: "documents",
    name: "Documents et réglages",
    short: "Documents",
    icon: "folder",
  },
] as const;
type Page = (typeof pages)[number]["id"];
// Onglets toujours visibles en bas sur téléphone ; les autres pages sont sous « Plus ».
const MOBILE_TABS = 4;
function download(raw: string, name: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([raw], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// Local monogram instead of a fetched logo (identite-ui.md): "Banque Fictive" → "BF".
function monogramInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (
    words.length > 1 ? words[0][0] + words[1][0] : name.replace(/\s+/g, "").slice(0, 2)
  ).toUpperCase();
}
// Une information importée puis modifiée garde la trace de la modification manuelle.
function manualSource(source: Source): Source {
  const now = new Date().toISOString();
  return {
    ...source,
    updatedAt: now,
    note: [source.note, "Modification manuelle le " + now].filter(Boolean).join(" · "),
  };
}
const PULLED_MEANWHILE =
  "Vos données viennent d’être mises à jour depuis un autre appareil. Vérifiez, puis recommencez.";
const EDITED_ELSEWHERE =
  "Cet élément a été mis à jour depuis un autre appareil pendant l’édition. Fermez, puis rouvrez-le.";
// Espace insécable avant le point : jamais de « · » seul en début de ligne.
const SEP = "\u00a0· ";
const assetTypeLabels: Record<
  FinanceData["positions"][number]["assetType"],
  string
> = {
  stock: "Action",
  etf: "ETF",
  option: "Option",
  crypto: "Crypto",
  other: "Autre",
};
function SourceLink({ source }: { source: Source }) {
  return source.url && /^https:\/\/(www\.)?notion\.so\//.test(source.url) ? (
    <a
      className="source-link"
      href={source.url}
      target="_blank"
      rel="noreferrer"
      title={source.note}
    >
      {source.note?.includes("Modification manuelle")
        ? "Notion · modifié manuellement ↗"
        : "Source Notion ↗"}
    </a>
  ) : (
    <span className="meta">
      {source.system === "demo"
        ? "Exemple fictif"
        : source.system === "manual"
          ? "Saisie manuelle"
          : source.system === "notion"
            ? "Source Notion"
            : "Import"}
    </span>
  );
}
// `icon` gives the card header a small semantic chip (identite-ui.md: "Ajouter une icône
// dans l'en-tête des cartes principales") — optional and reused from the app's existing
// icon set, never a new one invented per card. Kept off by default (undefined) rather than
// defaulting every Card to an icon, matching the same reference's warning not to add an
// icon "à chaque ligne décorative": only call sites that pass one get a chip.
function Card({
  title,
  icon,
  action,
  children,
  className = "",
}: {
  title: string;
  icon?: IconName;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      <div className="card-header">
        <div className="card-heading">
          {icon && (
            <span className="card-icon">
              <Icon name={icon} size={18} />
            </span>
          )}
          <h2 className="card-title">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
// vault.ts (importVault) refuses a backup strictly older than the vault already present
// on this device by throwing a plain Error whose message starts with this exact wording.
// It exposes no dedicated error type, so the UI matches on that stable prefix to offer an
// explicit "restore anyway" confirmation instead of a dead-end error. Keep in sync with the
// message importVault throws in src/vault.ts.
const OLDER_BACKUP_ERROR_PREFIX = "Cette sauvegarde est plus ancienne";
function isOlderBackupError(message: string): boolean {
  return message.startsWith(OLDER_BACKUP_ERROR_PREFIX);
}
type InstallPromptEvent = Event & { prompt: () => Promise<void> };
function Auth({
  onOpen,
  onDemo,
  installPrompt,
  onInstall,
}: {
  onOpen: (data: FinanceData, key: CryptoKey) => void;
  onDemo: () => void;
  installPrompt: InstallPromptEvent | null;
  onInstall: () => void;
}) {
  const [exists, setExists] = useState(vaultExists),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [backup, setBackup] = useState<string | null>(null),
    // Set only when importVault refused to restore because the backup is older than the
    // current vault. Holds what's needed to retry with allowOlder once the person
    // explicitly confirms; cleared on cancel, on success, or if another error occurs.
    [olderBackup, setOlderBackup] = useState<{
      raw: string;
      message: string;
    } | null>(null),
    cancelOlderBackupRef = useRef<HTMLButtonElement>(null),
    // The passphrase already authenticated successfully once (importVault decrypted the
    // backup before refusing it for being older) — kept only long enough to retry with
    // allowOlder, in a ref rather than React state so it never gets captured in a
    // state-inspection snapshot. Cleared right after that retry settles, on cancel, or
    // whenever a fresh restore attempt starts.
    pendingOlderBackupPasswordRef = useRef(""),
    // Nouvel appareil : ouvrir le coffre chiffré conservé dans le dépôt GitHub privé.
    [fromGitHub, setFromGitHub] = useState(false),
    // Réglages GitHub (jeton compris) gardés hors de l'état React, le temps d'une confirmation « plus ancien ».
    pendingGitHubRef = useRef<SyncInput | null>(null),
    // Nouvel appareil par un code créé sur un appareil déjà configuré : code + phrase secrète.
    // Collé, jamais ouvert comme adresse : une URL resterait dans l'historique du navigateur.
    [fromLink, setFromLink] = useState(false),
    pendingLinkRef = useRef<DeviceLink | null>(null),
    [quick, setQuick] = useState(quickUnlockEnabled);
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ios =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  async function unlockQuick() {
    setError("");
    setBusy(true);
    try {
      const r = await quickUnlock();
      onOpen(r.data, r.key);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Déverrouillage impossible.");
      setQuick(quickUnlockEnabled());
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    // Default focus lands on the safer action so a stray Enter/Space never replaces
    // newer data by accident.
    if (olderBackup) cancelOlderBackupRef.current?.focus();
  }, [olderBackup]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    let password = "";
    try {
      const f = new FormData(e.currentTarget);
      password = String(f.get("password") || "");
      if (fromLink) {
        const link = readDeviceLink(String(f.get("link") || ""));
        if (exists && !f.get("replace"))
          throw new Error(
            "Confirmez le remplacement du coffre présent sur cet appareil.",
          );
        pendingLinkRef.current = link;
        const r = await openFromDeviceLink(link, password);
        pendingLinkRef.current = null;
        onOpen(r.data, r.key);
      } else if (fromGitHub) {
        if (exists && !f.get("replace"))
          throw new Error(
            "Confirmez le remplacement du coffre présent sur cet appareil.",
          );
        const settings = await resolveSyncInput(readSyncInput(f));
        pendingGitHubRef.current = settings;
        const r = await openFromGitHub(settings, password);
        pendingGitHubRef.current = null;
        onOpen(r.data, r.key);
      } else if (backup) {
        if (exists && !f.get("replace"))
          throw new Error(
            "Confirmez le remplacement du coffre présent sur cet appareil.",
          );
        const r = await importVault(backup, password);
        onOpen(r.data, r.key);
      } else if (exists) {
        const r = await unlockVault(password);
        onOpen(r.data, r.key);
      } else {
        if (password !== f.get("confirmation"))
          throw new Error("Les deux phrases secrètes sont différentes.");
        const data = emptyData();
        const key = await createVault(password, data);
        onOpen(data, key);
      }
    } catch (e) {
      if (
        (backup || fromGitHub || fromLink) &&
        e instanceof Error &&
        isOlderBackupError(e.message)
      ) {
        // Nothing was written (importVault fails closed before touching the vault):
        // ask for an explicit, conscious confirmation instead of a dead-end error.
        pendingOlderBackupPasswordRef.current = password;
        setOlderBackup({
          raw: fromGitHub || fromLink ? "" : (backup ?? ""),
          message: e.message,
        });
      } else {
        pendingGitHubRef.current = null;
        pendingLinkRef.current = null;
        setError(
          e instanceof Error ? e.message : "Impossible d’ouvrir le coffre.",
        );
      }
    } finally {
      setBusy(false);
    }
  }
  async function confirmOlderBackup() {
    if (!olderBackup) return;
    setBusy(true);
    setError("");
    const password = pendingOlderBackupPasswordRef.current;
    const github = pendingGitHubRef.current;
    const link = pendingLinkRef.current;
    try {
      const r = link
        ? await openFromDeviceLink(link, password, true)
        : github
          ? await openFromGitHub(github, password, true)
          : await importVault(olderBackup.raw, password, true);
      setOlderBackup(null);
      onOpen(r.data, r.key);
    } catch (e) {
      // Any other failure here (e.g. the vault changed underneath us) falls back to the
      // normal error path — no false success, and the person lands back on the form.
      setOlderBackup(null);
      setError(
        e instanceof Error ? e.message : "Impossible d’ouvrir le coffre.",
      );
    } finally {
      pendingOlderBackupPasswordRef.current = "";
      pendingGitHubRef.current = null;
      pendingLinkRef.current = null;
      setBusy(false);
    }
  }
  function cancelOlderBackup() {
    // Nothing was ever written for this refusal, so canceling is a pure UI reset.
    pendingOlderBackupPasswordRef.current = "";
    pendingGitHubRef.current = null;
    pendingLinkRef.current = null;
    setOlderBackup(null);
    setError("");
  }
  async function restore(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 25_000_000) {
      setError("Sauvegarde trop volumineuse (25 Mo maximum).");
      return;
    }
    pendingOlderBackupPasswordRef.current = "";
    setOlderBackup(null);
    setBackup(await file.text());
    setError("");
  }
  return (
    <main className="auth-screen">
      <section className="auth-art">
        <div className="brand">
          <img src="./favicon.svg" className="brand-mark" alt="" />
          Finance
        </div>
        <p className="eyebrow">VOTRE ARGENT. VOTRE HORIZON.</p>
        <h1>
          Tout voir.
          <br />
          Mieux avancer.
        </h1>
        <p>
          Le budget du quotidien et les projets de demain,
          <br />
          dans un seul espace personnel.
        </p>
        <div className="vault-mark">
          <Icon name="shield" size={56} />
        </div>
        <div className="pill">Privé par conception</div>
      </section>
      <section className="auth-card">
        <div className="brand mobile-brand">
          <img src="./favicon.svg" className="brand-mark" alt="" />
          Finance
        </div>
        <p className="eyebrow">BIENVENUE CHEZ VOUS</p>
        <h2 id="auth-heading">
          {olderBackup
            ? "Confirmer la restauration"
            : fromLink
              ? "Ajouter cet appareil"
            : fromGitHub
              ? "Ouvrir depuis GitHub"
              : backup
                ? "Restaurer votre sauvegarde"
                : exists
                  ? "Ouvrir mon espace"
                  : "Créer mon espace privé"}
        </h2>
        <p className="subtitle">
          {olderBackup
            ? "Cette sauvegarde est plus ancienne que les données déjà présentes sur cet appareil."
            : fromLink
              ? "Collez le code créé sur votre autre appareil (Documents et réglages → Ajouter un appareil), puis tapez votre phrase secrète."
            : fromGitHub
              ? "Récupérez le coffre chiffré de vos autres appareils, puis déverrouillez-le avec la même phrase secrète."
              : exists
                ? "Votre phrase secrète déverrouille les données de cet appareil."
                : "Choisissez une phrase secrète de 12 caractères minimum. Elle chiffre vos données sur cet appareil."}
        </p>
        {olderBackup ? (
          <div
            className="older-backup-confirm"
            role="alertdialog"
            aria-labelledby="auth-heading"
            aria-describedby="older-backup-message"
          >
            <p className="notice warning" id="older-backup-message" role="alert">
              {olderBackup.message}
            </p>
            <p className="footer-note">
              Vous êtes sur le point de remplacer les données actuelles de cet
              appareil, plus récentes, par cette sauvegarde plus ancienne.
              Cette action remplacera le coffre de cet appareil.
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button
              type="button"
              className="button primary full-width"
              disabled={busy}
              onClick={confirmOlderBackup}
            >
              {busy ? "Restauration…" : "Restaurer quand même"}
              <Icon name="chevron-right" />
            </button>
            <button
              type="button"
              ref={cancelOlderBackupRef}
              className="button secondary full-width"
              disabled={busy}
              onClick={cancelOlderBackup}
            >
              Annuler
            </button>
          </div>
        ) : (
          <>
            {exists && quick && !backup && !fromGitHub && !fromLink && (
              <div className="auth-quick">
                <button
                  type="button"
                  className="button primary full-width"
                  disabled={busy}
                  onClick={unlockQuick}
                >
                  <Icon name="lock" />
                  {busy ? "Ouverture…" : "Déverrouiller avec Face ID ou l’empreinte"}
                </button>
                <p className="meta">ou avec votre phrase secrète :</p>
              </div>
            )}
            <form onSubmit={submit}>
              {fromLink && (
                <label className="field">
                  <span>Code d’ajout</span>
                  <input
                    name="link"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="Collez le code ici"
                    required
                  />
                </label>
              )}
              <label className="field">
                <span>Phrase secrète</span>
                <input
                  type="password"
                  name="password"
                  autoComplete={
                    exists || fromGitHub || fromLink ? "current-password" : "new-password"
                  }
                  minLength={exists || backup || fromGitHub || fromLink ? 1 : 12}
                  required
                />
              </label>
              {fromGitHub && <SyncFields idPrefix="auth-sync" />}
              {(fromGitHub || fromLink) && exists && (
                <label className="notice">
                  <input type="checkbox" name="replace" /> Remplacer le
                  coffre de cet appareil par celui du dépôt. Exportez d’abord
                  une sauvegarde chiffrée de celui-ci pour le garder.
                </label>
              )}
              {!exists && !backup && !fromGitHub && !fromLink && (
                <label className="field">
                  <span>Confirmer la phrase secrète</span>
                  <input
                    type="password"
                    name="confirmation"
                    autoComplete="new-password"
                    minLength={12}
                    required
                  />
                </label>
              )}
              {backup && exists && (
                <label className="notice">
                  <input type="checkbox" name="replace" /> Remplacer le
                  coffre de cet appareil par cette sauvegarde.
                </label>
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button className="button primary full-width" disabled={busy}>
                {busy
                  ? "Ouverture…"
                  : fromLink
                    ? "Ajouter cet appareil"
                  : fromGitHub
                    ? "Ouvrir depuis GitHub"
                    : backup
                      ? "Restaurer"
                      : exists
                        ? "Déverrouiller"
                        : "Créer mon coffre"}
                <Icon name="chevron-right" />
              </button>
            </form>
            <p className="footer-note">
              La phrase secrète ne peut pas être récupérée. Gardez-la et
              exportez régulièrement une sauvegarde chiffrée.
            </p>
            {!fromGitHub && !fromLink && (
              <div className="auth-links">
                {!exists && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => {
                      pendingOlderBackupPasswordRef.current = "";
                      setBackup(null);
                      setOlderBackup(null);
                      setError("");
                      setFromLink(true);
                    }}
                  >
                    J’ai déjà un compte sur un autre appareil
                  </button>
                )}
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={onDemo}
                >
                  Voir la démonstration
                </button>
                <details className="auth-more">
                  <summary>Autres options</summary>
                  {exists && (
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => {
                        pendingOlderBackupPasswordRef.current = "";
                        setBackup(null);
                        setOlderBackup(null);
                        setError("");
                        setFromLink(true);
                      }}
                    >
                      Remplacer par le compte d’un autre appareil
                    </button>
                  )}
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => {
                      pendingOlderBackupPasswordRef.current = "";
                      setBackup(null);
                      setOlderBackup(null);
                      setError("");
                      setFromGitHub(true);
                    }}
                  >
                    Ouvrir avec la clé GitHub
                  </button>
                  <label className="button secondary">
                    Restaurer une sauvegarde
                    <input
                      className="sr-only"
                      type="file"
                      accept=".finance-vault,.json"
                      onChange={restore}
                    />
                  </label>
                </details>
              </div>
            )}
            {(fromGitHub || fromLink) && (
              <div className="auth-links">
                {fromLink && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      setFromLink(false);
                      setFromGitHub(true);
                      setError("");
                    }}
                  >
                    Pas de code ? Utiliser la clé GitHub
                  </button>
                )}
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    setFromGitHub(false);
                    setFromLink(false);
                    setError("");
                  }}
                >
                  Retour
                </button>
              </div>
            )}
            {!standalone && (
              <p className="notice auth-install">
                <span>
                  {installPrompt
                    ? "Installez Finance comme une app sur cet appareil."
                    : ios
                      ? "Pour l’installer : ouvrez Finance dans Safari, touchez Partager puis « Sur l’écran d’accueil »."
                      : "Pour l’installer : menu du navigateur, puis « Installer l’application »."}{" "}
                  Chaque navigateur et l’app installée gardent leurs propres données.
                </span>
                {installPrompt && (
                  <button className="text-button" onClick={onInstall}>
                    Installer
                  </button>
                )}
              </p>
            )}
            {backup && (
              <button
                className="text-button"
                onClick={() => {
                  pendingOlderBackupPasswordRef.current = "";
                  setBackup(null);
                  setOlderBackup(null);
                  setExists(vaultExists());
                }}
              >
                Annuler la restauration
              </button>
            )}
          </>
        )}
      </section>
    </main>
  );
}
export default function App() {
  const [data, setData] = useState<FinanceData | null>(null),
    [key, setKey] = useState<CryptoKey | null>(null),
    [demo, setDemo] = useState(false),
    [page, setPage] = useState<Page>("overview"),
    [month, setMonth] = useState(today().slice(0, 7)),
    [currency, setCurrency] = useState("CHF"),
    [hidden, setHidden] = useState(false),
    [editor, setEditor] = useState<EditorSpec | null>(null),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [updateReady, setUpdateReady] = useState(false),
    [filter, setFilter] = useState("all"),
    // Id de la dernière opération réglée : bref voile bleu glacier, effacé par onAnimationEnd.
    [justSettledId, setJustSettledId] = useState<string | null>(null),
    // Off by default: rendering every other month's operations unconditionally would let a
    // recurring item's row match by text (".row" + hasText) in more than one month at once,
    // breaking the existing e2e assumption that a label like "Assurance test" resolves to a
    // single row in "Les opérations" — only mounted once the user actually asks to see it.
    [showAllMonths, setShowAllMonths] = useState(false),
    [subsStatus, setSubsStatus] = useState<"all" | "due" | "settled">("all"),
    [subsSort, setSubsSort] = useState<"amount" | "next">("amount"),
    [more, setMore] = useState(false),
    [pendingImport, setPendingImport] = useState<FinanceData | null>(null),
    [busy, setBusy] = useState(false),
    [receiptTxn, setReceiptTxn] = useState(""),
    // Échéance d'une récurrence ouverte dans « Modifier » (ce mois seulement / suivants).
    [occurrenceEdit, setOccurrenceEdit] = useState<{
      recurrenceId: string;
      occurrenceDate: string;
    } | null>(null),
    [sync, setSync] = useState<SyncView>({ state: "off" }),
    [syncConflict, setSyncConflict] = useState<{
      localSavedAt?: string;
      remoteSavedAt?: string;
      localSha: string;
      remoteSha: string;
      changed?: boolean;
    } | null>(null),
    // Le dépôt contient un autre coffre (créé séparément ou autre phrase secrète).
    [syncForeign, setSyncForeign] = useState<{
      remoteSavedAt?: string;
      remoteSha?: string;
      confirming?: boolean;
    } | null>(null),
    [syncBusy, setSyncBusy] = useState(false),
    // La configuration de synchro a été lue au moins une fois (évite un rappel qui clignote).
    [syncChecked, setSyncChecked] = useState(false);
  const session = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const mutating = useRef(false);
  const [preview, setPreview] = useState<{
    url: string;
    name: string;
    pdf: boolean;
  } | null>(null);
  const previewDialog = useRef<HTMLDialogElement>(null);
  const lock = useCallback(() => {
    session.current++;
    openKey.current = null;
    setData(null);
    setKey(null);
    setDemo(false);
    setEditor(null);
    setPendingImport(null);
    setHidden(false);
    setPreview(null);
    setOccurrenceEdit(null);
    setMessage("");
    setError("");
    setSync({ state: "off" });
    setSyncChecked(false);
    setSyncConflict(null);
    setSyncForeign(null);
  }, []);
  useEffect(() => {
    if (!data || demo) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(lock, 5 * 60 * 1000);
    };
    reset();
    window.addEventListener("pointerdown", reset);
    window.addEventListener("keydown", reset);
    const hide = () => {
      if (document.hidden) reset();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("keydown", reset);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [data, demo, lock]);
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(""), 6000);
      return () => clearTimeout(timer);
    }
  }, [message]);
  const vaultOpen = useRef(false);
  useEffect(() => {
    // Locking with an update waiting applies it: the vault is no longer in memory.
    if (vaultOpen.current && data === null && updateReady)
      window.location.reload();
    vaultOpen.current = data !== null;
  }, [data, updateReady]);
  // Anything typed or submitted on the lock screen (an unlock may still be deriving its key,
  // with the fields already cleared) must not be thrown away by a silent reload.
  const lockScreenUsed = useRef(false);
  useEffect(() => {
    if (data) return;
    lockScreenUsed.current = false;
    const used = () => {
      lockScreenUsed.current = true;
    };
    document.addEventListener("input", used, true);
    document.addEventListener("submit", used, true);
    // Un toucher (Face ID en cours, lien, restauration) compte aussi : pas de rechargement silencieux.
    document.addEventListener("click", used, true);
    return () => {
      document.removeEventListener("input", used, true);
      document.removeEventListener("submit", used, true);
      document.removeEventListener("click", used, true);
    };
  }, [data]);
  useEffect(() => {
    const onUpdateReady = () => {
      // Locked and untouched: a reload loses nothing, so apply the new version at once.
      if (!vaultOpen.current && !lockScreenUsed.current) window.location.reload();
      else setUpdateReady(true);
    };
    window.addEventListener(UPDATE_READY_EVENT, onUpdateReady);
    return () => window.removeEventListener(UPDATE_READY_EVENT, onUpdateReady);
  }, []);
  // Synchronisation : une seule exécution à la fois, jamais lancée pendant un enregistrement.
  // Un enregistrement n'attend pas le réseau : le coffre refuse une modification calculée avant
  // un tirage (révision), et un tirage refuse de remplacer une modification locale concurrente.
  // Chrome et Edge proposent l'installation par cet évènement ; Safari n'en a pas (conseil affiché).
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  useEffect(() => {
    const offer = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as InstallPromptEvent);
    };
    const installed = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", offer);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", offer);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  const syncRun = useRef<Promise<void> | null>(null);
  const syncAgain = useRef(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Révision du coffre correspondant aux données affichées (incrémentée par chaque tirage).
  const pullCount = useRef(0);
  // Révision au moment où l'éditeur a été ouvert (ses champs datent de là).
  const editorPulls = useRef(0);
  const conflictPending = useRef(false);
  // Change quand la synchronisation est désactivée : le résultat d'une exécution en cours est ignoré.
  const syncEpoch = useRef(0);
  // Clé du coffre ouvert, remise à null dès le verrouillage (avant le rendu suivant).
  const openKey = useRef<CryptoKey | null>(null);
  type SyncMode =
    | { kind: "auto" | "manual" }
    | {
        kind: "remote" | "local";
        expected?: { localSha?: string; remoteSha: string };
        replaceForeign?: boolean;
      };
  const runSync = useCallback(
    async (mode: SyncMode = { kind: "auto" }): Promise<void> => {
      if (!key || demo || openKey.current !== key) return;
      // Session et clé capturées avant toute attente : un verrouillage entre-temps annule tout.
      const s = session.current;
      const epoch = syncEpoch.current;
      const sessionGone = () => s !== session.current || openKey.current !== key;
      const stale = () => sessionGone() || epoch !== syncEpoch.current;
      const auto = mode.kind === "auto";
      if (syncRun.current) {
        if (auto) {
          syncAgain.current = true;
          return;
        }
        await syncRun.current;
      }
      if (auto && conflictPending.current) return;
      if (mutating.current) {
        if (auto) {
          syncAgain.current = true;
          return;
        }
        // Un choix explicite attend la fin de l'enregistrement en cours au lieu d'être perdu.
        while (mutating.current) await new Promise((r) => setTimeout(r, 100));
      }
      if (stale()) return;
      const job = (async () => {
        const stored = await loadSyncState(key).catch(
          () => ({ state: "reconfigure" }) as const,
        );
        if (stale()) return;
        setSyncChecked(true);
        if (stored.state !== "ready") {
          setSync({ state: stored.state });
          return;
        }
        const cfg = stored.config;
        const repo = `${cfg.owner}/${cfg.repo}`;
        setSync((v) => ({
          state: "syncing",
          repo,
          lastSyncAt: "lastSyncAt" in v ? v.lastSyncAt : undefined,
        }));
        try {
          const r =
            mode.kind === "remote" || mode.kind === "local"
              ? await resolveConflict(key, cfg, mode.kind, {
                  expected: mode.expected,
                  replaceForeign: mode.replaceForeign,
                })
              : await syncNow(key, cfg);
          if (sessionGone()) return;
          // Le coffre a déjà été remplacé : l'afficher même si la synchronisation vient d'être désactivée.
          if (r.status === "pulled") {
            pullCount.current = vaultRevision(key);
            setData(r.data);
            setMessage("Mis à jour avec les modifications de vos autres appareils.");
          }
          if (stale()) return;
          if (r.status === "foreign") {
            conflictPending.current = true;
            setSyncConflict(null);
            setSyncForeign({
              remoteSavedAt: r.remoteSavedAt,
              remoteSha: r.remoteSha,
            });
            setSync({ state: "foreign", repo });
            return;
          }
          if (r.status === "conflict") {
            conflictPending.current = true;
            setSyncForeign(null);
            setSyncConflict({
              localSavedAt: r.localSavedAt,
              remoteSavedAt: r.remoteSavedAt,
              localSha: r.localSha,
              remoteSha: r.remoteSha,
              // Un choix était en cours mais les versions ont encore changé : rien n'a été écrit.
              changed: mode.kind === "remote" || mode.kind === "local",
            });
            setSync({ state: "conflict", repo });
            return;
          }
          conflictPending.current = false;
          setSyncConflict(null);
          setSyncForeign(null);
          setSync({ state: "ok", repo, lastSyncAt: new Date().toISOString() });
        } catch (e) {
          if (stale()) return;
          // Un enregistrement local a eu lieu pendant la synchronisation : rien n'a été remplacé, on relance.
          if (e instanceof VaultChangedError) {
            syncAgain.current = true;
            return;
          }
          setSync(
            e instanceof SyncOfflineError
              ? { state: "offline", repo }
              : {
                  state: "error",
                  repo,
                  detail: e instanceof Error ? e.message : undefined,
                },
          );
        }
      })();
      syncRun.current = job;
      try {
        await job;
      } finally {
        if (syncRun.current === job) syncRun.current = null;
      }
      if (syncAgain.current && !stale()) {
        syncAgain.current = false;
        void runSync();
      }
    },
    [key, demo],
  );
  useEffect(() => {
    if (!key || demo) return;
    void runSync();
    const wake = () => {
      if (!document.hidden) void runSync();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    const poll = setInterval(wake, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      clearInterval(poll);
      clearTimeout(syncTimer.current);
    };
  }, [key, demo, runSync]);
  // Une synchronisation a retiré ou arrêté la récurrence : la fenêtre se ferme au lieu de revenir plus tard.
  useEffect(() => {
    if (!occurrenceEdit || !data) return;
    const stillDue = occurrenceCohort(data, occurrenceEdit.occurrenceDate.slice(0, 7)).some(
      (i) =>
        i.recurrenceId === occurrenceEdit.recurrenceId &&
        i.occurrenceDate === occurrenceEdit.occurrenceDate,
    );
    if (!stillDue) {
      setOccurrenceEdit(null);
      setMessage("Cette échéance a changé sur un autre appareil : rouvrez-la pour la modifier.");
    }
  }, [occurrenceEdit, data]);
  async function manualSync(mode: SyncMode) {
    setSyncBusy(true);
    try {
      await runSync(mode);
    } finally {
      setSyncBusy(false);
    }
  }
  async function enableSync(input: SyncInput) {
    if (!key) throw new Error("Coffre verrouillé.");
    setSyncBusy(true);
    try {
      await configureSync(key, await resolveSyncInput(input));
      syncEpoch.current++;
      conflictPending.current = false;
      await runSync({ kind: "manual" });
    } finally {
      setSyncBusy(false);
    }
  }
  function stopSync() {
    try {
      disableSync();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Désactivation impossible.");
      return;
    }
    syncEpoch.current++;
    conflictPending.current = false;
    setSyncConflict(null);
    setSyncForeign(null);
    setSync({ state: "off" });
    setMessage("Synchronisation désactivée sur cet appareil.");
  }
  useEffect(() => {
    if (preview) previewDialog.current?.showModal();
    return () => {
      if (preview) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);
  // quickSettle's row loses whatever button was focused when it's marked paid/received (the
  // "Payer"/"Reçu"/"Régler" action itself disappears once the row settles), so the browser
  // drops focus to <body> — documented as a known gap until this fix. Re-target the row that
  // just settled by its stable id (transactionRow/subscriptionRow both stamp data-row-id) once
  // the DOM has actually updated, landing on its first real interactive control (the pencil,
  // the receipt icon, or row-main itself once settled rows make that clickable) or the row's
  // own container as a fallback — never leaving focus stranded on <body>. Only steps in if
  // focus really did land on <body>: never steals focus the user has since moved themselves.
  useEffect(() => {
    if (!justSettledId) return;
    const raf = requestAnimationFrame(() => {
      if (document.activeElement !== document.body) return;
      const row = document.querySelector<HTMLElement>(
        `[data-row-id="${CSS.escape(justSettledId)}"]`,
      );
      const target =
        row?.querySelector<HTMLElement>('[role="button"], button, [tabindex="0"]') ?? row;
      target?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [justSettledId]);
  useEffect(() => {
    if (!more) return;
    const onKey = (e: KeyboardEvent) => {
      // Un dialogue ouvert traite son propre Échap : le menu attend le suivant.
      if (e.key !== "Escape" || document.querySelector("dialog[open]")) return;
      setMore(false);
      moreButton.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [more]);
  const renderSession = session.current;
  const renderPulls = pullCount.current;
  function navigate(p: Page) {
    setPage(p);
    setMore(false);
    setFilter("all");
    setSubsStatus("all");
    setSubsSort("amount");
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  async function persist(next: FinanceData) {
    if (session.current !== renderSession)
      throw new Error("Coffre verrouillé.");
    if (mutating.current)
      throw new Error("Un enregistrement est déjà en cours.");
    mutating.current = true;
    const currentSession = session.current;
    try {
      if (pullCount.current !== renderPulls) throw new Error(PULLED_MEANWHILE);
      const valid = validateData(next);
      if (!demo) {
        if (!key) throw new Error("Coffre verrouillé.");
        try {
          await saveVault(key, valid, renderPulls);
        } catch (e) {
          if (e instanceof VaultChangedError) throw new Error(PULLED_MEANWHILE);
          throw e;
        }
      }
      if (currentSession !== session.current)
        throw new Error("Coffre verrouillé.");
      if (!demo) {
        clearTimeout(syncTimer.current);
        syncTimer.current = setTimeout(() => void runSync(), 1500);
      }
      setData(valid);
      setMessage(
        demo
          ? "Modification de la démonstration (non enregistrée)."
          : "Enregistré dans votre coffre.",
      );
      setError("");
    } finally {
      mutating.current = false;
    }
  }
  async function importFile(e: ChangeEvent<HTMLInputElement>) {
    try {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 15_000_000) throw new Error("Import limité à 15 Mo.");
      const raw = await file.text();
      const parsed =
        file.name.toLowerCase().endsWith(".csv") && data
          ? await parseTransactionCsv(raw, data)
          : validateData(JSON.parse(raw));
      if (session.current !== renderSession) return;
      setPendingImport(parsed);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fichier invalide.");
    } finally {
      e.target.value = "";
    }
  }
  async function confirmImport() {
    if (!data || !pendingImport) return;
    setBusy(true);
    try {
      const merged = mergeImport(data, pendingImport);
      await persist(merged);
      setPendingImport(null);
      setMessage("Import enregistré. Consultez les éléments à vérifier.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import impossible.");
    } finally {
      setBusy(false);
    }
  }
  async function attach(
    e: ChangeEvent<HTMLInputElement>,
    transactionId: string | null = receiptTxn || null,
  ) {
    try {
      const file = e.target.files?.[0];
      if (!file || !data) return;
      if (
        !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(
          file.type,
        )
      )
        throw new Error("Choisissez un PDF, JPEG, PNG ou WebP.");
      if (file.size > 2_000_000)
        throw new Error("Limite de 2 Mo par document.");
      const encoded = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () =>
          reject(new Error("Lecture du document impossible."));
        reader.readAsDataURL(file);
      });
      await persist({
        ...data,
        documents: [
          ...data.documents,
          {
            id: crypto.randomUUID(),
            name: file.name,
            mimeType: file.type,
            dataUrl: encoded,
            transactionId,
            addedAt: new Date().toISOString(),
            source: { system: "manual" },
          },
        ],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Document non enregistré.");
    } finally {
      e.target.value = "";
    }
  }
  function openDocument(doc: FinanceData["documents"][number]) {
    if (!doc.dataUrl) return;
    const split = doc.dataUrl.split(",");
    try {
      const binary = atob(split[1]);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      setPreview({
        url: URL.createObjectURL(new Blob([bytes], { type: doc.mimeType })),
        name: doc.name,
        pdf: doc.mimeType === "application/pdf",
      });
    } catch {
      setError("Document illisible.");
    }
  }
  const updateNotice = updateReady && (
    <div className="notice" role="status">
      Une nouvelle version de Finance est disponible.{" "}
      <button className="text-button" onClick={() => window.location.reload()}>
        Recharger
      </button>
    </div>
  );
  if (!data)
    return (
      <>
        {updateNotice && <div className="update-banner">{updateNotice}</div>}
        <Auth
          onOpen={(d, k) => {
            session.current++;
            openKey.current = k;
            pullCount.current = vaultRevision(k);
            setData(d);
            setKey(k);
            setCurrency(d.preferences.baseCurrency);
            setDemo(false);
          }}
          onDemo={() => {
            setData(demoData());
            setDemo(true);
            setCurrency("CHF");
          }}
          installPrompt={installPrompt}
          onInstall={() => {
            void installPrompt?.prompt();
            setInstallPrompt(null);
          }}
        />
      </>
    );
  const wealth = wealthSummary(data, currency),
    // Patrimoine par type de compte (Compte courant, 3e pilier, Léna…), mêmes valeurs que le total.
    wealthTypes = wealthByType(data, currency),
    // Parts des types : sur les actifs positifs, comme la répartition (une dette n'en fausse pas la somme).
    wealthAssetsMinor = wealthTypes.reduce(
      (sum, g) => sum + Math.max(0, g.totalMinor ?? 0),
      0,
    ),
    accountRanking = rankAccounts(data, currency),
    // Largest to smallest comparable value first (docs/AUDIT_UI_V2.md), then accounts
    // without a common rate/date — never given a guessed position among the ranked ones.
    sortedAccounts = [
      ...accountRanking.ranked.map((r) => r.item),
      ...accountRanking.toValue,
    ],
    // Reused by both the section heading and the card grid on Investissements (see below) —
    // one filter, not two, of the already-ranked list.
    investmentAccounts = sortedAccounts.filter((a) => a.kind === "investment"),
    summary = monthSummary(data, month, currency),
    transactions = transactionsForMonth(data, month),
    currentPage = pages.find((p) => p.id === page)!;
  // Share only against a known positive total; a debt's share stays negative, never clamped.
  const accountWealthShare =
    wealth.totalMinor && wealth.totalMinor > 0
      ? new Map(
          accountRanking.ranked.map((r) => [
            r.item.id,
            (r.valueMinor / (wealth.totalMinor as number)) * 100,
          ]),
        )
      : null;
  // Explicit user request: reçus (revenus) d'abord, puis factures, puis abonnements, virements
  // et le reste en dernier — puis, à l'intérieur de chaque groupe, le plus gros montant
  // d'abord. Reads the linked recurrence's own recurrenceType when there is one (a recurring
  // bill keeps its "facture" classification even once it has its own persisted transaction),
  // falling back to "facture" for any other one-off expense.
  const operationTypeRank = (t: Transaction): number => {
    if (t.kind === "income") return 0;
    if (t.kind === "transfer") return 3;
    const recurrenceType = t.recurrenceId
      ? data.recurrences.find((r) => r.id === t.recurrenceId)?.recurrenceType
      : undefined;
    return recurrenceType === "subscription" ? 2 : 1;
  };
  // Unpaid/unknown first, settled last — what still needs action reads before what's already
  // handled. Within each of those two status groups, ordered by operationTypeRank then by
  // amount, largest first (explicit user request) instead of the plain date order this used
  // to keep as a stable secondary sort.
  const sortOperations = (list: Transaction[]) =>
    [...list].sort((a, b) => {
      const settledDiff = Number(a.status === "settled") - Number(b.status === "settled");
      if (settledDiff !== 0) return settledDiff;
      const typeDiff = operationTypeRank(a) - operationTypeRank(b);
      if (typeDiff !== 0) return typeDiff;
      return b.amountMinor - a.amountMinor;
    });
  // "Voir les autres mois" (Mon mois, opt-in) — every other month with a real recorded
  // transaction, most recent first. Bounded by data.transactions that already exist, never
  // guessed from a recurrence's own indefinite start/end span (which could stretch years in
  // either direction) — a genuine history, not an invented range.
  const otherMonthsWithData = [
    ...new Set(
      data.transactions.flatMap((t) => {
        const m = transactionMonth(t);
        return m && m !== month ? [m] : [];
      }),
    ),
  ]
    .sort()
    .reverse();
  const display = (value: number | null, unit = currency) =>
    hidden ? "••••••" : money(value, unit);
  const unknownAccounts = data.accounts.filter((a) => !latestBalance(a)).length;
  const staleAccounts = data.accounts.filter((a) => {
    const b = latestBalance(a);
    return b?.asOf && Date.parse(today()) - Date.parse(b.asOf) > 31 * 86400000;
  }).length;
  const attention = data.reviewItems.length + unknownAccounts + staleAccounts;
  const accountName = (id: string | null) =>
    data.accounts.find((a) => a.id === id)?.name || "Compte à préciser";
  const edit = (spec: EditorSpec) => {
    setError("");
    editorPulls.current = pullCount.current;
    setEditor(spec);
  };
  const isDueOccurrence = (recurrenceId: string, occurrenceDate: string) =>
    !!data &&
    occurrenceCohort(data, occurrenceDate.slice(0, 7)).some(
      (i) => i.recurrenceId === recurrenceId && i.occurrenceDate === occurrenceDate,
    );
  const openOccurrence = (recurrenceId: string, occurrenceDate: string) => {
    setError("");
    editorPulls.current = pullCount.current;
    setOccurrenceEdit({ recurrenceId, occurrenceDate });
  };
  // Opération déjà enregistrée pour cette échéance : montant ajusté, règlement ou remise à payer.
  const linkedOccurrence = (recurrenceId: string, occurrenceDate: string) =>
    data ? findOccurrenceTransaction(data.transactions, recurrenceId, occurrenceDate) : undefined;
  async function saveOccurrence(scope: OccurrenceScope, amountMinor: number) {
    if (!data || !occurrenceEdit) return;
    if (pullCount.current !== editorPulls.current) throw new Error(EDITED_ELSEWHERE);
    const { recurrenceId, occurrenceDate } = occurrenceEdit;
    const recurrence = data.recurrences.find((r) => r.id === recurrenceId);
    if (!recurrence) throw new Error("Récurrence introuvable.");
    const linked = findOccurrenceTransaction(data.transactions, recurrenceId, occurrenceDate);
    if (scope === "following" && linked && linked.currency !== recurrence.currency)
      throw new Error(
        "Cette échéance est dans une autre devise que la facture : choisissez « Ce mois seulement », ou changez la devise avec « Modifier le nom, le compte… ».",
      );
    let next: FinanceData = data;
    if (scope === "following") {
      // Ce mois compris : la date d'effet part du 1er du mois, jamais avant le début de la règle.
      const monthStart = `${occurrenceDate.slice(0, 7)}-01`;
      const from = monthStart < recurrence.startDate ? recurrence.startDate : monthStart;
      const changed = withRecurrenceAmount(recurrence, amountMinor, from);
      if (changed !== recurrence)
        next = {
          ...next,
          recurrences: next.recurrences.map((r) =>
            r.id === recurrenceId ? { ...changed, source: manualSource(changed.source) } : r,
          ),
        };
    }
    // « Ce mois » : toujours. « Suivants » : un ajustement encore à payer suit le nouveau montant,
    // un règlement déjà enregistré garde le sien.
    if (scope === "month" || (linked && linked.status !== "settled")) {
      const adjusted = withOccurrenceAmount(next, recurrenceId, occurrenceDate, amountMinor);
      if (adjusted !== next) {
        const record = findOccurrenceTransaction(
          adjusted.transactions,
          recurrenceId,
          occurrenceDate,
        );
        next = record
          ? {
              ...adjusted,
              transactions: adjusted.transactions.map((t) =>
                t.id === record.id ? { ...t, source: manualSource(t.source) } : t,
              ),
            }
          : adjusted;
      }
    }
    if (next === data) {
      setMessage("Aucun changement : c’est déjà ce montant.");
      return;
    }
    await persist(next);
  }
  // Distinct metaphor per nature (identite-ui.md), reusing existing icons where one already
  // fits rather than inventing a lookalike: "refresh" for the repeating abonnement itself,
  // "bank" for a fixed charge, "arrow-down" matching the same icon used for income elsewhere,
  // "alert" matching its existing "à vérifier" meaning. Only "saving" needed a new icon
  // ("vault"): reusing "target" (goals/projects) would collide with an unrelated concept.
  const recurrenceTypeIcons: Record<Recurrence["recurrenceType"], IconName> = {
    subscription: "refresh",
    bill: "bank",
    income: "arrow-down",
    saving: "vault",
    other: "alert",
  };
  // The cohort is keyed by recurrenceId: `occurrenceCohort` only ever produces at most one
  // entry per active recurrence for a given month (see finance.ts), so this lookup is safe.
  const subsCohortItems = occurrenceCohort(data, month);
  const subsCohortByRecurrence = new Map(
    subsCohortItems.map((i) => [i.recurrenceId, i]),
  );
  const subsCohort = cohortSummary(data, month, currency);
  // Null when a side is unknown or nothing is due: a 0/0 bar would falsely read "fully settled".
  const subsSettledPct =
    subsCohort.dueMinor !== null &&
    subsCohort.settledMinor !== null &&
    subsCohort.dueMinor > 0
      ? Math.min(100, (subsCohort.settledMinor / subsCohort.dueMinor) * 100)
      : null;
  const subsFlow = recurringFlowSummary(data, month, currency);
  const subsMatchesType = (r: Recurrence) =>
    filter === "all" || r.recurrenceType === filter;
  const subsMatchesStatus = (r: Recurrence) => {
    if (subsStatus === "all") return true;
    const item = subsCohortByRecurrence.get(r.id);
    return subsStatus === "settled" ? !!item?.settled : !!item && !item.settled;
  };
  // Ce qui s'est terminé avant le mois affiché n'y figure plus (visible dans ses propres mois).
  const subsActive = data.recurrences.filter(
    (r) =>
      r.active &&
      !(r.endDate && r.endDate < `${month}-01`) &&
      subsMatchesType(r) &&
      subsMatchesStatus(r),
  );
  const subsInactive = data.recurrences
    .filter((r) => !r.active && subsMatchesType(r))
    .sort((a, b) => a.label.localeCompare(b.label));
  // "Montant mensuel" compares recurrences that can carry different currencies, so the raw
  // per-currency equivalent from monthlyEquivalentMinor is not comparable on its own — it must
  // be converted to the display currency first, exactly like rankAccounts/accountValue already
  // do for accounts. A missing rate goes to the unranked tail instead of comparing incomparable
  // numbers or silently dropping the item.
  const subsAmountRanking =
    subsSort === "amount"
      ? rankByValue(
          subsActive,
          (r) => {
            const at = today();
            const convertedMinor = convertMinor(
              monthlyEquivalentMinor(r, at),
              r.currency,
              currency,
              data.fxRates,
              at,
            );
            return {
              valueMinor: convertedMinor,
              valuationDate: convertedMinor === null ? null : at,
            };
          },
          (r) => r.id,
        )
      : null;
  const subsSortedActive =
    subsAmountRanking !== null
      ? [
          ...subsAmountRanking.ranked.map((v) => v.item),
          ...subsAmountRanking.toValue,
        ]
      : [...subsActive].sort((a, b) => {
          const da = nextOccurrenceDate(a),
            db = nextOccurrenceDate(b);
          if (da === db) return a.id.localeCompare(b.id);
          if (da === null) return 1;
          if (db === null) return -1;
          return da.localeCompare(db);
        });
  // Page Factures : charges fixes (nature « bill ») et revenus fixes du mois choisi, sans date.
  const billsCohort = cohortSummary(data, month, currency, ["bill"]);
  const billsSettledPct =
    billsCohort.dueMinor !== null &&
    billsCohort.settledMinor !== null &&
    billsCohort.dueMinor > 0
      ? Math.min(100, (billsCohort.settledMinor / billsCohort.dueMinor) * 100)
      : null;
  // Sans date à l'écran : ce qui reste à payer d'abord, puis par devise et montant décroissant
  // (aucune conversion implicite, ordre total et stable), puis par libellé.
  const byAmount = (a: Recurrence, b: Recurrence) => {
    const ia = subsCohortByRecurrence.get(a.id)!,
      ib = subsCohortByRecurrence.get(b.id)!;
    return (
      Number(!!ia.settled) - Number(!!ib.settled) ||
      ia.currency.localeCompare(ib.currency) ||
      ib.dueAmountMinor - ia.dueAmountMinor ||
      a.label.localeCompare(b.label)
    );
  };
  // Une facture ou un revenu sans échéance ce mois-ci (un seul autre mois, début plus tard,
  // tous les 3 mois…) n'est pas affiché comme dû : il est rangé à part, replié. Ce qui s'est
  // terminé avant ce mois-ci n'y figure plus (visible dans son propre mois).
  const monthStart = `${month}-01`;
  const splitByMonth = (type: "bill" | "income") => {
    const active = data.recurrences.filter(
      (r) => r.active && r.recurrenceType === type,
    );
    return {
      due: active.filter((r) => subsCohortByRecurrence.has(r.id)).sort(byAmount),
      elsewhere: active
        .filter(
          (r) =>
            !subsCohortByRecurrence.has(r.id) &&
            !(r.endDate && r.endDate < monthStart),
        )
        .sort((a, b) => a.label.localeCompare(b.label)),
      stopped: data.recurrences
        .filter((r) => !r.active && r.recurrenceType === type)
        .sort((a, b) => a.label.localeCompare(b.label)),
    };
  };
  const bills = splitByMonth("bill");
  const billsActive = bills.due,
    billsElsewhere = bills.elsewhere,
    billsInactive = bills.stopped;
  // Revenus fixes sur la même page : attendu, reçu et reste à recevoir du mois choisi.
  const incomeCohort = cohortSummary(data, month, currency, ["income"]);
  const incomeReceivedPct =
    incomeCohort.dueMinor !== null &&
    incomeCohort.settledMinor !== null &&
    incomeCohort.dueMinor > 0
      ? Math.min(100, (incomeCohort.settledMinor / incomeCohort.dueMinor) * 100)
      : null;
  const incomes = splitByMonth("income");
  // « Il me reste » : revenus du mois moins dépenses du mois (Mon mois), ou revenus fixes moins
  // factures (Factures). Rien de saisi, ou un montant inconnu : « — », jamais un zéro inventé.
  const sumKnown = (values: (number | null)[]) =>
    values.every((v) => v === null) ? null : values.reduce<number>((a, v) => a + (v ?? 0), 0);
  const monthIncome = sumKnown([summary.incomeSettled, summary.incomePlanned]),
    monthExpense = sumKnown([summary.expenseSettled, summary.expensePlanned]);
  // Sans revenu saisi, pas de « reste » négatif inventé : « — » et une invite à l'ajouter.
  const monthLeft =
    summary.unknownCount > 0 || monthIncome === null
      ? null
      : monthIncome - (monthExpense ?? 0);
  // Mises de côté du mois (3e pilier, épargne) : hors du « reste », mais montrées à côté.
  const savingCohort = cohortSummary(data, month, currency, ["saving"]);
  // Un seul « Il me reste », identique sur l'Accueil, Mon mois et Factures : le chiffre, puis
  // ce qui le compose (revenus, dépenses payées et prévues) et la part des revenus déjà engagée.
  const spentPct =
    monthIncome !== null && monthIncome > 0 && monthExpense !== null
      ? Math.min(100, (monthExpense / monthIncome) * 100)
      : null;
  const leftCard = (
    <div className="stat-card left-card">
      <p className="metric-label">Il me reste en {monthLabel(month)}</p>
      <div
        className={`metric-value ${monthLeft === null ? "" : monthLeft < 0 ? "negative" : "positive"}`}
      >
        {display(monthLeft)}
      </div>
      {monthLeft === null ? (
        <p className="meta">
          {summary.unknownCount > 0
            ? "À compléter : une opération sans date, sans taux de change ou à vérifier."
            : `Ajoutez votre salaire ou vos revenus de ${monthLabel(month)} pour voir ce qu’il reste.`}
        </p>
      ) : (
        <>
          {!hidden && spentPct !== null && (
            <div className="progress" aria-hidden="true">
              <div
                className="progress-fill left-spent"
                style={{ width: `${spentPct}%` }}
              />
            </div>
          )}
          <dl className="left-breakdown">
            <div>
              <dt>Revenus</dt>
              <dd className="positive">{display(monthIncome)}</dd>
            </div>
            <div>
              <dt>Dépenses payées et prévues</dt>
              <dd className="negative">{display(monthExpense ?? 0)}</dd>
            </div>
            {savingCohort.dueMinor !== null && savingCohort.dueMinor > 0 && (
              <div>
                <dt>Mises de côté, à part</dt>
                <dd>{display(savingCohort.dueMinor)}</dd>
              </div>
            )}
          </dl>
        </>
      )}
    </div>
  );
  const incomeActive = incomes.due,
    incomeElsewhere = incomes.elsewhere,
    incomeInactive = incomes.stopped;
  // Prefills "Marquer payé/reçu" from a not-yet-persisted occurrence, mirroring
  // `transactionsForMonth`'s own virtual-transaction shape and id (`recurrenceId:date`) so a
  // settlement made here and one made from Mon mois never create two different transactions
  // for the same occurrence.
  function subsVirtualTransaction(r: Recurrence, dueDate: string, amountMinor: number): Transaction {
    return projectedOccurrence(r, dueDate, amountMinor);
  }
  // Solde affiché (daté, sinon dernier saisi) et sa date, communs à la carte et à la ligne.
  function accountBalance(a: Account) {
    const b = latestBalance(a),
      show = b || a.balances.at(-1);
    return { show, asOf: b?.asOf || null };
  }
  // Le nom du compte est primaire ; l'établissement et la nature restent secondaires.
  // Sous l'en-tête de son type, la carte n'a pas besoin de répéter le type.
  function accountCard(a: Account, showType = true) {
    const { show, asOf } = accountBalance(a);
    const note = asOf
      ? `Solde au ${asOf}`
      : show
        ? "Non daté · à vérifier"
        : "Solde à renseigner";
    // Un point par date connue et déjà passée, le dernier saisi l'emportant comme dans latestBalance.
    const trendByDate = new Map<string, number>();
    for (const bal of a.balances)
      if (bal.amountMinor !== null && isDate(bal.asOf) && bal.asOf <= today())
        trendByDate.set(bal.asOf, bal.amountMinor);
    const trendPoints = [...trendByDate]
      .sort(([x], [y]) => x.localeCompare(y))
      .map(([asOf, amountMinor]) => ({ asOf, amountMinor }));
    const trend =
      !hidden && trendPoints.length >= SPARKLINE_MIN_POINTS ? (
        <Sparkline id={a.id} points={trendPoints} />
      ) : null;
    const share = accountWealthShare?.get(a.id);
    return (
      <article className="account-card" key={a.id}>
        <div className="account-head">
          <span className="institution-icon">
            <Icon name={accountTypeIcon(accountTypeOf(a))} size={20} />
          </span>
          <div className="account-id">
            <h3>{a.name}</h3>
            <p className="account-sub">
              <span className="institution">{a.institution}</span>
              {showType && (
                <span className="kind-badge">{accountTypeOf(a)}</span>
              )}
            </p>
          </div>
          <button
            className="icon-button"
            onClick={() => edit({ type: "account", id: a.id })}
            aria-label={`Modifier ${a.name}`}
          >
            <Icon name="edit" size={18} />
          </button>
        </div>
        <div className={trend ? "balance balance-line" : "balance"}>
          <span className="balance-amount">
            {display(show?.amountMinor ?? null, a.currency)}
          </span>
          {trend}
        </div>
        {/* Une seule ligne secondaire ; le CSS repère encore .account-share par :has(). */}
        <p className="meta">
          {share !== undefined && !hidden && (
            <>
              <span className="account-share nowrap">
                {share >= 0 ? "" : "−"}
                {Math.abs(share).toFixed(1)} % du patrimoine
              </span>
              {SEP}
            </>
          )}
          <span className="nowrap">{note}</span>
        </p>
        {/* Actualiser is the one action worth keeping always visible on this card
            (identite-ui.md: "Ajouter un compte, actualiser un solde" is a priority action
            for Mes comptes) — the account's provenance (SourceLink, below) is exactly the
            kind of thing that reference asks to move into the details volet instead:
            "Déplacer source, historique, méthode de valorisation et aide longue dans un
            volet de détails." It used to sit here too, next to Actualiser, reading as an
            orphaned line of text with nothing else around it (confirmed on a real
            rendered card, not just in code). */}
        <div className="hero-foot account-card-foot">
          <button
            className="button small secondary"
            onClick={() => edit({ type: "balance", id: a.id })}
          >
            <Icon name="refresh" size={18} />
            Actualiser
          </button>
        </div>
        <details className="account-history">
          <summary>Historique et valorisation</summary>
          <p className="footer-note">
            {a.valuationMode === "total"
              ? "Solde total : les positions de ce compte ne sont pas ajoutées."
              : "Solde de liquidités : les positions datées sont ajoutées."}
          </p>
          {a.balances.map((v) => (
            <p className="meta" key={v.id}>
              {v.asOf || "Date inconnue"} · {display(v.amountMinor, a.currency)}
            </p>
          ))}
          <p className="account-history-source">
            <SourceLink source={show?.source || a.source} />
          </p>
        </details>
      </article>
    );
  }
  /** "Prévu" never distinguished a due expense from a due income, and gave no explicit
   * word for the not-yet state — see docs/AUDIT_UI_V2.md. */
  // Entrée en vert, sortie en rouge, virement ou épargne en bleu glacier.
  function kindTone(kind: Transaction["kind"]): string {
    return kind === "income"
      ? "positive"
      : kind === "transfer"
        ? "transfer"
        : "negative";
  }
  function recurrenceTone(r: Recurrence): string {
    return r.recurrenceType === "saving"
      ? "transfer"
      : r.kind === "income"
        ? "positive"
        : "negative";
  }
  function statusWord(t: Transaction): string {
    if (t.status === "unknown") return "À vérifier";
    if (t.status === "settled")
      return t.kind === "income" ? "Reçu" : t.kind === "transfer" ? "Réglé" : "Payé";
    return t.kind === "income"
      ? "Pas encore reçu"
      : t.kind === "transfer"
        ? "Prévu"
        : "Pas encore payé";
  }
  // Writes settled/today directly instead of opening the editor first — explicit user
  // request to make "Marquer payé" a single instant action, Notion-style ("je mets payé,
  // il est payé"), superseding the earlier design that opened the editor so the settlement
  // date stayed visible/editable before saving. `t` may be a not-yet-persisted virtual
  // occurrence (no entry in data.transactions yet, e.g. a due recurrence not yet marked) —
  // handled the same way `submit()` in Editor.tsx already does: add if new, replace if not.
  async function quickSettle(t: Transaction) {
    if (!data) return;
    try {
      // Same "Modification manuelle" stamp Editor.tsx's submit() always applies — quickSettle
      // bypasses that dialog, but marking paid is still a manual modification and must keep
      // an imported record's trace (docs/STATUS.md: "Une information importée puis modifiée
      // garde une indication de modification manuelle"), same as revertToPlanned already does.
      const next: Transaction = {
        ...t,
        status: "settled",
        date: today(),
        source: {
          ...t.source,
          updatedAt: new Date().toISOString(),
          note: [t.source.note, "Modification manuelle le " + new Date().toISOString()]
            .filter(Boolean)
            .join(" · "),
        },
      };
      // Une échéance projetée dont l'identifiant est déjà pris par l'opération d'une autre
      // échéance reçoit un identifiant neuf : jamais écraser l'enregistrement d'un autre mois.
      const holder = data.transactions.find((v) => v.id === t.id);
      const clash =
        !!holder &&
        !!t.recurrenceId &&
        (holder.recurrenceId ?? null) !== null &&
        (holder.recurrenceId !== t.recurrenceId || holder.occurrenceDate !== t.occurrenceDate);
      const settled = clash ? { ...next, id: crypto.randomUUID() } : next;
      await persist({
        ...data,
        transactions:
          holder && !clash
            ? data.transactions.map((v) => (v.id === t.id ? settled : v))
            : [...data.transactions, settled],
      });
      setJustSettledId(settled.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    }
  }
  // Limited to recurrence-linked occurrences: occurrenceDate is then a reliable due date
  // to fall back to (see field comment on EditorSpec.transaction). A plain one-off
  // transaction can still be corrected by hand through the pencil/edit action, which
  // already exposes État as a free choice.
  async function revertToPlanned(t: Transaction) {
    if (!data) return;
    const verb =
      t.kind === "income" ? "recevoir" : t.kind === "transfer" ? "régler" : "payer";
    if (
      !window.confirm(
        `Remettre « ${t.label} » à ${verb} ? Le règlement du ${t.date ?? "date inconnue"} reste conservé dans l’historique, pas effacé.`,
      )
    )
      return;
    try {
      const next: Transaction = {
        ...t,
        status: "planned",
        date: t.occurrenceDate ?? t.date,
        source: {
          ...t.source,
          updatedAt: new Date().toISOString(),
          note: [
            t.source.note,
            `Remis à prévu le ${new Date().toISOString()} (réglé précédemment le ${t.date ?? "date inconnue"}).`,
          ]
            .filter(Boolean)
            .join(" · "),
        },
      };
      await persist({
        ...data,
        transactions: [...data.transactions.filter((v) => v.id !== t.id), next],
      });
      setMessage(
        "Remis à prévu. L’ancienne date de règlement reste dans l’historique.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Correction non enregistrée.");
    }
  }
  function transactionRow(t: Transaction) {
    return (
      <div
        className={`row${justSettledId === t.id ? " row-flash-positive" : ""}`}
        key={t.id}
        data-row-id={t.id}
        tabIndex={-1}
        onAnimationEnd={() => {
          if (justSettledId === t.id) setJustSettledId(null);
        }}
      >
        <span
          className={`row-icon ${kindTone(t.kind)}`}
        >
          <Icon
            name={
              t.kind === "income"
                ? "arrow-down"
                : t.kind === "transfer"
                  ? "transfer"
                  : "arrow-up"
            }
          />
        </span>
        {(() => {
          const persisted = data?.transactions.some((i) => i.id === t.id);
          // Settled rows drop the plain edit (pencil) icon-button the user found cluttering
          // once every row (they had asked to see unpaid rows first, which made rows of small
          // persistent icons on every already-handled line more visible than before) — a paid
          // row now reads as just its own text, amount and receipt icon. "Modifier" moves onto
          // row-main itself instead of disappearing outright: the label/detail block becomes a
          // real, keyboard-reachable button (role="button", not a bare onClick on a div) that
          // opens the same editor the pencil icon used to. The document-attach icon stays on
          // settled rows too — attaching a receipt right after marking something paid/received
          // is the deliberate flow this app supports (see "daily entries" e2e test), not
          // something to hide behind a page navigation.
          const clickableEdit = t.status === "settled" && persisted;
          return (
            <div
              className={`row-main${clickableEdit ? " row-main-button" : ""}`}
              {...(clickableEdit
                ? {
                    role: "button" as const,
                    tabIndex: 0,
                    "aria-label": `Modifier ${t.label}`,
                    onClick: () =>
                      edit({ type: "transaction", id: t.id, kind: t.kind }),
                    onKeyDown: (e: ReactKeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        edit({ type: "transaction", id: t.id, kind: t.kind });
                      }
                    },
                  }
                : {})}
            >
              <span className="row-title">{t.label}</span>
              <span className="row-detail">
                {/* Facture, abonnement, revenu fixe ou mise de côté : il compte pour son mois, sans
                    date à l'écran (le jour interne n'est pas une échéance ; la date d'un paiement
                    reste enregistrée). */}
                {t.recurrenceId &&
                data?.recurrences.some((r) => r.id === t.recurrenceId) ? null : (
                  <>
                    {t.date ? (
                      <span className="nowrap">{t.date}</span>
                    ) : t.budgetMonth ? (
                      <>
                        <span className="nowrap">{monthLabel(t.budgetMonth)}</span>
                        {`${SEP}jour à vérifier`}
                      </>
                    ) : (
                      "Date à vérifier"
                    )}
                    {SEP}
                  </>
                )}
                {accountName(t.accountId)}
                {SEP}
                <span
                  className={`nowrap ${t.status === "settled" ? kindTone(t.kind) : "status-pending"}`}
                >
                  {statusWord(t)}
                </span>
                {data?.documents.some((d) => d.transactionId === t.id) &&
                  `${SEP}Justificatif joint`}
              </span>
            </div>
          );
        })()}
        <div className="row-end">
          <span
            className={`row-value ${kindTone(t.kind)}`}
          >
            {t.kind === "income" ? "+" : ""}
            {display(t.amountMinor, t.currency)}
          </span>
          <div className="row-actions">
            {
              // Kept exclusive with the "marquer" action below so a planned row never
              // crowds two actions (the label wraps on an iPhone width). A receipt is
              // also most often at hand once the operation is settled; a planned
              // operation can still be reached from Documents et réglages.
              t.status !== "planned" &&
                data?.transactions.some((i) => i.id === t.id) && (
                  <label
                    className="icon-button"
                    aria-label={`Joindre un document à ${t.label}`}
                  >
                    <Icon name="document" size={18} />
                    <input
                      className="sr-only"
                      type="file"
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      onChange={(e) => attach(e, t.id)}
                    />
                  </label>
                )
            }
            {
              // Rendered before the quick-settle button below (not after, as it used to
              // be) so that button's right edge is always flush against the row's edge —
              // real defect found in review: a persisted planned row (with this pencil) and
              // a virtual/projected one (without it, no record to edit yet) sat side by
              // side with "Payer" starting at two different x positions, since the icon
              // used to trail the button instead of leading it.
              t.status === "planned" &&
              t.recurrenceId &&
              t.occurrenceDate &&
              isDueOccurrence(t.recurrenceId, t.occurrenceDate) ? (
                // Échéance d'une récurrence (enregistrée ou non) : montant de ce mois ou des suivants.
                // Une échéance qui n'est plus due (règle arrêtée, jour changé) garde l'éditeur rapide.
                <button
                  className="icon-button"
                  aria-label={`Modifier ${t.label}`}
                  onClick={() => openOccurrence(t.recurrenceId!, t.occurrenceDate!)}
                >
                  <Icon name="edit" size={18} />
                </button>
              ) : (
                t.status === "planned" &&
                data?.transactions.some((i) => i.id === t.id) && (
                  <button
                    className="icon-button"
                    aria-label={`Modifier ${t.label}`}
                    onClick={() =>
                      edit({ type: "transaction", id: t.id, kind: t.kind, quick: true })
                    }
                  >
                    <Icon name="edit" size={18} />
                  </button>
                )
              )
            }
            {t.status === "settled" && t.recurrenceId && t.occurrenceDate && (
              <button
                className="icon-button"
                title="Corriger : remettre à prévu"
                aria-label={`${
                  t.kind === "income"
                    ? "Remettre à recevoir"
                    : t.kind === "transfer"
                      ? "Remettre à régler"
                      : "Remettre à payer"
                } ${t.label}`}
                onClick={() => revertToPlanned(t)}
              >
                <Icon name="refresh" size={18} />
              </button>
            )}
            {t.status === "planned" ? (
              <button
                className={`button small ${t.kind === "income" ? "receive" : t.kind === "transfer" ? "transfer" : "pay"}`}
                onClick={() => quickSettle(t)}
              >
                <Icon name="check" size={18} />
                {t.kind === "income" ? "Reçu" : t.kind === "transfer" ? "Régler" : "Payer"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
  function subscriptionRow(
    r: Recurrence,
    variant: "subscriptions" | "bills" = "subscriptions",
  ) {
    const cohortItem = subsCohortByRecurrence.get(r.id);
    const settledTxn = cohortItem?.settled
      ? data?.transactions.find((t) => t.id === cohortItem.settled!.transactionId)
      : undefined;
    // Une opération déjà enregistrée pour l'échéance (montant ajusté ce mois-ci, remise à payer)
    // est réglée elle-même : jamais une seconde opération pour la même échéance.
    const linkedDue =
      cohortItem && !cohortItem.settled
        ? linkedOccurrence(r.id, cohortItem.occurrenceDate)
        : undefined;
    const dueTxn =
      cohortItem && !cohortItem.settled
        ? (linkedDue ??
          subsVirtualTransaction(r, cohortItem.occurrenceDate, cohortItem.dueAmountMinor))
        : null;
    const bills = variant === "bills";
    // Long card — name, amount, month, "c'est tout" (explicit user request): cadence, day,
    // account and the "≈/mois" equivalent used to crowd this row with detail the user found
    // excessive once they'd seen it in daily use; dropped here, still available from the
    // pencil's full recurrence editor for whoever needs them. The amount shown always matches
    // the month named next to it: real defect found in review — this used to fall back to
    // nextOccurrenceDate's amount (a *different*, later month's due amount) whenever the
    // selected month had no cohort, right next to text reading "{mois} · Aucune échéance" —
    // an unrelated number sitting beside a month it has nothing to do with. No amount at all
    // is the honest state here, matching the "Aucune échéance" text next to it.
    const amountMinor = cohortItem ? cohortItem.dueAmountMinor : null;
    const amountCurrency = cohortItem ? cohortItem.currency : r.currency;
    // quickSettle is called with dueTxn (a virtual "r.id:dueDate" id — it isn't in
    // data.transactions yet) and stamps that same id onto the real transaction it writes.
    // Once persisted, cohortItem.settled picks that transaction back up by
    // recurrenceId+occurrenceDate, so settledTxn.id equals the id quickSettle actually used —
    // the same identity flash key across both the pre-settle and post-settle render, where
    // dueTxn itself has already gone back to null. Falling back to r.id alone (as if this were
    // still unsettled) would never match and the flash would never render.
    const flashKey = settledTxn?.id ?? dueTxn?.id ?? r.id;
    return (
      <div
        className={`row item-card${justSettledId === flashKey ? " row-flash-positive" : ""}`}
        key={r.id}
        data-row-id={flashKey}
        tabIndex={-1}
        onAnimationEnd={() => {
          if (justSettledId === flashKey) setJustSettledId(null);
        }}
      >
        <span
          className={`row-icon ${recurrenceTone(r)}`}
        >
          <Icon name={recurrenceTypeIcons[r.recurrenceType]} />
        </span>
        <div className="row-main">
          <span className="row-title">{r.label}</span>
          <span className="row-detail">
            {!r.active ? (
              r.endDate ? (
                <>
                  Terminé en{" "}
                  <span className="nowrap">{monthLabel(r.endDate.slice(0, 7))}</span>
                </>
              ) : (
                "En pause"
              )
            ) : (
              <>
                <span className="nowrap">
                  {bills ? rhythmLabel(r, month) : monthLabel(month)}
                </span>
                {/* Factures : pas d'échéance ce mois-ci = rangée à part, sans statut ni montant. */}
                {!(bills && !cohortItem) && SEP}
                <span
                  className={`nowrap ${!cohortItem ? "" : cohortItem.settled ? recurrenceTone(r) : "status-pending"}`}
                >
                  {!cohortItem
                    ? bills
                      ? ""
                      : "Aucune échéance"
                    : cohortItem.settled
                      ? r.kind === "income"
                        ? "Reçu"
                        : "Payé"
                      : r.kind === "income"
                        ? "Pas encore reçu"
                        : "Pas encore payé"}
                </span>
                {bills && cohortItem?.adjusted && (
                  <>
                    {SEP}
                    <span>
                      {cohortItem.settled ? "" : "montant modifié ce mois, "}
                      habituel {display(cohortItem.projectedAmountMinor, r.currency)}
                    </span>
                  </>
                )}
              </>
            )}
          </span>
        </div>
        <div className="row-end">
          <div className={`row-value ${recurrenceTone(r)}`}>
            {amountMinor !== null ? (
              <>
                {r.kind === "income" ? "+" : ""}
                {display(amountMinor, amountCurrency)}
              </>
            ) : bills ? null : (
              <span className="row-detail">Aucune échéance</span>
            )}
          </div>
          <div className="row-actions">
            {/* Comme dans Mon mois : l'action principale reste au bord droit. */}
            <button
              className="icon-button"
              aria-label={`Modifier ${r.label}`}
              onClick={() =>
                bills && cohortItem
                  ? openOccurrence(r.id, cohortItem.occurrenceDate)
                  : edit({ type: "recurrence", id: r.id })
              }
            >
              <Icon name="edit" size={18} />
            </button>
            {dueTxn && (
              <button
                className={`button small ${r.kind === "income" ? "receive" : r.recurrenceType === "saving" ? "transfer" : "pay"}`}
                onClick={() => quickSettle(dueTxn)}
              >
                <Icon name="check" size={18} />
                {r.kind === "income" ? "Reçu" : "Payer"}
              </button>
            )}
            {settledTxn && (
              <button
                className="icon-button"
                title="Corriger : remettre à prévu"
                aria-label={`${
                  r.kind === "income" ? "Remettre à recevoir" : "Remettre à payer"
                } ${r.label}`}
                onClick={() => revertToPlanned(settledTxn)}
              >
                <Icon name="refresh" size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
  const goals = data.goals.map((g) => {
    const progress =
      g.targetMinor && g.reservedMinor !== null
        ? Math.min(100, (g.reservedMinor / g.targetMinor) * 100)
        : null;
    return (
      <article className="card goal-card" key={g.id}>
        <div className="card-header">
          <div className="card-heading">
            <span className="card-icon">
              <Icon name="target" size={18} />
            </span>
            <h3 className="card-title">{g.name}</h3>
          </div>
          <button
            className="icon-button"
            onClick={() => edit({ type: "goal", id: g.id })}
            aria-label={`Modifier ${g.name}`}
          >
            <Icon name="edit" size={18} />
          </button>
        </div>
        <div className="balance">{display(g.reservedMinor, g.currency)}</div>
        <p className="meta">
          sur {display(g.targetMinor, g.currency)}
          {g.dueDate && (
            <>
              {SEP}échéance <span className="nowrap">{g.dueDate}</span>
            </>
          )}
        </p>
        {!hidden && (
          <div className="progress">
            <div
              className="progress-fill"
              style={{ width: `${progress || 0}%` }}
            />
          </div>
        )}
        <div className="hero-foot">
          <span className="meta">
            {g.asOf ? `Réserve au ${g.asOf}` : "Réserve non datée"}
          </span>
          <span>
            {hidden
              ? "•••"
              : progress !== null
                ? `${Math.round(progress)} %`
                : "À préciser"}
          </span>
        </div>
        <p className="footer-note">
          {accountName(g.accountId)}
          {SEP}inclus dans ce compte
        </p>
        <SourceLink source={g.source} />
      </article>
    );
  });
  return (
    <div className="shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate("overview")}>
          <img className="brand-mark" src="./favicon.svg" alt="" />
          Finance
        </button>
        <p className="eyebrow nav-eyebrow">MON ESPACE</p>
        <nav aria-label="Navigation principale">
          {pages.map((p) => (
            <button
              className={`nav-item ${page === p.id ? "active" : ""}`}
              key={p.id}
              onClick={() => navigate(p.id)}
              aria-current={page === p.id ? "page" : undefined}
            >
              <Icon name={p.icon} />
              <span>{p.name}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="pill">
            <Icon name="shield" size={18} />
            {demo ? "Espace de démonstration" : "Coffre privé"}
          </div>
          <p className="footer-note">
            {demo
              ? "Des exemples pour découvrir Finance."
              : sync.state === "ok"
                ? "Chiffré, synchronisé via votre dépôt GitHub privé."
                : sync.state === "off"
                  ? "Chiffré sur cet appareil. Sauvegardez pour transférer vos données."
                  : "Chiffré sur cet appareil. Synchronisation : voir Documents et réglages."}
          </p>
          <button className="nav-item" onClick={lock}>
            <Icon name="logout" />
            {demo ? "Quitter la démo" : "Verrouiller"}
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            Mon espace <span>/</span> {currentPage.short}
          </div>
          <div className="topbar-actions">
            <span className="pill privacy-pill">
              <span className="status-dot" />
              {demo ? "Démo fictive" : "Privé"}
            </span>
            <button
              className="icon-button"
              onClick={() => setHidden(!hidden)}
              aria-pressed={hidden}
              aria-label={
                hidden ? "Afficher les montants" : "Masquer les montants"
              }
              title={hidden ? "Afficher les montants" : "Masquer les montants"}
            >
              <Icon name={hidden ? "eye-off" : "eye"} />
            </button>
            <button
              className="icon-button"
              onClick={lock}
              aria-label="Verrouiller l’espace"
            >
              <Icon name="lock" />
            </button>
            <span className="avatar">F</span>
          </div>
        </header>
        <div className="page-header">
          <div className="page-heading">
            {page === "overview" && (
              <p className="eyebrow">VOTRE FINANCE, EN CLAIR</p>
            )}
            <h1 className="page-title">
              {page === "overview"
                ? "Une vue sur l’essentiel."
                : currentPage.name}
            </h1>
          </div>
          <button
            className="button primary small"
            onClick={() =>
              edit(
                page === "bills"
                  ? { type: "recurrence", recurrenceType: "bill", simple: true }
                  : {
                type:
                  page === "accounts"
                    ? "account"
                    : page === "subscriptions"
                      ? "recurrence"
                      : page === "goals"
                        ? "goal"
                        : page === "investments"
                          ? "position"
                          : "transaction",
                    },
              )
            }
          >
            <Icon name="plus" />
            Ajouter
          </button>
          <p className="subtitle">
            {page === "overview"
              ? "Vos comptes, votre mois, vos prochains projets."
              : page === "month"
                ? "Ce qui entre, ce qui sort et ce qui reste à prévoir."
                : page === "accounts"
                  ? "Chaque compte, sa devise et son solde daté."
                  : page === "bills"
                    ? "Vos factures fixes et vos revenus, chaque mois. Un petit changement ? Le crayon."
                  : page === "subscriptions"
                    ? "Abonnements, factures et charges du mois."
                    : page === "goals"
                      ? "Donnez une place à ce qui compte pour vous."
                      : page === "investments"
                      ? "Vos positions, rattachées à leurs comptes."
                      : "Vos pièces et vos données, à portée de main."}
          </p>
        </div>
        {demo && (
          // Une ligne : la mention complète figure dans le pied de page.
          <div className="notice demo-notice">
            Démonstration fictive
            <button className="text-button" onClick={lock}>
              Ouvrir mon coffre
            </button>
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {message && (
          <div className="notice toast" role="status">
            {message}
          </div>
        )}
        {updateNotice && <div className="update-banner">{updateNotice}</div>}
        {syncConflict && (
          <div
            className="notice warning sync-conflict"
            role="alertdialog"
            aria-labelledby="sync-conflict-title"
          >
            <p id="sync-conflict-title">
              <strong>Deux versions différentes de votre coffre.</strong>{" "}
              {syncConflict.changed
                ? "Les versions ont encore changé pendant votre choix ; rien n’a été remplacé. Vérifiez les dates, puis choisissez à nouveau."
                : "Il a été modifié ici et sur un autre appareil depuis la dernière synchronisation. Choisissez la version à garder : l’autre sera remplacée."}
            </p>
            <p className="meta">
              Cet appareil : {dateTimeLabel(syncConflict.localSavedAt)}
              {SEP}Autre appareil : {dateTimeLabel(syncConflict.remoteSavedAt)}
            </p>
            <div className="action-row">
              <button
                className="button secondary small"
                disabled={syncBusy}
                onClick={() =>
                  void manualSync({
                    kind: "remote",
                    expected: {
                      localSha: syncConflict.localSha,
                      remoteSha: syncConflict.remoteSha,
                    },
                  })
                }
              >
                Garder l’autre appareil
              </button>
              <button
                className="button secondary small"
                disabled={syncBusy}
                onClick={() =>
                  void manualSync({
                    kind: "local",
                    expected: {
                      localSha: syncConflict.localSha,
                      remoteSha: syncConflict.remoteSha,
                    },
                  })
                }
              >
                Garder cet appareil
              </button>
            </div>
          </div>
        )}
        {syncForeign && (
          <div
            className="notice warning sync-conflict"
            role="alertdialog"
            aria-labelledby="sync-foreign-title"
          >
            <p id="sync-foreign-title">
              <strong>Ce dépôt contient un autre coffre</strong> (créé
              séparément ou avec une autre phrase secrète), enregistré le{" "}
              {dateTimeLabel(syncForeign.remoteSavedAt)}. Rien n’a été modifié.
            </p>
            <p className="meta">
              Pour utiliser celui du dépôt sur cet appareil : exportez d’abord
              une sauvegarde chiffrée de ce coffre-ci (Documents et réglages),
              verrouillez, puis choisissez « Autres options » → « Ouvrir avec la clé GitHub ».
            </p>
            {syncForeign.confirming ? (
              <>
                <p>
                  Le coffre du dépôt sera remplacé par celui de cet appareil ;
                  il ne restera que dans l’historique du dépôt.
                </p>
                <div className="action-row">
                  <button
                    className="button secondary small"
                    disabled={syncBusy}
                    onClick={() =>
                      void manualSync({
                        kind: "local",
                        replaceForeign: true,
                        expected: syncForeign.remoteSha
                          ? { remoteSha: syncForeign.remoteSha }
                          : undefined,
                      })
                    }
                  >
                    Confirmer le remplacement
                  </button>
                  <button
                    className="button secondary small"
                    disabled={syncBusy}
                    onClick={() =>
                      setSyncForeign({ ...syncForeign, confirming: false })
                    }
                  >
                    Annuler
                  </button>
                </div>
              </>
            ) : (
              <div className="action-row">
                <button
                  className="button secondary small"
                  disabled={syncBusy}
                  onClick={() =>
                    setSyncForeign({ ...syncForeign, confirming: true })
                  }
                >
                  Remplacer celui du dépôt par ce coffre
                </button>
                <button
                  className="button secondary small"
                  disabled={syncBusy}
                  onClick={stopSync}
                >
                  Désactiver la synchronisation
                </button>
              </div>
            )}
          </div>
        )}
        <div className="period-bar">
          <MonthPicker
            month={month}
            onChange={setMonth}
            currentMonth={today().slice(0, 7)}
          />
          <label className="currency-picker">
            <span className="sr-only">Devise d’affichage</span>
            <select
              aria-label="Devise d’affichage"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {[
                ...new Set([
                  "CHF",
                  "EUR",
                  "USD",
                  ...data.accounts.map((a) => a.currency),
                ]),
              ].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          {/* MonthPicker already shows the year and month visually; this stays for
              screen readers only, so the month change is still announced. */}
          <span className="sr-only" aria-live="polite">
            {monthLabel(month)}
          </span>
        </div>
        {page === "overview" && (
          <>
            {!demo && syncChecked && sync.state === "off" && (
              // Un seul compte partout : même phrase secrète, synchronisation, Face ID sur chaque appareil.
              <div className="notice onboarding-notice">
                <span>
                  Un seul compte sur tous vos appareils : activez la
                  synchronisation, puis ajoutez vos autres appareils avec un
                  code. Face ID ou l’empreinte évitent de retaper la phrase.
                </span>
                <button className="text-button" onClick={() => navigate("documents")}>
                  Relier mes appareils
                </button>
              </div>
            )}
            {/* Dans l'ordre de la journée : ce qu'il me reste, ce qu'il faut régler, puis le patrimoine. */}
            <div className="overview-top">
              {leftCard}
              <Card
                title="À régler"
                icon="clock"
                action={
                  <button
                    className="card-action"
                    onClick={() => navigate("month")}
                  >
                    Voir tout <Icon name="chevron-right" size={18} />
                  </button>
                }
              >
                {/* Keeps a just-settled row through the flash even though quickSettle already
                    moved it out of "planned" — otherwise it vanishes from this filtered list
                    before row-flash-positive ever gets to render, the only place in the app
                    where marking paid gave no visible confirmation at all (the generic
                    "Enregistré" toast still fired, but the dedicated flash never did). Self-
                    resolving: justSettledId clears itself once the flash's onAnimationEnd
                    fires, so the row leaves this list right after, same as before. */}
                {transactions
                  .filter((t) => t.status === "planned" || t.id === justSettledId)
                  .slice(0, 4)
                  .map(transactionRow)}
                {!transactions.some((t) => t.status === "planned") && (
                  <div className="empty-state">
                    Tout est réglé pour {monthLabel(month)}.
                  </div>
                )}
              </Card>
            </div>
            <div className="dashboard-grid">
              <section className="hero-card">
                <div className="hero-foot">
                  <p className="hero-label">
                    Mon patrimoine{" "}
                    {wealth.partial && <span className="tag">Partiel</span>}
                  </p>
                  <span className="card-icon">
                    <Icon name="chart" size={18} />
                  </span>
                </div>
                <div className="hero-value">{display(wealth.totalMinor)}</div>
                <p className="meta">
                  {wealth.partial
                    ? `${wealth.excluded} compte(s) exclu(s) : date, valeur ou taux manquant.`
                    : "Valeurs datées connues, sans double comptage."}
                </p>
                <WealthChart data={data} currency={currency} hidden={hidden} />
                <p className="footer-note">
                  Historique des valeurs disponibles · aucune performance
                  déduite des apports.
                </p>
              </section>
              <Card
                title="Patrimoine par type"
                icon="wallet"
                action={
                  <button
                    className="card-action"
                    onClick={() => navigate("accounts")}
                  >
                    Tous les comptes <Icon name="chevron-right" size={18} />
                  </button>
                }
              >
                {wealthTypes.map((g) => {
                  // Part des actifs, masquée avec les montants.
                  const share =
                    !hidden &&
                    g.totalMinor !== null &&
                    g.totalMinor > 0 &&
                    wealthAssetsMinor > 0
                      ? (g.totalMinor / wealthAssetsMinor) * 100
                      : null;
                  return (
                    <div className="row type-row" key={g.label}>
                      <span className="institution-icon" aria-hidden="true">
                        <Icon name={accountTypeIcon(g.label)} size={18} />
                      </span>
                      <div className="row-main">
                        <span className="row-title">{g.label}</span>
                        <span className="row-detail">
                          {g.count} compte{g.count > 1 ? "s" : ""}
                          {g.excluded > 0 &&
                          `${SEP}${g.excluded} non compté${g.excluded > 1 ? "s" : ""} (solde ou taux manquant)`}
                          {share !== null && `${SEP}${Math.round(share)} %`}
                        </span>
                        {share !== null && (
                          <span className="type-share" aria-hidden="true">
                            <span style={{ width: `${Math.min(100, share)}%` }} />
                          </span>
                        )}
                      </div>
                      <span className="row-value">{display(g.totalMinor)}</span>
                    </div>
                  );
                })}
                {!data.accounts.length && (
                  <div className="empty-state">
                    <Icon name="wallet" size={30} />
                    <h3>Tout commence par un compte.</h3>
                    <p>Ajoutez un compte ou importez vos données vérifiées.</p>
                    <button
                      className="button secondary"
                      onClick={() => edit({ type: "account" })}
                    >
                      Ajouter un compte
                    </button>
                  </div>
                )}
              </Card>
            </div>
            {attention > 0 && (
              <Card
                title="À votre attention"
                icon="alert"
                action={<span className="tag">{attention}</span>}
              >
                {unknownAccounts > 0 && (
                  <div className="row">
                    <Icon name="alert" />
                    <div className="row-main">
                      <span className="row-title">
                        {unknownAccounts} compte(s) sans solde daté
                      </span>
                      <span className="row-detail">
                        Ils ne sont pas inclus dans le total.
                      </span>
                    </div>
                    <button
                      className="card-action"
                      onClick={() => navigate("accounts")}
                    >
                      Vérifier
                    </button>
                  </div>
                )}
                {staleAccounts > 0 && (
                  <p className="warning">
                    {staleAccounts} solde(s) datent de plus de 31 jours.
                  </p>
                )}
                {data.reviewItems.length > 0 && (
                  <button
                    className="nav-item"
                    onClick={() => navigate("documents")}
                  >
                    <Icon name="document" />
                    {data.reviewItems.length} informations importées à rapprocher
                    <Icon name="chevron-right" />
                  </button>
                )}
              </Card>
            )}
          </>
        )}
        {page === "month" && (
          <>
            {leftCard}
            <div className="stat-grid">
              {[
                { label: "Revenus reçus", v: summary.incomeSettled, tone: "positive" },
                { label: "Revenus attendus", v: summary.incomePlanned, tone: "positive" },
                { label: "Dépenses payées", v: summary.expenseSettled, tone: "negative" },
                { label: "Dépenses prévues", v: summary.expensePlanned, tone: "negative" },
              ].map((s) => (
                <div className="stat-card" key={s.label}>
                  <p className="metric-label">{s.label}</p>
                  <div className={`metric-value ${s.tone}`}>{display(s.v)}</div>
                </div>
              ))}
            </div>
            <Card
              title="Les opérations"
              icon="wallet"
              action={
                <button
                  className="card-action"
                  onClick={() => edit({ type: "transaction", kind: "income" })}
                >
                  + Revenu
                </button>
              }
            >
              <div className="tab-bar">
                {[
                  ["all", "Tout"],
                  ["income", "Revenus"],
                  ["expense", "Dépenses"],
                  ["transfer", "Virements"],
                ].map(([v, l]) => (
                  <button
                    key={v}
                    className={`tab-button ${filter === v ? "active" : ""}`}
                    onClick={() => setFilter(v)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {sortOperations(
                transactions.filter((t) => filter === "all" || t.kind === filter),
              ).map(transactionRow)}
              {!transactions.length && (
                <div className="empty-state">
                  Aucune opération datée pour ce mois.
                </div>
              )}
              {otherMonthsWithData.length > 0 && (
                <>
                  <button
                    className="text-button"
                    onClick={() => setShowAllMonths((v) => !v)}
                  >
                    {showAllMonths ? "Masquer" : "Voir"} les autres mois (
                    {otherMonthsWithData.length})
                  </button>
                  {showAllMonths &&
                    otherMonthsWithData.map((m) => {
                      const monthOperations = sortOperations(
                        transactionsForMonth(data, m).filter(
                          (t) => filter === "all" || t.kind === filter,
                        ),
                      );
                      return (
                        <div className="month-group" key={m}>
                          <p className="month-group-heading">{monthLabel(m)}</p>
                          {monthOperations.map(transactionRow)}
                          {!monthOperations.length && (
                            <p className="meta">
                              Aucune opération pour ce mois avec ce filtre.
                            </p>
                          )}
                        </div>
                      );
                    })}
                </>
              )}
            </Card>
            <Card title="Opérations à dater" icon="alert">
              {data.transactions
                .filter((t) => !t.date && !t.budgetMonth)
                .map(transactionRow)}
              {!data.transactions.some((t) => !t.date && !t.budgetMonth) && (
                <p className="meta">
                  Toutes les opérations enregistrées ont une date.
                </p>
              )}
            </Card>
            <Card
              title="Abonnements et charges récurrentes"
              icon="refresh"
              action={
                <button
                  className="card-action"
                  onClick={() => navigate("subscriptions")}
                >
                  Voir tout <Icon name="chevron-right" size={18} />
                </button>
              }
            >
              {data.recurrences
                .filter((r) => r.active)
                .slice(0, 4)
                .map((r) => (
                  <div className="row" key={r.id}>
                    <span
                      className={`row-icon ${recurrenceTone(r)}`}
                    >
                      <Icon name={recurrenceTypeIcons[r.recurrenceType]} />
                    </span>
                    <div className="row-main">
                      <span className="row-title">{r.label}</span>
                      <span className="row-detail">{rhythmLabel(r, month)}</span>
                    </div>
                    <span
                      className={`row-value ${recurrenceTone(r)}`}
                    >
                      {r.kind === "income" ? "+" : ""}
                      {display(r.amountMinor, r.currency)}
                    </span>
                  </div>
                ))}
              {!data.recurrences.some((r) => r.active) && (
                <div className="empty-state">
                  Vos abonnements et charges récurrentes apparaîtront ici.
                </div>
              )}
            </Card>
          </>
        )}
        {page === "accounts" && (
          <>
            {data.accounts.length ? (
              <>
                {/* Même total wealthSummary() que l'Accueil, pas un second calcul. */}
                <div className="stat-card accounts-total-card">
                  <span className="accounts-total-label">
                    <span className="card-icon">
                      <Icon name="wallet" size={18} />
                    </span>
                    Total
                    {wealth.partial && <span className="tag">Partiel</span>}
                  </span>
                  <span className="accounts-total-value">
                    {display(wealth.totalMinor)}
                  </span>
                  {wealth.partial && (
                    <p className="footer-note accounts-total-note">
                      {wealth.excluded} compte(s) exclu(s) : date, valeur ou
                      taux manquant.
                    </p>
                  )}
                </div>
                {/* Rangés par type de compte, comme dans le Notion : le total de chaque type,
                    puis ses comptes du plus grand au plus petit. */}
                <div className="account-groups">
                  {wealthTypes.map((g) => (
                    <section
                      className="account-group"
                      key={g.label}
                      data-count={Math.min(g.count, 3)}
                    >
                      <h2 className="account-group-title">
                        <span className="card-icon">
                          <Icon name={accountTypeIcon(g.label)} size={18} />
                        </span>
                        <span className="account-group-name">{g.label}</span>
                        <span className="account-group-total">
                          {display(g.totalMinor)}
                          {g.excluded > 0 && (
                            <span className="tag">Partiel</span>
                          )}
                        </span>
                      </h2>
                      <div className="account-grid">
                        {sortedAccounts
                          .filter((a) => g.accountIds.includes(a.id))
                          .map((a) => accountCard(a, false))}
                      </div>
                    </section>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-state">
                Ajoutez votre premier compte ou importez un fichier Finance.
              </div>
            )}
            <p className="footer-note">
              Les soldes conservent leur date d’observation. Les opérations du
              mois ne les modifient pas automatiquement.
            </p>
          </>
        )}
        {page === "bills" && (
          <>
            {leftCard}
            <div className="stat-grid">
              {[
                {
                  label: `Factures de ${monthLabel(month)}`,
                  value:
                    billsCohort.dueMinor !== null ? display(billsCohort.dueMinor) : "—",
                  // Montants masqués : la part payée/reçue en dirait trop.
                  pct: hidden ? null : billsSettledPct,
                  pctLabel: "Part des factures payée",
                },
                {
                  label: "Reste à payer",
                  tone: "negative",
                  value:
                    billsCohort.remainingMinor !== null
                      ? display(billsCohort.remainingMinor)
                      : "—",
                },
                {
                  label: `Revenus de ${monthLabel(month)}`,
                  value:
                    incomeCohort.dueMinor !== null ? display(incomeCohort.dueMinor) : "—",
                  pct: hidden ? null : incomeReceivedPct,
                  pctLabel: "Part des revenus reçue",
                },
                {
                  label: "Reste à recevoir",
                  tone: "positive",
                  value:
                    incomeCohort.remainingMinor !== null
                      ? display(incomeCohort.remainingMinor)
                      : "—",
                },
              ].map((s) => (
                <div className="stat-card" key={s.label}>
                  <p className="metric-label">{s.label}</p>
                  <div className={`metric-value ${s.tone ?? ""}`}>{s.value}</div>
                  {s.pct != null && (
                    <div
                      className="progress"
                      role="progressbar"
                      aria-label={s.pctLabel}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(s.pct)}
                    >
                      <div className="progress-fill" style={{ width: `${s.pct}%` }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
            {(billsCohort.partial || incomeCohort.partial) && (
              <p className="meta">
                {billsCohort.excluded + incomeCohort.excluded} échéance(s) exclue(s)
                des totaux : taux de change manquant.
              </p>
            )}
            <Card
              title="Mes factures"
              icon="document"
              action={
                <button
                  className="card-action"
                  onClick={() =>
                    edit({ type: "recurrence", recurrenceType: "bill", simple: true })
                  }
                >
                  Ajouter une facture
                </button>
              }
            >
              {billsActive.map((r) => subscriptionRow(r, "bills"))}
              {!billsActive.length && (
                <p className="meta">
                  Ajoutez vos factures fixes (loyer, assurance, téléphone,
                  électricité…) : elles reviennent chaque mois dans Mon mois.
                </p>
              )}
            </Card>
            {billsElsewhere.length > 0 && (
              <details className="account-history">
                <summary>Factures d’autres mois ({billsElsewhere.length})</summary>
                {billsElsewhere.map((r) => subscriptionRow(r, "bills"))}
              </details>
            )}
            {billsInactive.length > 0 && (
              <details className="account-history">
                <summary>Factures arrêtées ({billsInactive.length})</summary>
                {billsInactive.map((r) => subscriptionRow(r, "bills"))}
              </details>
            )}
            <Card
              title="Mes revenus"
              icon="arrow-down"
              action={
                <button
                  className="card-action"
                  onClick={() =>
                    edit({ type: "recurrence", kind: "income", simple: true })
                  }
                >
                  Ajouter un revenu
                </button>
              }
            >
              {incomeActive.map((r) => subscriptionRow(r, "bills"))}
              {!incomeActive.length && (
                <p className="meta">
                  Ajoutez vos revenus réguliers (salaire…) : ils reviennent
                  chaque mois dans Mon mois.
                </p>
              )}
            </Card>
            {incomeElsewhere.length > 0 && (
              <details className="account-history">
                <summary>Revenus d’autres mois ({incomeElsewhere.length})</summary>
                {incomeElsewhere.map((r) => subscriptionRow(r, "bills"))}
              </details>
            )}
            {incomeInactive.length > 0 && (
              <details className="account-history">
                <summary>Revenus arrêtés ({incomeInactive.length})</summary>
                {incomeInactive.map((r) => subscriptionRow(r, "bills"))}
              </details>
            )}
            <p className="footer-note">
              Factures et revenus reviennent tout seuls chaque mois, ou
              seulement le mois choisi. Le crayon change le montant de{" "}
              {monthLabel(month)} seulement, ou de ce mois et des suivants.
            </p>
          </>
        )}
        {page === "subscriptions" && (
          <>
            <div className="stat-grid">
              {[
                {
                  label: "Dû ce mois",
                  value:
                    subsCohort.dueMinor !== null
                      ? display(subsCohort.dueMinor)
                      : "—",
                },
                {
                  label: "Réglé ce mois",
                  value:
                    subsCohort.settledMinor !== null
                      ? display(subsCohort.settledMinor)
                      : "—",
                  settledPct: subsSettledPct,
                },
                {
                  label: "Reste dû",
                  value:
                    subsCohort.remainingMinor !== null
                      ? display(subsCohort.remainingMinor)
                      : "—",
                },
                {
                  // Matches cohortSummary's activeCount exactly: every active recurrence,
                  // any kind or classification (revenus et mises de côté compris) — the label
                  // must not promise a narrower scope than what is actually counted.
                  label: "Abonnements actifs",
                  value: String(subsCohort.activeCount),
                },
              ].map((s) => (
                <div className="stat-card" key={s.label}>
                  <p className="metric-label">{s.label}</p>
                  <div className="metric-value">{s.value}</div>
                  {s.settledPct != null && (
                    <div
                      className="progress"
                      role="progressbar"
                      aria-label="Part réglée"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(s.settledPct)}
                    >
                      <div
                        className="progress-fill"
                        style={{ width: `${s.settledPct}%` }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
            {subsCohort.partial && (
              <p className="meta">
                {subsCohort.excluded} occurrence(s) exclue(s) du total : taux
                de change manquant.
              </p>
            )}
            <div className="stat-grid">
              {[
                {
                  label: "Payé ce mois",
                  tone: "negative",
                  value:
                    subsFlow.paidMinor !== null ? display(subsFlow.paidMinor) : "—",
                },
                {
                  label: "Reçu ce mois",
                  tone: "positive",
                  value:
                    subsFlow.receivedMinor !== null
                      ? display(subsFlow.receivedMinor)
                      : "—",
                },
              ].map((s) => (
                <div className="stat-card" key={s.label}>
                  <p className="metric-label">{s.label}</p>
                  <div className={`metric-value ${s.tone}`}>{s.value}</div>
                </div>
              ))}
            </div>
            {subsFlow.partial && (
              <p className="meta">
                {subsFlow.excluded} règlement(s) exclu(s) du total : date ou
                taux de change manquant.
              </p>
            )}
            <Card title="Actifs" icon="refresh">
              <div className="tab-bar">
                {[
                  ["all", "Tous"],
                  ["subscription", "Abonnements"],
                  ["bill", "Charges"],
                  ["income", "Revenus"],
                ].map(([v, l]) => (
                  <button
                    key={v}
                    className={`tab-button ${filter === v ? "active" : ""}`}
                    onClick={() => setFilter(v)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <div className="tab-bar">
                {(
                  [
                    ["all", "Tous les statuts"],
                    ["settled", "Payé / Reçu"],
                    ["due", "À payer / recevoir"],
                  ] as const
                ).map(([v, l]) => (
                  <button
                    key={v}
                    className={`tab-button ${subsStatus === v ? "active" : ""}`}
                    onClick={() => setSubsStatus(v)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <label className="currency-picker sort-picker">
                <span className="sr-only">Trier les abonnements par</span>
                <select
                  aria-label="Trier les abonnements par"
                  value={subsSort}
                  onChange={(e) =>
                    setSubsSort(e.target.value as "amount" | "next")
                  }
                >
                  <option value="amount">Trier : montant mensuel</option>
                  <option value="next">Trier : prochaine échéance</option>
                </select>
              </label>
              {subsSortedActive.map((r) => subscriptionRow(r))}
              {!subsSortedActive.length && (
                <div className="empty-state">
                  {data.recurrences.some((r) => r.active)
                    ? "Aucun élément ne correspond à ces filtres."
                    : "Vos abonnements et charges récurrentes actifs apparaîtront ici."}
                </div>
              )}
            </Card>
            <details className="account-history">
              <summary>En pause ou terminés ({subsInactive.length})</summary>
              {subsInactive.map((r) => subscriptionRow(r))}
              {!subsInactive.length && (
                <p className="meta">
                  Aucun abonnement ou charge en pause ou terminé.
                </p>
              )}
            </details>
            <p className="footer-note">
              « Ce mois » désigne {monthLabel(month)}, le mois choisi en haut
              de la page.
            </p>
          </>
        )}
        {page === "goals" && (
          <>
            <div className="three-columns">{goals}</div>
            {!goals.length && (
              <div className="empty-state">
                <Icon name="target" size={36} />
                <h2>Un projet, une place à part.</h2>
                <p>
                  Impôts, réserve de sécurité ou prochain voyage : fixez votre
                  objectif.
                </p>
                <button
                  className="button secondary"
                  onClick={() => edit({ type: "goal" })}
                >
                  Créer un projet
                </button>
              </div>
            )}
            <p className="footer-note">
              Vos réserves font déjà partie de vos comptes. Elles sont suivies
              ici sans augmenter le patrimoine.
            </p>
          </>
        )}
        {page === "investments" && (
          <>
            <Card title="Vos positions" icon="chart">
              <div className="tab-bar">
                {[
                  ["all", "Tout"],
                  ["stock", "Actions"],
                  ["etf", "ETF"],
                  ["option", "Options"],
                  ["crypto", "Crypto"],
                ].map(([v, l]) => (
                  <button
                    key={v}
                    className={`tab-button ${filter === v ? "active" : ""}`}
                    onClick={() => setFilter(v)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {data.positions
                .filter((p) => filter === "all" || p.assetType === filter)
                .map((p) => (
                  <div className="row item-card" key={p.id}>
                    <span className="institution-icon">
                      {monogramInitials(p.symbol || p.name)}
                    </span>
                    <div className="row-main">
                      <span className="row-title">
                        {p.name}{" "}
                        <span className="tag">
                          {assetTypeLabels[p.assetType]}
                        </span>
                      </span>
                      <span className="row-detail">
                        {accountName(p.accountId)}
                        {SEP}
                        {hidden ? "•••" : p.quantity || "Quantité inconnue"}
                        {SEP}
                        <span className="nowrap">{p.asOf || "Non daté"}</span>
                      </span>
                    </div>
                    <div className="row-end">
                      <span className="row-value">
                        {display(p.valueMinor, p.currency)}
                      </span>
                      <div className="row-actions">
                        <button
                          className="icon-button"
                          aria-label={`Modifier ${p.name}`}
                          onClick={() => edit({ type: "position", id: p.id })}
                        >
                          <Icon name="edit" size={18} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              {!data.positions.length && (
                <div className="empty-state">
                  Aucune position vérifiée. Ajoutez une position ou importez vos
                  données.
                </div>
              )}
            </Card>
            {investmentAccounts.length > 0 && (
              <>
                <div className="section-heading">
                  <h2>Comptes liés</h2>
                </div>
                <div className="account-grid">
                  {investmentAccounts.map((a) => accountCard(a))}
                </div>
              </>
            )}
            <p className="footer-note">
              La valeur des positions est datée. Pour chaque compte, Finance
              utilise soit sa valeur totale, soit ses liquidités et ses
              positions.
            </p>
          </>
        )}
        {page === "documents" && (
          <>
            <div className="two-columns">
              <Card title="Imports et sauvegardes" icon="upload">
                <p className="footer-note">
                  Import Finance JSON ou CSV avec rapprochement des doublons.
                  Une sauvegarde chiffrée transporte le coffre complet vers un
                  autre appareil.
                </p>
                <input
                  type="file"
                  ref={fileInput}
                  hidden
                  accept=".json,.csv"
                  onChange={importFile}
                />
                <div className="action-stack">
                  <button
                    className="button secondary"
                    onClick={() =>
                      download(
                        CSV_TEMPLATE,
                        "Finance-exemple-fictif.csv",
                        "text/csv;charset=utf-8",
                      )
                    }
                  >
                    <Icon name="document" />
                    Modèle CSV (exemples fictifs)
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => fileInput.current?.click()}
                  >
                    <Icon name="upload" />
                    Importer un fichier Finance ou CSV
                  </button>
                  <button
                    className="button secondary"
                    disabled={demo}
                    aria-describedby={demo ? "backup-demo-note" : undefined}
                    onClick={() => {
                      try {
                        download(
                          exportVault(),
                          `Finance-${today()}.finance-vault`,
                        );
                      } catch (e) {
                        setError(String(e));
                      }
                    }}
                  >
                    <Icon name="download" />
                    Sauvegarde chiffrée
                  </button>
                  <button
                    className="button secondary"
                    onClick={() =>
                      download(
                        JSON.stringify(data, null, 2),
                        `Finance-${today()}.json`,
                      )
                    }
                  >
                    <Icon name="download" />
                    Exporter les données JSON (non chiffrées)
                  </button>
                </div>
                {demo && (
                  <p className="meta" id="backup-demo-note">
                    La sauvegarde chiffrée est disponible une fois votre coffre
                    ouvert.
                  </p>
                )}
                <p className="footer-note">
                  L’export JSON contient vos données privées. Conservez-le dans
                  un emplacement protégé.
                </p>
              </Card>
              <Card title="Préférences et synchronisation" icon="settings">
                <label className="field">
                  <span>Devise principale</span>
                  <select
                    value={data.preferences.baseCurrency}
                    onChange={(e) =>
                      persist({
                        ...data,
                        preferences: {
                          ...data.preferences,
                          baseCurrency: e.target.value,
                        },
                      }).catch((e) => setError(String(e)))
                    }
                  >
                    {["CHF", "EUR", "USD"].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <p className="meta">
                  Appareil local · verrouillage après 5 minutes d’inactivité.
                </p>
                <p className="footer-note">
                  Aucune connexion bancaire : les montants restent saisis ou
                  importés par vous.
                </p>
                <button
                  className="button secondary"
                  onClick={() => edit({ type: "fx" })}
                >
                  <Icon name="transfer" />
                  Ajouter un taux de change daté
                </button>
                <div className="rates">
                  {data.fxRates.map((r, i) => (
                    <p className="meta" key={i}>
                      {hidden ? "•••" : `1 ${r.from} = ${r.rate} ${r.to}`}
                      {SEP}
                      {r.asOf}
                    </p>
                  ))}
                </div>
              </Card>
              <Card title="Synchronisation entre appareils" icon="refresh">
                <SyncCard
                  view={sync}
                  demo={demo}
                  busy={syncBusy}
                  onConfigure={enableSync}
                  onSyncNow={() => void manualSync({ kind: "manual" })}
                  onDisable={stopSync}
                  onCreateLink={async () => {
                    if (!key) throw new Error("Coffre verrouillé.");
                    const stored = await loadSyncState(key);
                    if (stored.state !== "ready")
                      throw new Error("Synchronisation à reconfigurer sur cet appareil.");
                    return (await createDeviceLink(key, stored.config)).code;
                  }}
                />
              </Card>
              <Card title="Connexion rapide" icon="lock">
                <QuickUnlockCard demo={demo} />
              </Card>
            </div>
            {pendingImport && (
              <Card title="Vérifier cet import" icon="check">
                <p>
                  {pendingImport.accounts.length} comptes ·{" "}
                  {pendingImport.transactions.length} opérations ·{" "}
                  {pendingImport.positions.length} positions ·{" "}
                  {pendingImport.reviewItems.length} éléments à rapprocher.
                </p>
                <p className="footer-note">
                  Les éléments identiques seront ignorés et les conflits
                  conservés pour vérification.
                </p>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={confirmImport}
                >
                  {busy ? "Import…" : "Confirmer l’import"}
                </button>{" "}
                <button
                  className="button secondary"
                  onClick={() => setPendingImport(null)}
                >
                  Annuler
                </button>
              </Card>
            )}
            <Card title="Reçus et documents" icon="document">
              <div className="form-grid">
                <label className="field">
                  <span>Lier à une opération (facultatif)</span>
                  <select
                    value={receiptTxn}
                    onChange={(e) => setReceiptTxn(e.target.value)}
                  >
                    <option value="">Sans opération</option>
                    {data.transactions.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label} · {t.date || "Non daté"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="button secondary">
                  <Icon name="plus" />
                  Joindre un reçu
                  <input
                    className="sr-only"
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    onChange={attach}
                  />
                </label>
              </div>
              <p className="footer-note">
                PDF ou image · 2 Mo par document · conservé dans le coffre
                chiffré.
              </p>
              {data.documents.map((d) => (
                <div className="row" key={d.id}>
                  <span className="row-icon">
                    <Icon name="document" />
                  </span>
                  <div className="row-main">
                    <span className="row-title">{d.name}</span>
                    <span className="row-detail">
                      {d.addedAt.slice(0, 10)}
                      {SEP}
                      {d.transactionId
                        ? data.transactions.find(
                            (t) => t.id === d.transactionId,
                          )?.label
                        : "Sans opération"}
                    </span>
                  </div>
                  {d.dataUrl && (
                    <button
                      className="button small secondary"
                      onClick={() => openDocument(d)}
                    >
                      Ouvrir
                    </button>
                  )}
                  {d.url && /^https:\/\/(www\.)?notion\.so\//.test(d.url) && (
                    <a
                      className="button small secondary"
                      href={d.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Dans Notion ↗
                    </a>
                  )}
                </div>
              ))}
              {!data.documents.length && (
                <div className="empty-state">
                  Vos justificatifs retrouveront ici leurs opérations.
                </div>
              )}
            </Card>
            <Card title="Informations à vérifier" icon="alert">
              {hidden ? (
                <p className="meta">Informations masquées.</p>
              ) : (
                data.reviewItems.slice(0, 100).map((r) => (
                  <div className="review-item" key={r.id}>
                    <h3>{r.title}</h3>
                    <p>{r.reason}</p>
                    <SourceLink source={r.source} />
                  </div>
                ))
              )}
              {data.reviewItems.length > 100 && (
                <p className="footer-note">
                  100 éléments affichés sur {data.reviewItems.length}. L’export
                  conserve la totalité.
                </p>
              )}
              {!data.reviewItems.length && (
                <p className="meta">
                  Aucune information en attente de rapprochement.
                </p>
              )}
            </Card>
          </>
        )}
        <footer className="footer-note page-footer">
          Finance ·{" "}
          {demo
            ? "Démonstration · Tous les montants et établissements sont fictifs."
            : "Espace privé sur cet appareil ·"}{" "}
          Soldes observés, sources conservées. Version {__APP_VERSION__} du{" "}
          {__APP_BUILT_ON__}.
        </footer>
      </main>
      <nav className="mobile-nav" aria-label="Navigation mobile">
        {pages.slice(0, MOBILE_TABS).map((p) => (
          <button
            key={p.id}
            className={page === p.id ? "active" : ""}
            onClick={() => navigate(p.id)}
            aria-current={page === p.id ? "page" : undefined}
          >
            <Icon name={p.icon} />
            <span>{p.short}</span>
          </button>
        ))}
        <button
          ref={moreButton}
          onClick={() => setMore(!more)}
          className={
            pages.findIndex((p) => p.id === page) >= MOBILE_TABS
              ? "active"
              : ""
          }
          aria-expanded={more}
        >
          <Icon name="more" />
          <span>Plus</span>
        </button>
      </nav>
      {more && (
        <button
          className="mobile-more-backdrop"
          aria-label="Fermer le menu"
          onClick={(e) => {
            setMore(false);
            // detail 0 : activé au clavier, le focus ne doit pas tomber sur <body>.
            if (e.detail === 0) moreButton.current?.focus();
          }}
        />
      )}
      {more && (
        <div className="mobile-more">
          {pages.slice(MOBILE_TABS).map((p) => (
            <button
              className={`nav-item${page === p.id ? " active" : ""}`}
              key={p.id}
              onClick={() => navigate(p.id)}
              aria-current={page === p.id ? "page" : undefined}
            >
              <Icon name={p.icon} />
              {p.name}
            </button>
          ))}
        </div>
      )}
      {editor && (
        <Editor
          key={`${editor.type}-${editor.id || "new"}`}
          spec={editor}
          data={data}
          month={month}
          onSave={(next) => {
            // Un tirage pendant l'édition : les champs du formulaire datent d'avant, ne pas les réécrire.
            if (pullCount.current !== editorPulls.current)
              return Promise.reject(new Error(EDITED_ELSEWHERE));
            return persist(next);
          }}
          onClose={() => setEditor(null)}
        />
      )}
      {occurrenceEdit &&
        (() => {
          const recurrence = data.recurrences.find(
            (r) => r.id === occurrenceEdit.recurrenceId,
          );
          const item = occurrenceCohort(data, occurrenceEdit.occurrenceDate.slice(0, 7)).find(
            (i) =>
              i.recurrenceId === occurrenceEdit.recurrenceId &&
              i.occurrenceDate === occurrenceEdit.occurrenceDate,
          );
          if (!recurrence || !item) return null;
          return (
            <OccurrenceDialog
              key={`${recurrence.id}:${item.occurrenceDate}`}
              recurrence={recurrence}
              occurrenceDate={item.occurrenceDate}
              amountMinor={item.dueAmountMinor}
              currency={item.currency}
              usualAmountMinor={item.projectedAmountMinor}
              settled={item.settled !== null}
              onSave={saveOccurrence}
              onEditAll={() => {
                setOccurrenceEdit(null);
                edit({ type: "recurrence", id: recurrence.id });
              }}
              onClose={() => setOccurrenceEdit(null)}
            />
          );
        })()}
      {preview && (
        <dialog
          className="dialog document-dialog"
          aria-labelledby="document-title"
          ref={previewDialog}
          onCancel={() => setPreview(null)}
        >
          <div className="dialog-header">
            <h2 id="document-title">{preview.name}</h2>
            <button
              className="icon-button"
              onClick={() => setPreview(null)}
              aria-label="Fermer le document"
            >
              <Icon name="close" />
            </button>
          </div>
          {preview.pdf ? (
            <>
              <p>Le document est prêt.</p>
              <a
                className="button primary"
                href={preview.url}
                download={preview.name}
              >
                Télécharger le PDF
              </a>
            </>
          ) : (
            <img src={preview.url} alt={preview.name} />
          )}
        </dialog>
      )}
    </div>
  );
}
