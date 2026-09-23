import type { ReactNode } from "react";

const paths: Record<string, ReactNode> = {
  home: (
    <>
      <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M7 3v4m10-4v4M3 10h18m-14 4h2m6 0h2m-10 4h2" />
    </>
  ),
  wallet: (
    <>
      <path d="M20 8V6a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14a1 1 0 0 1 1 1v8a2 2 0 0 1-2 2H6a3 3 0 0 1-3-3V7" />
      <path d="M21 14h-5v3h5" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  chart: (
    <>
      <path d="M3 3v17a1 1 0 0 0 1 1h17M7 15l4-5 4 3 6-8" />
      <path d="M17 5h4v4" />
    </>
  ),
  folder: (
    <path d="M3 7V5a2 2 0 0 1 2-2h5l3 4h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  ),
  // 14-unit span both ways (5↔19), matching `close` below — the two are visual opposites
  // (add/remove) shown side by side in places like a dialog header, so they need the same
  // optical weight, not just the same stroke width.
  plus: <path d="M12 5v14M5 12h14" />,
  "arrow-up": <path d="M12 20V4m-6 6 6-6 6 6" />,
  "arrow-down": <path d="M12 4v16m-6-6 6 6 6-6" />,
  transfer: (
    <>
      <path d="M3 7h17m-5-5 5 5-5 5M21 17H4m5-5-5 5 5 5" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  "eye-off": (
    <>
      <path d="m3 3 18 18M10 5.2c.6-.1 1.3-.2 2-.2 6.5 0 10 7 10 7a18 18 0 0 1-3.3 4M6 6.8A20 20 0 0 0 2 12s3.5 7 10 7c1.5 0 3-.4 4.3-1M10 10a3 3 0 0 0 4 4" />
    </>
  ),
  "chevron-right": <path d="m9 5 7 7-7 7" />,
  "chevron-left": <path d="m15 5-7 7 7 7" />,
  // Was a smaller 12-unit diagonal span (6↔18) — visibly lighter than `plus`'s 14-unit
  // reach (5↔19) although the two are meant to read as the same weight (see `plus` above).
  // Widened to the same 5↔19 span so neither looks bigger next to the other.
  close: <path d="m5 5 14 14M5 19 19 5" />,
  check: <path d="m4 12 5 5L20 6" />,
  // 6-unit arrowhead legs, matching arrow-up/arrow-down below — was a narrower 5-unit head,
  // a slightly lighter mark than its plain-arrow counterparts for the same "up"/"down"
  // meaning.
  upload: (
    <>
      <path d="M12 16V3m-6 6 6-6 6 6M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v13m-6-6 6 6 6-6M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="3" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
    </>
  ),
  vault: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="3" />
      <circle cx="12" cy="12.5" r="4" />
      <path d="M12 12.5V9.7" />
    </>
  ),
  settings: (
    <>
      <path d="m9 3-.7 3-2.6 1-2.6-.8L1.8 9l2 2.2v2l-2 2.2 1.3 2.8 2.6-.8 2.6 1L9 21h6l.7-2.6 2.6-1 2.6.8 1.3-2.8-2-2.2v-2l2-2.2-1.3-2.8-2.6.8-2.6-1L15 3Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  bank: (
    <>
      <path d="m3 7 9-5 9 5v2H3V7Zm1 14h16M5 12v6m7-6v6m7-6v6" />
    </>
  ),
  shield: (
    <>
      <path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  // Solid dots, not stroked rings: at r=1 the shared 1.65 strokeWidth (below) happened to
  // nearly close the ring's own hole, but that read as a solid dot only by coincidence of
  // those two numbers — explicit fill/no-stroke here makes it an actual filled dot,
  // independent of the svg's global stroke settings.
  more: (
    <>
      <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  logout: (
    <>
      <path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4m5-13 5 5-5 5m-6-5h15" />
    </>
  ),
  document: (
    <>
      <path d="M14 3H5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9Z" />
      <path d="M14 3v6h6M8 13h8m-8 4h5" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 8a8 8 0 0 0-13-4L3 8m0-5v5h5M4 16a8 8 0 0 0 13 4l4-4m0 5v-5h-5" />
    </>
  ),
  alert: (
    <>
      <path d="m10.3 3.5-8 14A2 2 0 0 0 4 20h16a2 2 0 0 0 1.7-2.5l-8-14a2 2 0 0 0-3.4 0Z" />
      <path d="M12 8v5m0 3v.5" />
    </>
  ),
  edit: (
    <>
      <path d="m14 5 5 5M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15Z" />
    </>
  ),
  // identite-ui.md suggests a clock/horloge for "à payer" — added for card headers about
  // upcoming due dates ("Prochaines échéances"), same 24×24 stroke grid as the rest.
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  // Account.kind === "debt": same axis frame as `chart` (mirrors its meaning — investment
  // trends up, debt trends down), with the trend line and corner marker flipped to the
  // bottom-right instead of the top-right. No existing icon fit "debt" without forcing an
  // unrelated metaphor, so this is the one new glyph this lot adds (identite-ui.md: add a
  // new icon only when nothing already in the set fits).
  debt: (
    <>
      <path d="M3 3v17a1 1 0 0 0 1 1h17M7 9l4 5 4-3 6 8" />
      <path d="M17 19h4v-4" />
    </>
  ),
};

export type IconName = keyof typeof paths;
export function Icon({
  name,
  size = 20,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {paths[name] ?? paths.wallet}
    </svg>
  );
}
