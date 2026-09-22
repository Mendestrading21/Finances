import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
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
  latestBalance,
  money,
  monthLabel,
  monthSummary,
  monthlyEquivalentMinor,
  nextOccurrenceDate,
  occurrenceCohort,
  rankAccounts,
  rankByValue,
  recurrenceAmountAt,
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
import { Allocation, FlowChart, WealthChart } from "./components/Charts";
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
// Local, deterministic identity for an establishment or a security, wherever the app shows a
// short monogram instead of a real logo: identite-ui.md rules out fetching a real bank logo at
// render time (it would reveal which establishments are consulted and depend on a third party)
// and there is no verified-rights logo/pictogram registry to draw from here — so the fallback
// is a locally generated monogram, with initials that reflect a multi-word name instead of a
// naive slice(0, 2) ("Banque Fictive" → "BF", not "BA"), and a stable color from a small
// palette within the app's own blue-violet accent family (never an arbitrary hue) so entries
// read as visually distinct in a list, per docs/AUDIT_UI_V2.md.
function monogramInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (
    words.length > 1 ? words[0][0] + words[1][0] : name.replace(/\s+/g, "").slice(0, 2)
  ).toUpperCase();
}
const MONOGRAM_PALETTE = [
  { bg: "rgba(138, 169, 255, 0.16)", fg: "#8aa9ff" },
  { bg: "rgba(170, 150, 255, 0.16)", fg: "#aa96ff" },
  { bg: "rgba(111, 151, 224, 0.16)", fg: "#6f97e0" },
  { bg: "rgba(124, 140, 255, 0.16)", fg: "#7c8cff" },
  { bg: "rgba(200, 150, 230, 0.16)", fg: "#c896e6" },
  { bg: "rgba(160, 180, 200, 0.16)", fg: "#c0ceef" },
];
function monogramColors(name: string): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return MONOGRAM_PALETTE[hash % MONOGRAM_PALETTE.length];
}
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
              <Icon name={icon} size={15} />
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
      password: string;
      message: string;
    } | null>(null),
    cancelOlderBackupRef = useRef<HTMLButtonElement>(null);
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
        setOlderBackup({ raw: backup, password, message: e.message });
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
    try {
      const r = await importVault(olderBackup.raw, olderBackup.password, true);
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
      setBusy(false);
    }
  }
  function cancelOlderBackup() {
    // Nothing was ever written for this refusal, so canceling is a pure UI reset.
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
    setOlderBackup(null);
    setBackup(await file.text());
    setError("");
  }
  return (
    <main className="auth-screen">
      <section className="auth-art">
        <div className="brand">
          <img src="./finance.svg" className="brand-mark" alt="" />
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
          <img src="./finance.svg" className="brand-mark" alt="" />
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
    [subsStatus, setSubsStatus] = useState<"all" | "due" | "settled">("all"),
    [subsSort, setSubsSort] = useState<"amount" | "next">("amount"),
    [more, setMore] = useState(false),
    [pendingImport, setPendingImport] = useState<FinanceData | null>(null),
    [busy, setBusy] = useState(false),
    [receiptTxn, setReceiptTxn] = useState("");
  const session = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
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
  useEffect(() => {
    const onUpdateReady = () => setUpdateReady(true);
    window.addEventListener(UPDATE_READY_EVENT, onUpdateReady);
    return () => window.removeEventListener(UPDATE_READY_EVENT, onUpdateReady);
  }, []);
  useEffect(() => {
    if (preview) previewDialog.current?.showModal();
    return () => {
      if (preview) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);
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
  if (!data)
    return (
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
  const recurrenceTypeLabels: Record<Recurrence["recurrenceType"], string> = {
    subscription: "Abonnement",
    bill: "Charge",
    income: "Revenu récurrent",
    saving: "Épargne / mise de côté",
    other: "À vérifier",
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
  // Colors an account's kind-badge already commits to one nature, reused for a
  // recurrence's own .row-icon instead of the single flat grey every row used before —
  // in a real multi-row list (not the demo fixture's lone entry) that grey read as one
  // undifferentiated column of near-identical squares, the icon glyph the only thing to
  // scan. Not new colors: exactly kind-badge-investment/bank/savings' hues, plus the same
  // "income" ⇒ .positive green a transaction row already uses — one meaning per color
  // across the whole app, not a second palette invented for this list. "other" (à
  // vérifier) is deliberately left uncolored: it is the one nature that is not really a
  // settled category, and it already reads distinctly via its "alert" glyph.
  const recurrenceTypeRowClass: Record<Recurrence["recurrenceType"], string> = {
    subscription: "row-icon-subscription",
    bill: "row-icon-bill",
    income: "positive",
    saving: "row-icon-saving",
    other: "",
  };
  // The cohort is keyed by recurrenceId: `occurrenceCohort` only ever produces at most one
  // entry per active recurrence for a given month (see finance.ts), so this lookup is safe.
  const subsCohortItems = occurrenceCohort(data, month);
  const subsCohortByRecurrence = new Map(
    subsCohortItems.map((i) => [i.recurrenceId, i]),
  );
  const subsCohort = cohortSummary(data, month, currency);
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
  // One card, reused everywhere an account appears (Accueil preview, full "Mes comptes"
  // grid, Investissements) — "Mes comptes" briefly shipped as a real <table> (merged, then
  // this session's own explicit user feedback called it too dense and asked for cards
  // again instead); this is not that pre-table card restored unchanged either, see the
  // redesign notes below.
  //
  // The account's own name (a.name, e.g. "Portefeuille long terme") is the card's primary
  // identity per identite-ui.md ("Le nom du compte est primaire. L'établissement devient une
  // information secondaire") — the previous version of this card had that inverted (the
  // institution rendered larger, the account name demoted into a small muted line), a real
  // hierarchy bug this redesign also fixes, not just a restyle. The institution keeps its
  // monogram and now sits directly below the name with its kind-badge (identite-ui.md: "une
  // identité locale"), unchanged pill colors/logic from the earlier badge lot.
  function accountCard(a: Account) {
    const b = latestBalance(a),
      unverified = a.balances.at(-1),
      show = b || unverified;
    return (
      <article className="account-card" key={a.id}>
        <div className="account-head">
          <span className={`institution-icon institution-icon-${a.kind}`}>
            <Icon name={kindIcons[a.kind]} size={20} />
          </span>
          <div className="account-id">
            <h3>{a.name}</h3>
            <p className="account-sub">
              <span className="institution">{a.institution}</span>
              <span className={`kind-badge kind-badge-${a.kind}`}>
                {kinds[a.kind]}
              </span>
            </p>
          </div>
          <button
            className="icon-button"
            onClick={() => edit({ type: "account", id: a.id })}
            aria-label={`Modifier ${a.name}`}
          >
            <Icon name="edit" size={17} />
          </button>
        </div>
        <div className="balance">
          {display(show?.amountMinor ?? null, a.currency)}
        </div>
        <p className="meta">
          {b?.asOf
            ? `Solde au ${b.asOf}`
            : show
              ? "Non daté · à vérifier"
              : "Solde à renseigner"}
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
            <Icon name="refresh" size={16} />
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
  // Opens the editor pre-filled to settled/today rather than writing it on click: the
  // settlement date must stay "visible et modifiable avant validation" (see
  // .claude/skills/finance/references/abonnements.md), not silently forced to today.
  // `transaction` prefills the form even for a not-yet-persisted virtual occurrence,
  // which has no entry in data.transactions for the usual by-id lookup to find.
  function markSettled(t: Transaction) {
    edit({
      type: "transaction",
      id: t.id,
      kind: t.kind,
      transaction: { ...t, status: "settled", date: today() },
    });
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
      <div className="row" key={t.id}>
        <span
          className={`row-icon ${t.kind === "income" ? "positive" : t.kind === "transfer" ? "neutral" : "negative"}`}
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
        <div className="row-main">
          <span className="row-title">{t.label}</span>
          <span className="row-detail">
            {t.date ||
              (t.budgetMonth
                ? monthLabel(t.budgetMonth) + " · jour à vérifier"
                : "Date à vérifier")}{" "}
            · {accountName(t.accountId)} · {statusWord(t)}
            {data?.documents.some((d) => d.transactionId === t.id) &&
              " · Justificatif joint"}
          </span>
        </div>
        <div className="row-end">
          <span className={`row-value ${t.kind === "income" ? "positive" : ""}`}>
            {t.kind === "income" ? "+" : ""}
            {display(t.amountMinor, t.currency)}
          </span>
          <div className="row-actions">
            {t.status === "planned" ? (
              <button className="button small secondary" onClick={() => markSettled(t)}>
                <Icon name="check" size={16} />
                {t.kind === "income"
                  ? "Marquer reçu"
                  : t.kind === "transfer"
                    ? "Marquer réglé"
                    : "Marquer payé"}
              </button>
            ) : null}
            {data?.transactions.some((i) => i.id === t.id) && (
              <>
                {
                  // Kept exclusive with the "marquer" action above so a planned row never
                  // crowds two actions (the label wraps on an iPhone width). A receipt is
                  // also most often at hand once the operation is settled; a planned
                  // operation can still be reached from Documents et réglages. The
                  // correction action below adds a third icon-button only for the narrower
                  // recurrence-linked case — accepted for now, to revisit with the row
                  // density rework of V2.5.
                  t.status !== "planned" && (
                    <label
                      className="icon-button"
                      aria-label={`Joindre un document à ${t.label}`}
                    >
                      <Icon name="document" size={17} />
                      <input
                        className="sr-only"
                        type="file"
                        accept="application/pdf,image/jpeg,image/png,image/webp"
                        onChange={(e) => attach(e, t.id)}
                      />
                    </label>
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
                    <Icon name="refresh" size={17} />
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label={`Modifier ${t.label}`}
                  onClick={() =>
                    edit({ type: "transaction", id: t.id, kind: t.kind })
                  }
                >
                  <Icon name="edit" size={17} />
                </button>
              </>
            )}
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
    const nextDate = r.active ? nextOccurrenceDate(r) : null;
    const nextAmount = nextDate ? recurrenceAmountAt(r, nextDate) : null;
    const monthlyEquiv = r.intervalMonths > 1 ? monthlyEquivalentMinor(r) : null;
    return (
      <div className="row" key={r.id}>
        <span
          className={`row-icon ${recurrenceTypeRowClass[r.recurrenceType]}`}
        >
          <Icon name={recurrenceTypeIcons[r.recurrenceType]} />
        </span>
        <div className="row-main">
          <span className="row-title">{r.label}</span>
          <span className="row-detail">
            {recurrenceTypeLabels[r.recurrenceType]} · Le {r.day} ·{" "}
            {r.intervalMonths === 1 ? "tous les mois" : `tous les ${r.intervalMonths} mois`}{" "}
            · {accountName(r.accountId)}
          </span>
          {/* Same signal a transaction row already gives (green once settled) — the text
              itself ("Payé"/"Pas encore payé") stays the actual source of truth, this only
              reinforces it (design.md: "Ne pas utiliser la couleur seule"). */}
          <span
            className={`row-detail${cohortItem?.settled ? " positive" : ""}`}
          >
            {!r.active
              ? r.endDate
                ? `Terminé le ${r.endDate}`
                : "En pause"
              : cohortItem
                ? cohortItem.settled
                  ? `${r.kind === "income" ? "Reçu" : "Payé"} le ${
                      cohortItem.settled.date ?? "date inconnue"
                    }${
                      cohortItem.settled.date &&
                      cohortItem.settled.date.slice(0, 7) !== month
                        ? " · hors du mois sélectionné"
                        : ""
                    }`
                  : r.kind === "income"
                    ? "Pas encore reçu"
                    : "Pas encore payé"
                : "Aucune échéance ce mois-ci"}
          </span>
        </div>
        <div className="row-end">
          <div className="row-value">
            {nextDate ? (
              <>
                {display(nextAmount, r.currency)}
                <span className="row-detail">Prochaine échéance : {nextDate}</span>
                {monthlyEquiv !== null && (
                  <span className="row-detail">
                    ≈ {display(monthlyEquiv, r.currency)}/mois
                  </span>
                )}
              </>
            ) : (
              <span className="row-detail">Aucune échéance à venir</span>
            )}
          </div>
          <div className="row-actions">
            {dueTxn && (
              <button className="button small secondary" onClick={() => markSettled(dueTxn)}>
                <Icon name="check" size={16} />
                {r.kind === "income" ? "Marquer reçu" : "Marquer payé"}
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
                <Icon name="refresh" size={17} />
              </button>
            )}
            <button
              className="icon-button"
              aria-label={`Modifier ${r.label}`}
              onClick={() => edit({ type: "recurrence", id: r.id })}
            >
              <Icon name="edit" size={17} />
            </button>
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
          <div className="row-icon">
            <Icon name="target" />
          </div>
          <button
            className="icon-button"
            onClick={() => edit({ type: "goal", id: g.id })}
            aria-label={`Modifier ${g.name}`}
          >
            <Icon name="edit" size={17} />
          </button>
        </div>
        <h3>{g.name}</h3>
        <div className="balance">{display(g.reservedMinor, g.currency)}</div>
        <p className="meta">
          sur {display(g.targetMinor, g.currency)}
          {g.dueDate ? ` · échéance ${g.dueDate}` : ""}
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
          {accountName(g.accountId)} · inclus dans ce compte
        </p>
        <SourceLink source={g.source} />
      </article>
    );
  });
  return (
    <div className="shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate("overview")}>
          <img className="brand-mark" src="./finance.svg" alt="" />
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
            <Icon name="shield" size={15} />
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
              aria-label={
                hidden ? "Afficher les montants" : "Masquer les montants"
              }
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
          <div>
            <p className="eyebrow">VOTRE FINANCE, EN CLAIR</p>
            <h1 className="page-title">
              {page === "overview"
                ? "Une vue sur l’essentiel."
                : currentPage.name}
            </h1>
            <p className="subtitle">
              {page === "overview"
                ? "Vos comptes, votre mois, vos prochains projets."
                : page === "month"
                  ? "Ce qui entre, ce qui sort et ce qui reste à prévoir."
                  : page === "accounts"
                    ? "Chaque compte, avec sa devise et la date de son solde."
                    : page === "subscriptions"
                      ? "Abonnements, factures et charges récurrentes : ce qui est dû ce mois-ci, ce qui est réglé et ce qui reste."
                      : page === "goals"
                        ? "Donnez une place à ce qui compte pour vous."
                        : page === "investments"
                        ? "Vos positions, rattachées à leurs comptes."
                        : "Vos pièces et vos données, à portée de main."}
            </p>
          </div>
          <button
            className="button primary"
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
        </div>
        {demo && (
          <div className="notice demo-notice">
            Démonstration · Tous les montants et établissements sont fictifs.{" "}
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
        {updateReady && (
          <div className="notice" role="status">
            Une nouvelle version de Finance est disponible.{" "}
            <button
              className="text-button"
              onClick={() => window.location.reload()}
            >
              Recharger
            </button>
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
          <span className="meta" aria-live="polite">
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
                    <Icon name="chart" size={15} />
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
                    Détail <Icon name="chevron-right" size={16} />
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
                  <div className="metric-value">
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
                },
                {
                  label: "Abonnements (mensuel)",
                  value: subsMonthlyOverview.totalMinor,
                  meta: `${subsMonthlyOverview.count} actif(s)`,
                },
                {
                  label: "Factures et charges (mensuel)",
                  value: billsMonthlyOverview.totalMinor,
                  meta: `${billsMonthlyOverview.count} actif(s)`,
                },
                {
                  label: "Épargne (mensuel)",
                  value: savingMonthlyOverview.totalMinor,
                  meta: `${savingMonthlyOverview.count} actif(s)`,
                },
              ].map((s) => (
                <div className="stat-card" key={s.label}>
                  <p className="metric-label">{s.label}</p>
                  <div className="metric-value">
                    {s.value !== null ? display(s.value) : "—"}
                  </div>
                  {s.meta && <p className="meta">{s.meta}</p>}
                </div>
              ))}
            </div>
            <div className="section-heading">
              <h2>Vos comptes</h2>
              <button
                className="card-action"
                onClick={() => navigate("accounts")}
              >
                Tous les comptes <Icon name="chevron-right" size={16} />
              </button>
            </div>
            <div className="account-grid">
              {sortedAccounts.slice(0, 3).map(accountCard)}
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
            </div>
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
                title="Prochaines échéances"
                icon="clock"
                action={
                  <button
                    className="card-action"
                    onClick={() => navigate("month")}
                  >
                    Voir tout
                  </button>
                }
              >
                {transactions
                  .filter((t) => t.status === "planned")
                  .slice(0, 4)
                  .map(transactionRow)}
                {!transactions.some((t) => t.status === "planned") && (
                  <div className="empty-state">
                    Aucune échéance connue pour ce mois.
                  </div>
                )}
              </Card>
            </div>
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
          </>
        )}
        {page === "month" && (
          <>
            <div className="stat-grid">
              {[
                { label: "Revenus reçus", v: summary.incomeSettled },
                { label: "Revenus attendus", v: summary.incomePlanned },
                { label: "Dépenses payées", v: summary.expenseSettled },
                { label: "Dépenses prévues", v: summary.expensePlanned },
              ].map((s) => (
                <div className="stat-card" key={s.label}>
                  <p className="metric-label">{s.label}</p>
                  <div className="metric-value">{display(s.v)}</div>
                </div>
              ))}
            </div>
            <div className="two-columns">
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
              <Card title="Projection nette" icon="chart">
                <div className="hero-value compact">
                  {display(summary.remaining)}
                </div>
                <p className="footer-note">
                  Virements internes exclus. Cette projection utilise toutes les
                  entrées et dépenses connues du mois ; elle ne remplace pas les
                  soldes de vos comptes.
                </p>
                {summary.unknownCount > 0 && (
                  <p className="warning">
                    {summary.unknownCount} élément(s) à vérifier.
                  </p>
                )}
              </Card>
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
              {transactions
                .filter((t) => filter === "all" || t.kind === filter)
                .map(transactionRow)}
              {!transactions.length && (
                <div className="empty-state">
                  Aucune opération datée pour ce mois.
                </div>
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
                  Voir tout <Icon name="chevron-right" size={16} />
                </button>
              }
            >
              {data.recurrences
                .filter((r) => r.active)
                .slice(0, 4)
                .map((r) => (
                  <div className="row" key={r.id}>
                    <span
                      className={`row-icon ${recurrenceTypeRowClass[r.recurrenceType]}`}
                    >
                      <Icon name={recurrenceTypeIcons[r.recurrenceType]} />
                    </span>
                    <div className="row-main">
                      <span className="row-title">{r.label}</span>
                      <span className="row-detail">
                        Le {r.day} · tous les {r.intervalMonths} mois
                      </span>
                    </div>
                    <span className="row-value">
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
            <div className="notice">
              Les soldes conservent leur date d’observation. Les opérations du
              mois ne les modifient pas automatiquement.
            </div>
            {data.accounts.length ? (
              <>
                {/* Kept from the briefly-shipped table (see accountCard's comment above) — the
                    total itself was a genuinely useful at-a-glance figure, just not worth a
                    whole dense table for. Same wealthSummary() total the hero card already
                    shows on Accueil, not a second calculation; same "Partiel"/excluded wording
                    too. */}
                <div className="stat-card accounts-total-card">
                  <span className="accounts-total-label">
                    <span className="card-icon">
                      <Icon name="wallet" size={15} />
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
          </>
        )}
        {page === "subscriptions" && (
          <>
            <div className="notice">
              Cohorte d’échéances : ce qui est dû en {monthLabel(month)}, quel
              que soit le mois du règlement. Flux réalisé : ce qui a
              réellement été réglé en {monthLabel(month)}, quelle que soit
              l’échéance d’origine.
            </div>
            <div className="stat-grid">
              {[
                {
                  label: `Dû en ${monthLabel(month)}`,
                  value:
                    subsCohort.dueMinor !== null
                      ? display(subsCohort.dueMinor)
                      : "—",
                },
                {
                  label: `Réglé pour ${monthLabel(month)}`,
                  value:
                    subsCohort.settledMinor !== null
                      ? display(subsCohort.settledMinor)
                      : "—",
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
                  label: "Récurrences actives",
                  value: String(subsCohort.activeCount),
                },
              ].map((s) => (
                <div className="stat-card" key={s.label}>
                  <p className="metric-label">{s.label}</p>
                  <div className="metric-value">{s.value}</div>
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
                  label: `Payé en ${monthLabel(month)}`,
                  value:
                    subsFlow.paidMinor !== null ? display(subsFlow.paidMinor) : "—",
                },
                {
                  label: `Reçu en ${monthLabel(month)}`,
                  value:
                    subsFlow.receivedMinor !== null
                      ? display(subsFlow.receivedMinor)
                      : "—",
                },
              ].map((s) => (
                <div className="stat-card" key={s.label}>
                  <p className="metric-label">{s.label}</p>
                  <div className="metric-value">{s.value}</div>
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
              <label className="currency-picker">
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
          </>
        )}
        {page === "goals" && (
          <>
            <div className="notice">
              Vos réserves font déjà partie de vos comptes. Elles sont suivies
              ici sans augmenter le patrimoine.
            </div>
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
          </>
        )}
        {page === "investments" && (
          <>
            <div className="notice">
              La valeur des positions est datée. Pour chaque compte, Finance
              utilise soit sa valeur totale, soit ses liquidités et ses
              positions.
            </div>
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
                  <div className="row" key={p.id}>
                    <span
                      className="institution-icon"
                      style={{
                        background: monogramColors(p.symbol || p.name).bg,
                        color: monogramColors(p.symbol || p.name).fg,
                      }}
                    >
                      {monogramInitials(p.symbol || p.name)}
                    </span>
                    <div className="row-main">
                      <span className="row-title">
                        {p.name}{" "}
                        <span className="tag">{p.assetType.toUpperCase()}</span>
                      </span>
                      <span className="row-detail">
                        {accountName(p.accountId)} ·{" "}
                        {hidden ? "•••" : p.quantity || "Quantité inconnue"} ·{" "}
                        {p.asOf || "Non daté"}
                      </span>
                    </div>
                    <span className="row-value">
                      {display(p.valueMinor, p.currency)}
                    </span>
                    <button
                      className="icon-button"
                      aria-label={`Modifier ${p.name}`}
                      onClick={() => edit({ type: "position", id: p.id })}
                    >
                      <Icon name="edit" />
                    </button>
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
                      {hidden ? "•••" : `1 ${r.from} = ${r.rate} ${r.to}`} ·{" "}
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
                      {d.addedAt.slice(0, 10)} ·{" "}
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
            ? "Espace de démonstration · exemples fictifs"
            : "Espace privé sur cet appareil"}{" "}
          · Soldes observés, sources conservées.
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
          onClick={() => setMore(!more)}
          className={
            more || !["overview", "month", "accounts"].includes(page)
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
        <div className="mobile-more">
          {pages.slice(3).map((p) => (
            <button
              className="nav-item"
              key={p.id}
              onClick={() => navigate(p.id)}
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
            <img
              src={preview.url}
              alt={preview.name}
              style={{ maxWidth: "100%" }}
            />
          )}
        </dialog>
      )}
    </div>
  );
}
