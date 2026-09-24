import type { FinanceData } from "../domain/types";
import { dateLabel, money, wealthSummary } from "../domain/finance";
// SVG attributes cannot read CSS variables reliably: keep ACCENT equal to --accent (index.css).
const ACCENT = "#A8BCE8";
// En dessous, une mini-courbe se réduit à un trait isolé qui ne montre aucune tendance.
export const SPARKLINE_MIN_POINTS = 3;
export function Sparkline({
  id,
  points,
}: {
  id: string;
  points: { asOf: string; amountMinor: number }[];
}) {
  if (points.length < SPARKLINE_MIN_POINTS) return null;
  const values = points.map((p) => p.amountMinor);
  const low = Math.min(...values),
    range = Math.max(...values) - low || 1;
  const coords = points.map((p, i) => ({
    x: 2 + (i * 68) / (points.length - 1),
    y: 21 - ((p.amountMinor - low) / range) * 17,
  }));
  const first = coords[0],
    last = coords[coords.length - 1];
  const line = coords.map((c) => `${c.x},${c.y}`).join(" ");
  const area = `M${first.x},24 ${coords.map((c) => `L${c.x},${c.y}`).join(" ")} L${last.x},24 Z`;
  const gradientId = `sparkline-${id.replace(/[^\w-]/g, "_")}`;
  return (
    <svg
      className="account-sparkline"
      viewBox="0 0 72 24"
      width="72"
      height="24"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Tendance du solde : ${points.length} soldes datés, du ${points[0].asOf} au ${points[points.length - 1].asOf}`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={ACCENT} stopOpacity="0.18" />
          <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <polyline
        points={line}
        fill="none"
        stroke={ACCENT}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={`M${last.x},${last.y}h0`}
        stroke={ACCENT}
        strokeWidth="4"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
// Liées aux rangées en % de .wealth-scale (index.css) : 20/140, 100/140, 20/140.
const WEALTH_HEIGHT = 140,
  PLOT_TOP = 20,
  PLOT_BOTTOM = 120;
// Pas rond (1, 2, 2,5 ou 5 × 10ⁿ unités mineures) au moins égal à `raw`.
function niceStep(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5].find((m) => m * power >= raw) ?? 10) * power;
}
// La devise figure déjà dans le patrimoine affiché juste au-dessus.
const scaleNumber = new Intl.NumberFormat("fr-CH", {
  maximumFractionDigits: 2,
});
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
  // La marge ne fait pas franchir zéro à une série entièrement positive (ou négative).
  const bottom = low >= 0 ? Math.max(0, low - padding) : low - padding,
    top = high < 0 ? Math.min(0, high + padding) : high + padding;
  // Bornes arrondies à un pas rond : chaque étiquette est la valeur exacte de sa ligne.
  const step = niceStep((top - bottom) / 10),
    min = Math.floor(bottom / step) * step,
    max = Math.ceil(top / step) * step,
    range = max - min;
  const segments = points.map((p, i) =>
    p.totalMinor === null
      ? null
      : {
          x: 8 + (i * 584) / (points.length - 1),
          y:
            PLOT_BOTTOM -
            ((p.totalMinor - min) / range) * (PLOT_BOTTOM - PLOT_TOP),
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
  // Fermée sur la ligne basse : un solde manquant coupe l'aire comme la courbe.
  let areaPath = "";
  let areaPen = false;
  let areaStartX: number | null = null;
  let areaLastX: number | null = null;
  segments.forEach((p) => {
    if (!p) {
      if (areaPen && areaLastX !== null)
        areaPath += `L${areaLastX},${PLOT_BOTTOM} `;
      areaPen = false;
      return;
    }
    if (!areaPen) {
      if (areaStartX !== null) areaPath += `L${areaStartX},${PLOT_BOTTOM} Z `;
      areaPath += `M${p.x},${PLOT_BOTTOM} L${p.x},${p.y} `;
      areaStartX = p.x;
    } else {
      areaPath += `L${p.x},${p.y} `;
    }
    areaLastX = p.x;
    areaPen = true;
  });
  if (areaPen && areaStartX !== null && areaLastX !== null)
    areaPath += `L${areaLastX},${PLOT_BOTTOM} L${areaStartX},${PLOT_BOTTOM} Z`;
  return (
    <>
      <div className="wealth-chart">
        <svg
          className="chart"
          viewBox={`0 0 600 ${WEALTH_HEIGHT}`}
          role="img"
          aria-label={`Évolution des soldes datés, échelle de ${money(min, currency)} à ${money(max, currency)}, montants détaillés ci-dessous`}
        >
          {[PLOT_TOP, (PLOT_TOP + PLOT_BOTTOM) / 2, PLOT_BOTTOM].map((y) => (
            <line
              key={y}
              x1="8"
              x2="592"
              y1={y}
              y2={y}
              stroke="currentColor"
              strokeOpacity="0.06"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <defs>
            <linearGradient
              id="wealth-area-gradient"
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={ACCENT} stopOpacity="0.22" />
              <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
            </linearGradient>
          </defs>
          {areaPath && <path d={areaPath} fill="url(#wealth-area-gradient)" />}
          <path
            d={path}
            fill="none"
            stroke={ACCENT}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Zero-length round-capped strokes: dots stay r=2.5 px whatever the chart's scale. */}
          {segments.map(
            (p, i) =>
              p && (
                <path
                  key={i}
                  d={`M${p.x},${p.y}h0`}
                  stroke={ACCENT}
                  strokeWidth="5"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ),
          )}
        </svg>
        <div className="wealth-scale" aria-hidden="true">
          <span className="wealth-scale-max">
            {scaleNumber.format(max / 100)}
          </span>
          <span className="wealth-scale-min">
            {scaleNumber.format(min / 100)}
          </span>
        </div>
        {/* Rapproché de l'axe et limité à la largeur de la courbe. */}
        <div className="hero-foot">
          <span>{dateLabel(dates[0])}</span>
          <span>{dateLabel(dates.at(-1) as string)}</span>
        </div>
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
