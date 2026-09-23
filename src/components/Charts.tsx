import type { FinanceData } from "../domain/types";
import { dateLabel, money, wealthSummary } from "../domain/finance";
// Muted, desaturated qualitative set — reuses the same tightened hue family as the
// account kind-badges (index.css) instead of the old saturated blue/violet pair, so the
// wealth-allocation donut doesn't reintroduce the neon blue-violet look on its own.
const colors = ["#7fcba8", "#c9a86c", "#8fabc9", "#c3a8d9", "#8ec9c2"];
export function WealthChart({
  data,
  currency,
  hidden,
}: {
  data: FinanceData;
  currency: string;
  hidden: boolean;
}) {
  const dates = [
    ...new Set(
      data.accounts.flatMap((a) =>
        a.balances.flatMap((b) => (b.asOf ? [b.asOf] : [])),
      ),
    ),
  ]
    .sort()
    .slice(-8);
  const points = dates.map((date) => ({
    date,
    ...wealthSummary(data, currency, date),
  }));
  if (hidden) return <div className="chart-empty">Montants masqués</div>;
  if (points.length < 2)
    return (
      <div className="chart-empty">
        Votre courbe se dessinera au fil des soldes datés.
      </div>
    );
  const valid = points.filter((p) => p.totalMinor !== null);
  const values = valid.map((p) => p.totalMinor as number);
  if (values.length < 2)
    return (
      <div className="chart-empty">
        Deux observations datées sont nécessaires.
      </div>
    );
  const low = Math.min(...values),
    high = Math.max(...values),
    padding = Math.max((high - low) * 0.12, Math.abs(high) * 0.03, 100);
  const min = low - padding,
    max = high + padding,
    range = max - min;
  const segments = points.map((p, i) =>
    p.totalMinor === null
      ? null
      : {
          x: 8 + (i * 584) / (points.length - 1),
          y: 126 - ((p.totalMinor - min) / range) * 104,
        },
  );
  let path = "";
  let pen = false;
  segments.forEach((p) => {
    if (!p) {
      pen = false;
      return;
    }
    path += `${pen ? "L" : "M"}${p.x},${p.y} `;
    pen = true;
  });
  // Area fill reuses the exact same `segments` already built for the line above — no
  // second data pass — closed down to the chart's own baseline (y="126", the same value
  // the line's own y is computed against) rather than the SVG's bottom edge, so a partial
  // gap in dated balances (a null segment, pen lifted) breaks the area the same place it
  // breaks the line instead of the fill bridging over the gap.
  let areaPath = "";
  let areaPen = false;
  let areaStartX: number | null = null;
  let areaLastX: number | null = null;
  segments.forEach((p) => {
    if (!p) {
      if (areaPen && areaLastX !== null) areaPath += `L${areaLastX},126 `;
      areaPen = false;
      return;
    }
    if (!areaPen) {
      if (areaStartX !== null) areaPath += `L${areaStartX},126 Z `;
      areaPath += `M${p.x},126 L${p.x},${p.y} `;
      areaStartX = p.x;
    } else {
      areaPath += `L${p.x},${p.y} `;
    }
    areaLastX = p.x;
    areaPen = true;
  });
  if (areaPen && areaStartX !== null && areaLastX !== null)
    areaPath += `L${areaLastX},126 L${areaStartX},126 Z`;
  return (
    <>
      <svg
        className="chart"
        viewBox="0 0 600 155"
        role="img"
        aria-label="Évolution des soldes datés, montants détaillés ci-dessous"
      >
        {[30, 75, 120].map((y) => (
          <line
            key={y}
            x1="8"
            x2="592"
            y1={y}
            y2={y}
            stroke="currentColor"
            opacity=".1"
          />
        ))}
        {/* Blue accent (verre + bleu néon lot 3/3), matching --accent (index.css) — SVG
            presentation attributes here use a literal hex rather than var(--accent), same
            convention already used by the Allocation donut's own `colors` array below, so
            this must be kept in sync if --accent's value ever changes. Gradient fill is new
            in this lot; the stroke/dot color itself is also recolored here from the old
            flat mint (#7fcba8, a leftover from the earlier neutral pass that this chart's
            hardcoded hex never picked up when index.css's --accent went blue at lot 1). */}
        <defs>
          <linearGradient id="wealth-area-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4f8cff" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#4f8cff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {areaPath && <path d={areaPath} fill="url(#wealth-area-gradient)" />}
        <path
          d={path}
          fill="none"
          stroke="#4f8cff"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {segments.map(
          (p, i) =>
            p && <circle key={i} cx={p.x} cy={p.y} r="4" fill="#4f8cff" />,
        )}
      </svg>
      <div className="hero-foot">
        <span>{dateLabel(dates[0])}</span>
        <span>{dateLabel(dates.at(-1) as string)}</span>
      </div>
      <details className="chart-details">
        <summary>Voir les valeurs exactes</summary>
        {points.map((p) => (
          <div className="row" key={p.date}>
            <span>
              {dateLabel(p.date)}
              {p.partial ? " · partiel" : ""}
            </span>
            <span>{money(p.totalMinor, currency)}</span>
          </div>
        ))}
      </details>
    </>
  );
}
export function Allocation({
  items,
  currency,
  hidden,
}: {
  items: { name: string; value: number }[];
  currency: string;
  hidden: boolean;
}) {
  const positive = items.filter((i) => i.value > 0);
  const total = positive.reduce((s, i) => s + i.value, 0);
  if (hidden) return <div className="chart-empty">Montants masqués</div>;
  if (!total)
    return (
      <div className="empty-state">
        La répartition apparaîtra avec vos soldes datés.
      </div>
    );
  let offset = 0;
  return (
    <div className="donut-layout">
      <svg
        className="donut"
        viewBox="0 0 160 160"
        role="img"
        aria-label="Répartition des actifs positifs"
      >
        <circle
          cx="80"
          cy="80"
          r="64"
          fill="none"
          stroke="#242735"
          strokeWidth="13"
        />
        {positive.map((i, n) => {
          const part = (i.value / total) * 402.12;
          const element = (
            <circle
              key={i.name}
              cx="80"
              cy="80"
              r="64"
              fill="none"
              stroke={colors[n % colors.length]}
              strokeWidth="13"
              strokeDasharray={`${Math.max(0, part - 3)} ${402.12 - Math.max(0, part - 3)}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 80 80)"
              strokeLinecap="round"
            />
          );
          offset += part;
          return element;
        })}
        <text
          x="80"
          y="76"
          textAnchor="middle"
          fill="#f4f6ff"
          fontSize="24"
          fontWeight="600"
        >
          {positive.length}
        </text>
        <text x="80" y="96" textAnchor="middle" fill="#a9adbd" fontSize="11">
          comptes
        </text>
      </svg>
      <div className="legend">
        {positive.map((i, n) => (
          <div className="legend-item" key={i.name}>
            <span
              style={{ background: colors[n % colors.length] }}
              className="status-dot"
            />
            <div>
              {i.name}
              <small>
                {money(i.value, currency)} ·{" "}
                {((i.value / total) * 100).toFixed(1)} %
              </small>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
export function FlowChart({
  income,
  expense,
  currency,
  hidden,
}: {
  income: number | null;
  expense: number | null;
  currency: string;
  hidden: boolean;
}) {
  if (hidden) return <div className="chart-empty">Montants masqués</div>;
  const max = Math.max(income || 0, expense || 0, 1);
  return (
    <div className="flow-chart">
      {/* Income/expense direction reuses the app's existing positive/negative status
          colors instead of the old blue/violet pair — these two bars ARE a received vs.
          paid-out split, so the same green/red language used everywhere else applies
          here too, rather than a third, unrelated color meaning. */}
      {[
        {
          label: "Entrées prévues et reçues",
          n: income,
          color: "#8adebc",
          glow: "rgba(138, 222, 188, .45)",
        },
        {
          label: "Dépenses prévues et payées",
          n: expense,
          color: "#ffa0ac",
          glow: "rgba(255, 160, 172, .45)",
        },
      ].map((i) => (
        <div key={i.label}>
          <div className="hero-foot">
            <span>{i.label}</span>
            <strong>{money(i.n, currency)}</strong>
          </div>
          <div className="progress">
            {/* Glow lit lot 3/3 — derived from this bar's OWN status color (income/expense),
                never the interactive accent: these bars carry received-vs-paid meaning, not
                a selection, so they keep the app's existing rule of never repainting a
                status color with the accent hue. */}
            <div
              className="progress-fill"
              style={{
                width: `${((i.n || 0) / max) * 100}%`,
                background: i.color,
                boxShadow: `0 0 10px -1px ${i.glow}`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
