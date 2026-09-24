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
  availableSummary,
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
  Allocation,
  FlowChart,
  SPARKLINE_MIN_POINTS,
  Sparkline,
  WealthChart,
} from "./components/Charts";
import Editor, { type EditorSpec } from "./components/Editor";
import { MonthPicker } from "./components/MonthPicker";
import { UPDATE_READY_EVENT } from "./swUpdateEvent";
const pages = [
  { id: "overview", name: "Vue d’ensemble", short: "Accueil", icon: "home" },
  { id: "month", name: "Mon mois", short: "Mon mois", icon: "calendar" },
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
function Auth({
  onOpen,
  onDemo,
}: {
  onOpen: (data: FinanceData, key: CryptoKey) => void;
  onDemo: () => void;
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
    pendingOlderBackupPasswordRef = useRef("");
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
      if (backup) {
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
      if (backup && e instanceof Error && isOlderBackupError(e.message)) {
        // Nothing was written (importVault fails closed before touching the vault):
        // ask for an explicit, conscious confirmation instead of a dead-end error.
        pendingOlderBackupPasswordRef.current = password;
        setOlderBackup({ raw: backup, message: e.message });
      } else {
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
    try {
      const r = await importVault(olderBackup.raw, password, true);
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
      setBusy(false);
    }
  }
  function cancelOlderBackup() {
    // Nothing was ever written for this refusal, so canceling is a pure UI reset.
    pendingOlderBackupPasswordRef.current = "";
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
            : backup
              ? "Restaurer votre sauvegarde"
              : exists
                ? "Ouvrir mon espace"
                : "Créer mon espace privé"}
        </h2>
        <p className="subtitle">
          {olderBackup
            ? "Cette sauvegarde est plus ancienne que les données déjà présentes sur cet appareil."
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
            <form onSubmit={submit}>
              <label className="field">
                <span>Phrase secrète</span>
                <input
                  type="password"
                  name="password"
                  autoComplete={exists ? "current-password" : "new-password"}
                  minLength={exists || backup ? 1 : 12}
                  required
                />
              </label>
              {!exists && !backup && (
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
            <div className="auth-links">
              <label className="button secondary">
                Restaurer une sauvegarde
                <input
                  className="sr-only"
                  type="file"
                  accept=".finance-vault,.json"
                  onChange={restore}
                />
              </label>
              <button
                className="button secondary"
                disabled={busy}
                onClick={onDemo}
              >
                Voir la démonstration
              </button>
            </div>
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
    [receiptTxn, setReceiptTxn] = useState("");
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
    setData(null);
    setKey(null);
    setDemo(false);
    setEditor(null);
    setPendingImport(null);
    setHidden(false);
    setPreview(null);
    setMessage("");
    setError("");
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
    return () => {
      document.removeEventListener("input", used, true);
      document.removeEventListener("submit", used, true);
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
      const valid = validateData(next);
      if (!demo) {
        if (!key) throw new Error("Coffre verrouillé.");
        await saveVault(key, valid);
      }
      if (currentSession !== session.current)
        throw new Error("Coffre verrouillé.");
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
        />
      </>
    );
  const available = availableSummary(data, currency, month);
  const wealth = wealthSummary(data, currency),
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
        const m = t.date?.slice(0, 7) ?? t.budgetMonth;
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
    setEditor(spec);
  };
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
  // Coût mensuel par nature pour l'aperçu de l'Accueil : somme de l'équivalent mensuel de
  // chaque récurrence active de cette nature, converti vers la devise d'affichage — même
  // schéma que subsAmountRanking ci-dessous (monthlyEquivalentMinor + convertMinor à la même
  // date), pas la cohorte du mois (qui vaudrait 0 les mois sans échéance pour une récurrence
  // trimestrielle ou annuelle). Une seule devise manquante rend le total entier "partiel"
  // plutôt que d'additionner des montants non comparables.
  const monthlyEquivalentTotal = (type: Recurrence["recurrenceType"]) => {
    const at = today();
    let totalMinor = 0,
      excluded = 0,
      count = 0;
    for (const r of data.recurrences) {
      if (!r.active || r.recurrenceType !== type) continue;
      count++;
      const converted = convertMinor(
        monthlyEquivalentMinor(r, at),
        r.currency,
        currency,
        data.fxRates,
        at,
      );
      if (converted === null) {
        excluded++;
        continue;
      }
      totalMinor += converted;
    }
    return { totalMinor: excluded > 0 ? null : totalMinor, count, excluded };
  };
  const subsMonthlyOverview = monthlyEquivalentTotal("subscription");
  const billsMonthlyOverview = monthlyEquivalentTotal("bill");
  const savingMonthlyOverview = monthlyEquivalentTotal("saving");
  const subsMatchesType = (r: Recurrence) =>
    filter === "all" || r.recurrenceType === filter;
  const subsMatchesStatus = (r: Recurrence) => {
    if (subsStatus === "all") return true;
    const item = subsCohortByRecurrence.get(r.id);
    return subsStatus === "settled" ? !!item?.settled : !!item && !item.settled;
  };
  const subsActive = data.recurrences.filter(
    (r) => r.active && subsMatchesType(r) && subsMatchesStatus(r),
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
  // Prefills "Marquer payé/reçu" from a not-yet-persisted occurrence, mirroring
  // `transactionsForMonth`'s own virtual-transaction shape and id (`recurrenceId:date`) so a
  // settlement made here and one made from Mon mois never create two different transactions
  // for the same occurrence.
  function subsVirtualTransaction(r: Recurrence, dueDate: string, amountMinor: number): Transaction {
    return {
      id: `${r.id}:${dueDate}`,
      label: r.label,
      kind: r.kind,
      amountMinor,
      currency: r.currency,
      status: "planned",
      date: dueDate,
      accountId: r.accountId,
      category: r.category,
      recurrenceId: r.id,
      occurrenceDate: dueDate,
      source: r.source,
    };
  }
  const kinds = {
    bank: "Compte bancaire",
    savings: "Épargne",
    investment: "Investissement",
    debt: "Dette",
  };
  // The account's own icon (institution-icon slot) now shows what the account IS, not who
  // holds it: real icons from the existing set, never an emoji or an institution-derived
  // monogram. "bank"/"vault"/"chart" already carry these exact meanings elsewhere in the app
  // (recurring charge/saving/wealth trend); "debt" is the one new glyph this lot adds.
  const kindIcons: Record<Account["kind"], IconName> = {
    bank: "bank",
    savings: "vault",
    investment: "chart",
    debt: "debt",
  };
  // Solde affiché (daté, sinon dernier saisi) et sa date, communs à la carte et à la ligne.
  function accountBalance(a: Account) {
    const b = latestBalance(a),
      show = b || a.balances.at(-1);
    return { show, asOf: b?.asOf || null };
  }
  // Ligne compacte de l'Accueil : le détail (actualiser, historique) reste dans Mes comptes.
  function accountRow(a: Account) {
    const { show, asOf } = accountBalance(a);
    // Mention courte : sur iPhone, une plus longue ferait passer le montant à la ligne.
    const note = asOf ? `au ${asOf}` : show ? "Non daté" : "À renseigner";
    return (
      <div className="row" key={a.id}>
        <span
          className="institution-icon"
          role="img"
          aria-label={kinds[a.kind]}
        >
          <Icon name={kindIcons[a.kind]} size={18} />
        </span>
        <div className="row-main">
          <span className="row-title">{a.name}</span>
          <span className="row-detail">{a.institution}</span>
        </div>
        <span className="row-value">
          {display(show?.amountMinor ?? null, a.currency)}
          <span className="row-detail nowrap">{note}</span>
        </span>
      </div>
    );
  }
  // Le nom du compte est primaire ; l'établissement et la nature restent secondaires.
  function accountCard(a: Account) {
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
            <Icon name={kindIcons[a.kind]} size={20} />
          </span>
          <div className="account-id">
            <h3>{a.name}</h3>
            <p className="account-sub">
              <span className="institution">{a.institution}</span>
              <span className="kind-badge">{kinds[a.kind]}</span>
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
      await persist({
        ...data,
        transactions: data.transactions.some((v) => v.id === t.id)
          ? data.transactions.map((v) => (v.id === t.id ? next : v))
          : [...data.transactions, next],
      });
      setJustSettledId(t.id);
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
              t.status === "planned" && data?.transactions.some((i) => i.id === t.id) && (
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
  function subscriptionRow(r: Recurrence) {
    const cohortItem = subsCohortByRecurrence.get(r.id);
    const settledTxn = cohortItem?.settled
      ? data?.transactions.find((t) => t.id === cohortItem.settled!.transactionId)
      : undefined;
    const dueTxn =
      cohortItem && !cohortItem.settled
        ? subsVirtualTransaction(r, cohortItem.occurrenceDate, cohortItem.dueAmountMinor)
        : null;
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
                  Terminé le <span className="nowrap">{r.endDate}</span>
                </>
              ) : (
                "En pause"
              )
            ) : (
              <>
                <span className="nowrap">{monthLabel(month)}</span>
                {SEP}
                <span
                  className={`nowrap ${!cohortItem ? "" : cohortItem.settled ? recurrenceTone(r) : "status-pending"}`}
                >
                  {!cohortItem
                    ? "Aucune échéance"
                    : cohortItem.settled
                      ? r.kind === "income"
                        ? "Reçu"
                        : "Payé"
                      : r.kind === "income"
                        ? "Pas encore reçu"
                        : "Pas encore payé"}
                </span>
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
            ) : (
              <span className="row-detail">Aucune échéance</span>
            )}
          </div>
          <div className="row-actions">
            {/* Comme dans Mon mois : l'action principale reste au bord droit. */}
            <button
              className="icon-button"
              aria-label={`Modifier ${r.label}`}
              onClick={() => edit({ type: "recurrence", id: r.id })}
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
              : "Chiffré sur cet appareil. Sauvegardez pour transférer vos données."}
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
              edit({
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
              })
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
            <div className="dashboard-grid">
              <section className="hero-card">
                <div className="hero-foot">
                  <p className="hero-label">
                    Patrimoine observé{" "}
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
                title="Votre mois"
                icon="calendar"
                action={
                  <button
                    className="card-action"
                    onClick={() => navigate("month")}
                  >
                    Détail <Icon name="chevron-right" size={18} />
                  </button>
                }
              >
                <div className="metric">
                  <div className="metric-label">Revenus confirmés</div>
                  <div className="metric-value positive">
                    {display(summary.incomeSettled)}
                  </div>
                </div>
                <div className="metric">
                  <div className="metric-label">Dépenses confirmées</div>
                  <div className="metric-value negative">
                    {display(summary.expenseSettled)}
                  </div>
                </div>
                <div className="metric">
                  <div className="metric-label">
                    Disponible après réserves et charges
                  </div>
                  <div className="metric-value">
                    {display(available.amountMinor)}
                  </div>
                  <p className="footer-note">
                    {available.partial
                      ? "À établir avec des soldes bancaires du jour et des engagements rapprochés."
                      : `Estimation au ${available.asOf}, après engagements connus du mois.`}
                  </p>
                </div>
                <div className="metric highlighted">
                  <div className="metric-label">Projection nette du mois</div>
                  <div className="metric-value">
                    {display(summary.remaining)}
                  </div>
                  <p className="footer-note">
                    Revenus prévus et reçus, moins dépenses prévues et payées.
                    Ce n’est pas le solde disponible.
                  </p>
                </div>
              </Card>
            </div>
            <div className="section-heading">
              <h2>Aperçu du mois</h2>
            </div>
            <div className="stat-grid">
              {[
                {
                  label: "Revenus (reçus et attendus)",
                  value:
                    summary.incomePlanned === null ||
                    summary.incomeSettled === null
                      ? null
                      : summary.incomePlanned + summary.incomeSettled,
                  meta: null as string | null,
                  tone: "positive",
                },
                {
                  label: "Abonnements (mensuel)",
                  value: subsMonthlyOverview.totalMinor,
                  meta: `${subsMonthlyOverview.count} actif(s)`,
                  tone: "negative",
                },
                {
                  label: "Factures et charges (mensuel)",
                  value: billsMonthlyOverview.totalMinor,
                  meta: `${billsMonthlyOverview.count} actif(s)`,
                  tone: "negative",
                },
                {
                  label: "Épargne (mensuel)",
                  value: savingMonthlyOverview.totalMinor,
                  meta: `${savingMonthlyOverview.count} actif(s)`,
                  tone: "transfer",
                },
              ].map((s) => (
                <div className="stat-card" key={s.label}>
                  <p className="metric-label">{s.label}</p>
                  <div className={`metric-value ${s.tone}`}>
                    {s.value !== null ? display(s.value) : "—"}
                  </div>
                  {s.meta && <p className="meta">{s.meta}</p>}
                </div>
              ))}
            </div>
            <Card
              title="Vos comptes"
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
              {sortedAccounts.slice(0, 3).map(accountRow)}
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
            <div className="three-columns">
              <Card title="Répartition du patrimoine" icon="chart">
                <Allocation
                  hidden={hidden}
                  currency={currency}
                  // Ordered like sortedAccounts (largest to smallest), not wealth.items'
                  // insertion order — docs/PLAN_AMELIORATION_V2.md also asks répartitions
                  // to sort, not just the account list itself.
                  items={sortedAccounts.flatMap((a) => {
                    const valueMinor = wealth.items.find(
                      (i) => i.accountId === a.id,
                    )?.valueMinor;
                    return valueMinor == null
                      ? []
                      : [{ name: accountName(a.id), value: valueMinor }];
                  })}
                />
                <p className="footer-note">
                  Actifs positifs uniquement. Dettes déduites du patrimoine
                  total.
                </p>
              </Card>
              <div className="card-stack">
                <Card title="Le mouvement du mois" icon="transfer">
                  <FlowChart
                    income={
                      summary.incomePlanned === null ||
                      summary.incomeSettled === null
                        ? null
                        : summary.incomePlanned + summary.incomeSettled
                    }
                    expense={
                      summary.expensePlanned === null ||
                      summary.expenseSettled === null
                        ? null
                        : summary.expensePlanned + summary.expenseSettled
                    }
                    currency={currency}
                    hidden={hidden}
                  />
                </Card>
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
                  {!attention && (
                    <p className="meta">
                      Aucune information à rapprocher dans les données présentes.
                    </p>
                  )}
                </Card>
              </div>
              <Card
                title="Prochaines échéances"
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
                    Aucune échéance connue pour ce mois.
                  </div>
                )}
              </Card>
            </div>
          </>
        )}
        {page === "month" && (
          <>
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
                      <span className="row-detail">
                        Le {r.day}
                        {SEP}
                        {r.intervalMonths === 1
                          ? "tous les mois"
                          : `tous les ${r.intervalMonths} mois`}
                      </span>
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
                <div className="account-grid">
                  {sortedAccounts.map(accountCard)}
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
              {subsSortedActive.map(subscriptionRow)}
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
              {subsInactive.map(subscriptionRow)}
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
                  {investmentAccounts.map(accountCard)}
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
                  Synchronisation bancaire et entre appareils : non configurée.
                  Transférez une sauvegarde chiffrée, puis restaurez-la à
                  l’ouverture sur l’autre appareil.
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
        {pages.slice(0, 3).map((p) => (
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
            !["overview", "month", "accounts"].includes(page)
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
          {pages.slice(3).map((p) => (
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
          onSave={persist}
          onClose={() => setEditor(null)}
        />
      )}
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
