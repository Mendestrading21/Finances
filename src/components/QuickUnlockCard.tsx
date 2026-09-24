import { useEffect, useState, type FormEvent } from "react";
import {
  disableQuickUnlock,
  enableQuickUnlock,
  quickUnlockEnabled,
  quickUnlockSupported,
} from "../quickUnlock";
import { Icon } from "./Icon";

/** Face ID, empreinte ou Windows Hello à la place de la phrase secrète, sur cet appareil seulement. */
export function QuickUnlockCard({ demo }: { demo: boolean }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(quickUnlockEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void quickUnlockSupported().then((value) => {
      if (alive) setSupported(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  async function enable(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const form = e.currentTarget;
    try {
      await enableQuickUnlock(String(new FormData(form).get("password") || ""));
      form.reset();
      setEnabled(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Activation impossible.");
    } finally {
      setBusy(false);
    }
  }
  function disable() {
    setError("");
    try {
      disableQuickUnlock();
      setEnabled(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Désactivation impossible.");
      setEnabled(quickUnlockEnabled());
    }
  }
  if (demo)
    return (
      <p className="footer-note">
        Disponible une fois votre coffre ouvert.
      </p>
    );
  if (supported === null) return <p className="meta">Vérification de cet appareil…</p>;
  if (!supported)
    return (
      <p className="meta">
        Face ID, l’empreinte ou Windows Hello ne sont pas disponibles pour Finance
        sur cet appareil ou ce navigateur. La phrase secrète reste nécessaire.
      </p>
    );
  if (enabled)
    return (
      <div className="quick-unlock">
        <p className="sync-status sync-ok" role="status">
          <Icon name="check" size={16} />
          <span>
            Activé sur cet appareil : l’écran d’accès propose Face ID ou
            l’empreinte.
          </span>
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="action-row">
          <button className="button secondary" onClick={disable}>
            <Icon name="close" />
            Désactiver sur cet appareil
          </button>
        </div>
      </div>
    );
  return (
    <form className="quick-unlock" onSubmit={enable}>
      <p className="footer-note">
        Déverrouillez Finance d’un regard ou d’un doigt au lieu de taper la
        phrase secrète. Elle reste chiffrée sur cet appareil, protégée par Face
        ID, l’empreinte, Windows Hello ou le code de l’appareil : à activer
        seulement sur vos appareils personnels, un par un.
      </p>
      <label className="field">
        <span>Phrase secrète</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="action-row">
        <button className="button primary" disabled={busy}>
          <Icon name="lock" />
          {busy ? "Activation…" : "Activer Face ID ou l’empreinte"}
        </button>
      </div>
    </form>
  );
}
