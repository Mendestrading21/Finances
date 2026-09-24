import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "./Icon";

// Explicit short labels, not a naive slice(0, 3): "Juin"/"Juillet" would both truncate to
// "Jui", making them indistinguishable in the compact grid. The full name is still each
// cell's accessible name (aria-label), read by assistive tech regardless of the display.
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

/**
 * Compact "Septembre 2026" trigger that opens a small month grid, replacing the old
 * always-visible 12-chip scrolling strip (see amelioration-v2.md "Sélecteur de période").
 * The strip read as one merged, cramped bar at any width; a single labelled button plus a
 * popover is the same pattern a native date control already uses, stays legible down to
 * 360px, and needs no horizontal scroll or edge-fade mask. The canonical value stays
 * `YYYY-MM` in the caller's state; French names are presentation only.
 *
 * Disclosure pattern (WAI-ARIA APG "Disclosure (Show/Hide)"): the trigger owns
 * `aria-expanded`/`aria-controls`, and opening it does NOT move focus into the panel —
 * focus stays on the trigger so a keyboard/screen-reader user keeps their place and can Tab
 * into the revealed grid at their own pace. Escape and an outside click both close the
 * panel; Escape also returns focus to the trigger.
 */
export function MonthPicker({
  month,
  onChange,
  currentMonth,
}: {
  month: string;
  onChange: (month: string) => void;
  /** `YYYY-MM` of the real current month, for the "Ce mois-ci" shortcut and the panel's
   * "today" marker. */
  currentMonth: string;
}) {
  const year = Number(month.slice(0, 4)),
    monthNumber = Number(month.slice(5, 7));
  const currentYear = Number(currentMonth.slice(0, 4)),
    currentMonthNumber = Number(currentMonth.slice(5, 7));
  const withMonth = (targetMonth: number, targetYear: number) =>
    `${String(targetYear).padStart(4, "0")}-${String(targetMonth).padStart(2, "0")}`;

  const [open, setOpen] = useState(false);
  // Year shown inside the panel while browsing, kept separate from `year` (the committed
  // selection) so stepping through years to look around never itself changes `month` — only
  // clicking a month cell calls onChange. Reset to the committed year every time the panel
  // opens, in `openPanel` below.
  const [panelYear, setPanelYear] = useState(year);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    // Closes on any pointer interaction outside the trigger/panel, the same dismissal a
    // native <select> or the app's own dialogs use. mousedown (not click) so the closing
    // interaction can't also register as a click on whatever is now underneath it.
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const openPanel = () => {
    setPanelYear(year);
    setOpen(true);
  };
  const selectMonth = (value: string) => {
    onChange(value);
    setOpen(false);
    triggerRef.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && open) {
      // Only swallow Escape when it was actually ours to handle, so a panel that isn't
      // open never blocks Escape meant for something else (e.g. a dialog further up).
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <div className="month-picker-v2">
      <div className="month-picker" ref={rootRef} onKeyDown={onKeyDown}>
        <button
          type="button"
          ref={triggerRef}
          className="month-picker-trigger"
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`Changer de mois, actuellement ${MONTHS[monthNumber - 1].name} ${year}`}
          onClick={() => (open ? setOpen(false) : openPanel())}
        >
          <Icon name="calendar" size={18} className="month-picker-trigger-icon" />
          <span className="month-picker-trigger-label">
            {MONTHS[monthNumber - 1].name} {year}
          </span>
          <Icon name="chevron-right" size={18} className="month-picker-caret" />
        </button>
        {open && (
          <div id={panelId} className="month-picker-panel">
            <div className="month-picker-panel-year">
              <button
                type="button"
                className="icon-button month-picker-year-button"
                aria-label="Année précédente"
                onClick={() => setPanelYear((y) => y - 1)}
              >
                <Icon name="chevron-left" size={18} />
              </button>
              <strong className="month-picker-year-label">{panelYear}</strong>
              <button
                type="button"
                className="icon-button month-picker-year-button"
                aria-label="Année suivante"
                onClick={() => setPanelYear((y) => y + 1)}
              >
                <Icon name="chevron-right" size={18} />
              </button>
            </div>
            <div className="month-picker-grid" role="group" aria-label="Choisir un mois">
              {MONTHS.map(({ name, short }, index) => {
                const value = withMonth(index + 1, panelYear);
                const isSelected = value === month;
                const isToday =
                  panelYear === currentYear && index + 1 === currentMonthNumber;
                return (
                  <button
                    type="button"
                    key={value}
                    className={`month-picker-cell${isSelected ? " active" : ""}${
                      isToday ? " today" : ""
                    }`}
                    aria-label={`${name} ${panelYear}`}
                    aria-pressed={isSelected}
                    aria-current={isToday ? "date" : undefined}
                    onClick={() => selectMonth(value)}
                  >
                    {short}
                  </button>
                );
              })}
            </div>
          </div>
        )}
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
