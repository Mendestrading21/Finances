import { useEffect, useRef } from "react";
import { Icon } from "./Icon";

// Explicit short labels, not a naive slice(0, 3): "Juin"/"Juillet" would both truncate to
// "Jui", making them indistinguishable in the compact row. The full name is still the
// button's accessible name (aria-label), read by assistive tech regardless of the display.
const MONTHS = [
  { name: "Janvier", short: "Jan" },
  { name: "Février", short: "Fév" },
  { name: "Mars", short: "Mar" },
  { name: "Avril", short: "Avr" },
  { name: "Mai", short: "Mai" },
  { name: "Juin", short: "Jun" },
  { name: "Juillet", short: "Jul" },
  { name: "Août", short: "Aoû" },
  { name: "Septembre", short: "Sep" },
  { name: "Octobre", short: "Oct" },
  { name: "Novembre", short: "Nov" },
  { name: "Décembre", short: "Déc" },
];

/** Compact French Janvier–Décembre row plus a separate year control, replacing a daily
 * calendar for changing month (see amelioration-v2.md "Sélecteur de période"). The canonical
 * value stays `YYYY-MM` in the caller's state; the French name is presentation only. */
export function MonthPicker({
  month,
  onChange,
  currentMonth,
}: {
  month: string;
  onChange: (month: string) => void;
  /** `YYYY-MM` of the real current month, for the "Ce mois-ci" shortcut. */
  currentMonth: string;
}) {
  const year = Number(month.slice(0, 4)),
    monthNumber = Number(month.slice(5, 7));
  const withMonth = (targetMonth: number, targetYear = year) =>
    `${String(targetYear).padStart(4, "0")}-${String(targetMonth).padStart(2, "0")}`;
  const activeChip = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // The row scrolls on narrow screens (see .month-row); without this the highlighted
    // month can load, or end up, off-screen, defeating "le mois sélectionné en évidence".
    // Also reruns on resize: a container that fit everything (e.g. a wide window) can
    // start overflowing after the window narrows or a tablet rotates, without `month`
    // itself changing to retrigger this effect on its own.
    const scroll = () =>
      activeChip.current?.scrollIntoView({ block: "nearest", inline: "center" });
    scroll();
    window.addEventListener("resize", scroll);
    return () => window.removeEventListener("resize", scroll);
  }, [month]);
  return (
    <div className="month-picker-v2">
      {/* Year stepper and month strip share one surface (.month-nav-bar) instead of each
       * drawing their own border/background side by side — two adjacent boxed chiclets
       * previously read as a small stack of nested cards rather than one date control. */}
      <div className="month-nav-bar">
        <div className="year-control">
          <button
            type="button"
            className="icon-button month-nav-button"
            aria-label="Année précédente"
            onClick={() => onChange(withMonth(monthNumber, year - 1))}
          >
            <Icon name="chevron-left" size={16} />
          </button>
          <strong>{year}</strong>
          <button
            type="button"
            className="icon-button month-nav-button"
            aria-label="Année suivante"
            onClick={() => onChange(withMonth(monthNumber, year + 1))}
          >
            <Icon name="chevron-right" size={16} />
          </button>
        </div>
        <div className="month-row" role="group" aria-label="Choisir un mois">
          {MONTHS.map(({ name, short }, index) => {
            const value = withMonth(index + 1);
            return (
              <button
                type="button"
                key={value}
                ref={value === month ? activeChip : undefined}
                className={`month-chip ${value === month ? "active" : ""}`}
                aria-label={name}
                aria-pressed={value === month}
                onClick={() => onChange(value)}
              >
                {short}
              </button>
            );
          })}
        </div>
      </div>
      {month !== currentMonth && (
        <button
          type="button"
          className="button small secondary"
          onClick={() => onChange(currentMonth)}
        >
          Ce mois-ci
        </button>
      )}
    </div>
  );
}
