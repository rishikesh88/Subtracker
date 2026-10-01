/**
 * The admin console's two pages, as complete HTML documents.
 *
 * Server-rendered rather than React on purpose: the console has its own
 * session and must not depend on, or ship inside, the app's client bundle.
 * That rules out importing the project's actual ShadCN components, so the
 * styling below reproduces their contract by hand -- the same semantic HSL
 * tokens (--background, --muted-foreground, --border, --destructive), the same
 * Table anatomy (h-12 header cells, p-4 body cells, border-b rows in a rounded
 * bordered container), and the same radius and spacing scale. Nothing here
 * uses a raw palette colour or a one-off pixel value.
 *
 * There is no build step, so there is no Tailwind. The classes are written as
 * plain CSS against those tokens instead.
 */

/** Everything interpolated from a caller goes through this. */
function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const baseStyles = `
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 72.2% 50.6%;
    --destructive-foreground: 210 40% 98%;
    --success: 142 72% 29%;
    --warning: 32 95% 34%;
    --info: 243 75% 59%;
    --radius: 0.5rem;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --background: 222.2 84% 4.9%;
      --foreground: 210 40% 98%;
      --card: 222.2 84% 4.9%;
      --muted: 217.2 32.6% 17.5%;
      --muted-foreground: 215 20.2% 65.1%;
      --border: 217.2 32.6% 17.5%;
      --input: 217.2 32.6% 17.5%;
      --ring: 212.7 26.8% 83.9%;
      --primary: 210 40% 98%;
      --primary-foreground: 222.2 47.4% 11.2%;
      --accent: 217.2 32.6% 17.5%;
      --accent-foreground: 210 40% 98%;
      --destructive: 0 62.8% 50%;
      --destructive-foreground: 210 40% 98%;
      --success: 142 64% 52%;
      --warning: 38 92% 60%;
      --info: 234 89% 74%;
    }
  }

  *, *::before, *::after { box-sizing: border-box; }

  body {
    margin: 0;
    background: hsl(var(--background));
    color: hsl(var(--foreground));
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 0.875rem;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  h1, h2, h3 { margin: 0; font-weight: 600; letter-spacing: -0.01em; }
  h1 { font-size: 1.125rem; }
  h2 { font-size: 1rem; }
  h3 { font-size: 0.875rem; }

  .muted { color: hsl(var(--muted-foreground)); }
  .num { font-variant-numeric: tabular-nums; }
  .nowrap { white-space: nowrap; }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
  }

  /* --- Button ------------------------------------------------------------ */
  .btn {
    display: inline-flex; align-items: center; justify-content: center;
    gap: 0.5rem;
    height: 2.25rem; padding: 0 0.75rem;
    border-radius: calc(var(--radius) - 2px);
    border: 1px solid transparent;
    font: inherit; font-size: 0.875rem; font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: background-color .15s, color .15s, border-color .15s;
  }
  .btn:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px hsl(var(--background)), 0 0 0 4px hsl(var(--ring));
  }
  .btn:disabled { pointer-events: none; opacity: .5; }

  .btn-outline {
    border-color: hsl(var(--input));
    background: hsl(var(--background));
    color: hsl(var(--foreground));
  }
  .btn-outline:hover { background: hsl(var(--accent)); color: hsl(var(--accent-foreground)); }

  .btn-primary { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); }
  .btn-primary:hover { background: hsl(var(--primary) / .9); }

  .btn-destructive { background: hsl(var(--destructive)); color: hsl(var(--destructive-foreground)); }
  .btn-destructive:hover { background: hsl(var(--destructive) / .9); }

  .btn-ghost { background: transparent; color: hsl(var(--foreground)); }
  .btn-ghost:hover { background: hsl(var(--accent)); }

  .btn-sm { height: 2rem; padding: 0 0.625rem; font-size: 0.8125rem; }

  /* --- Input ------------------------------------------------------------- */
  .input {
    display: block; width: 100%;
    height: 2.25rem; padding: 0 0.75rem;
    border: 1px solid hsl(var(--input));
    border-radius: calc(var(--radius) - 2px);
    background: hsl(var(--background));
    color: hsl(var(--foreground));
    font: inherit; font-size: 0.875rem;
  }
  .input::placeholder { color: hsl(var(--muted-foreground)); }
  .input:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px hsl(var(--background)), 0 0 0 4px hsl(var(--ring));
  }
  .label {
    display: block; margin-bottom: 0.375rem;
    font-size: 0.875rem; font-weight: 500;
  }

  /* --- Card -------------------------------------------------------------- */
  .card {
    background: hsl(var(--card));
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius);
  }
  .card-header { padding: 1rem 1.25rem; border-bottom: 1px solid hsl(var(--border)); }
  .card-body { padding: 1.25rem; }

  /* --- Table (ShadCN anatomy) -------------------------------------------- */
  .table-container {
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius);
    background: hsl(var(--card));
    overflow: hidden;
  }
  .table-scroll { width: 100%; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; caption-side: bottom; }
  thead tr { border-bottom: 1px solid hsl(var(--border)); }
  th {
    height: 3rem; padding: 0 1rem;
    text-align: left; vertical-align: middle;
    font-weight: 500; font-size: 0.8125rem;
    color: hsl(var(--muted-foreground));
    white-space: nowrap;
  }
  td { padding: 1rem; vertical-align: middle; }
  tbody tr { border-bottom: 1px solid hsl(var(--border)); }
  tbody tr:last-child { border-bottom: 0; }
  tbody tr.row-link { cursor: pointer; }
  tbody tr.row-link:hover { background: hsl(var(--muted) / .5); }

  .cell-title { font-weight: 500; }
  .cell-sub { font-size: 0.8125rem; color: hsl(var(--muted-foreground)); }

  /* --- Badge ------------------------------------------------------------- */
  .badge {
    display: inline-flex; align-items: center;
    padding: 0.125rem 0.5rem;
    border: 1px solid transparent;
    border-radius: 9999px;
    font-size: 0.75rem; font-weight: 500;
    white-space: nowrap;
  }
  .badge-muted { background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); }
  .badge-success { background: hsl(var(--success) / .12); color: hsl(var(--success)); }
  .badge-warning { background: hsl(var(--warning) / .12); color: hsl(var(--warning)); }
  .badge-destructive { background: hsl(var(--destructive) / .12); color: hsl(var(--destructive)); }
  .badge-info { background: hsl(var(--info) / .12); color: hsl(var(--info)); }
  /* A leading dot, for a state rather than a label (a feature's rollout). */
  .badge-dot::before {
    content: ""; width: 0.4375rem; height: 0.4375rem; margin-right: 0.375rem;
    border-radius: 9999px; background: currentColor;
  }

  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8125rem;
    background: hsl(var(--muted));
    padding: 0.125rem 0.375rem;
    border-radius: 4px;
    overflow-wrap: anywhere;
  }

  /* --- Layout ------------------------------------------------------------ */
  .topbar {
    position: sticky; top: 0; z-index: 10;
    display: flex; align-items: center; justify-content: space-between;
    gap: 1rem;
    height: 3.5rem; padding: 0 1.5rem;
    background: hsl(var(--background) / .9);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid hsl(var(--border));
  }
  .topbar-left { display: flex; align-items: center; gap: 1.5rem; min-width: 0; }
  .topbar-right { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }

  /* --- Top nav ----------------------------------------------------------- */
  .nav { display: flex; gap: 0.25rem; }
  .nav a {
    display: inline-flex; align-items: center;
    height: 2rem; padding: 0 0.625rem;
    border-radius: calc(var(--radius) - 2px);
    font-size: 0.8125rem; font-weight: 500;
    color: hsl(var(--muted-foreground));
    text-decoration: none;
  }
  .nav a:hover { color: hsl(var(--foreground)); }
  .nav a[aria-current="page"] { background: hsl(var(--muted)); color: hsl(var(--foreground)); }
  .nav a:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px hsl(var(--background)), 0 0 0 4px hsl(var(--ring));
  }
  .topbar-email {
    font-size: 0.8125rem; color: hsl(var(--muted-foreground));
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  /* Small and out of the way, but always there: it answers "is what I am
     looking at the version I just deployed?" without opening devtools. */
  .topbar-build {
    font-size: 0.75rem; color: hsl(var(--muted-foreground));
    font-variant-numeric: tabular-nums; white-space: nowrap;
  }
  main { max-width: 72rem; margin: 0 auto; padding: 1.5rem; }
  .stack { display: flex; flex-direction: column; gap: 1.5rem; }
  .section { display: flex; flex-direction: column; gap: 0.75rem; }

  /* --- Stat cards -------------------------------------------------------- */
  /* Two rows of four, so eight figures fill the grid exactly rather than
     leaving a ragged pair on the second line. */
  .stats {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
  }
  @media (min-width: 40rem) { .stats { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
  .stat { padding: 0.875rem 1rem; }
  .stat-value { font-size: 1.5rem; font-weight: 600; line-height: 1.2; font-variant-numeric: tabular-nums; }
  .stat-label { margin-top: 0.125rem; font-size: 0.8125rem; color: hsl(var(--muted-foreground)); }
  .stat-value.is-warning { color: hsl(var(--warning)); }
  .stat-value.is-destructive { color: hsl(var(--destructive)); }

  /* --- Status banner ----------------------------------------------------- */
  .alert {
    padding: 0.75rem 1rem;
    border: 1px solid hsl(var(--border));
    border-radius: calc(var(--radius) - 2px);
    font-size: 0.875rem;
  }
  .alert-success { border-color: hsl(var(--success) / .4); background: hsl(var(--success) / .08); }
  .alert-error {
    border-color: hsl(var(--destructive) / .4);
    background: hsl(var(--destructive) / .08);
    color: hsl(var(--destructive));
  }

  .empty {
    padding: 2.5rem 1rem; text-align: center;
    color: hsl(var(--muted-foreground));
  }

  /* --- Back link --------------------------------------------------------- */
  .back {
    display: inline-flex; align-items: center; gap: 0.375rem;
    background: none; border: 0; padding: 0;
    font: inherit; font-size: 0.875rem;
    color: hsl(var(--muted-foreground));
    cursor: pointer;
  }
  .back:hover { color: hsl(var(--foreground)); }
  .back:focus-visible { outline: none; text-decoration: underline; }

  .page-head { display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-end; justify-content: space-between; }
  .card-header.split { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; align-items: center; justify-content: space-between; }
  .footer-line { margin: 0; font-size: 0.8125rem; color: hsl(var(--muted-foreground)); }

  /* --- Filter pills ------------------------------------------------------ */
  .pills { display: flex; flex-wrap: wrap; gap: 0.375rem; align-items: center; }
  .pill-btn {
    height: 1.75rem; padding: 0 0.625rem;
    border: 1px solid hsl(var(--input));
    border-radius: 9999px;
    background: hsl(var(--background));
    color: hsl(var(--foreground));
    font: inherit; font-size: 0.8125rem; font-weight: 500;
    cursor: pointer;
  }
  .pill-btn:hover { background: hsl(var(--accent)); }
  .pill-btn[aria-pressed="true"] {
    background: hsl(var(--primary)); border-color: hsl(var(--primary)); color: hsl(var(--primary-foreground));
  }
  .pill-btn:focus-visible, .seg button:focus-visible, .match:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px hsl(var(--background)), 0 0 0 4px hsl(var(--ring));
  }
  .tags { display: flex; flex-wrap: wrap; gap: 0.25rem; }

  /* --- Segmented switch (a feature's rollout) ---------------------------- */
  .seg {
    display: inline-flex; align-self: flex-start; flex-wrap: wrap; gap: 0.125rem; padding: 0.1875rem;
    background: hsl(var(--muted));
    border-radius: calc(var(--radius) - 2px);
  }
  .seg button {
    height: 1.75rem; padding: 0 0.625rem;
    border: 0; border-radius: calc(var(--radius) - 4px);
    background: transparent; color: hsl(var(--muted-foreground));
    font: inherit; font-size: 0.8125rem; font-weight: 500;
    white-space: nowrap; cursor: pointer;
  }
  .seg button:hover { color: hsl(var(--foreground)); }
  .seg button[aria-pressed="true"] {
    background: hsl(var(--background)); color: hsl(var(--foreground));
    box-shadow: 0 1px 2px rgba(15,23,42,.12);
  }

  /* --- Forms ------------------------------------------------------------- */
  .form { display: flex; flex-direction: column; gap: 1rem; }
  .form-actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
  .textarea { height: auto; min-height: 5rem; padding: 0.5rem 0.75rem; resize: vertical; line-height: 1.5; }
  .hint { margin-top: 0.375rem; font-size: 0.8125rem; color: hsl(var(--muted-foreground)); }
  .tag-editor {
    display: flex; flex-wrap: wrap; align-items: center; gap: 0.375rem;
    min-height: 2.25rem; padding: 0.25rem 0.5rem;
    border: 1px solid hsl(var(--input));
    border-radius: calc(var(--radius) - 2px);
    background: hsl(var(--background));
    cursor: text;
  }
  .tag-editor:focus-within { box-shadow: 0 0 0 2px hsl(var(--background)), 0 0 0 4px hsl(var(--ring)); }
  .tag-editor input {
    flex: 1; min-width: 6rem; height: 1.625rem;
    border: 0; outline: 0; background: transparent;
    color: hsl(var(--foreground)); font: inherit; font-size: 0.875rem;
  }
  .tag-editor input::placeholder { color: hsl(var(--muted-foreground)); }
  .tag-remove {
    margin-left: 0.25rem; padding: 0; border: 0; background: none;
    color: inherit; font: inherit; line-height: 1; cursor: pointer; opacity: .7;
  }
  .tag-remove:hover { opacity: 1; }

  /* --- One feature ------------------------------------------------------- */
  .feature-grid { display: grid; gap: 1.5rem; align-items: start; }
  @media (min-width: 64rem) { .feature-grid { grid-template-columns: minmax(0, 30rem) minmax(0, 1fr); } }
  .search-row { display: flex; gap: 0.5rem; }
  .match-list { display: flex; flex-direction: column; gap: 0.125rem; }
  .match {
    display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
    width: 100%; padding: 0.5rem 0.625rem;
    border: 0; border-radius: calc(var(--radius) - 2px);
    background: transparent; color: hsl(var(--foreground));
    font: inherit; text-align: left; cursor: pointer;
  }
  .match:hover { background: hsl(var(--muted) / .5); }
  .match[aria-pressed="true"] { background: hsl(var(--muted)); }

  .person-head { display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-start; justify-content: space-between; }

  /* --- Person page: header, summary tiles, tabs ---------------------------- */
  .person-page { gap: 1.25rem; }
  .person-head { align-items: center; }
  .person-id { display: flex; align-items: center; gap: 1rem; min-width: 0; }
  .person-who { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
  .person-who .cell-sub { overflow-wrap: anywhere; }
  .person-title { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.625rem; }
  .person-title h2 { margin: 0; font-size: 1.25rem; font-weight: 600; letter-spacing: -0.01em; overflow-wrap: anywhere; }
  .avatar {
    display: inline-flex; align-items: center; justify-content: center; flex: none;
    width: 2.75rem; height: 2.75rem; border-radius: 9999px;
    background: hsl(var(--info) / .14); color: hsl(var(--info));
    font-size: 1rem; font-weight: 600;
  }
  .btn-outline-destructive { color: hsl(var(--destructive)); border-color: hsl(var(--destructive) / .45); }
  .btn-outline-destructive:hover { background: hsl(var(--destructive) / .1); color: hsl(var(--destructive)); }
  @media (prefers-color-scheme: dark) { .btn-outline-destructive, .btn-outline-destructive:hover { color: hsl(0 90% 72%); } }
  .tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.875rem; }
  @media (max-width: 56.25rem) { .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 34rem) { .tiles { grid-template-columns: minmax(0, 1fr); } }
  .tile {
    display: flex; flex-direction: column; gap: 0.25rem; min-width: 0;
    padding: 0.875rem 1rem;
    border: 1px solid hsl(var(--border)); border-radius: calc(var(--radius) + 2px);
    background: hsl(var(--card));
  }
  .tile-label { font-size: 0.75rem; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: hsl(var(--muted-foreground)); }
  .tile-value { font-size: 1.25rem; font-weight: 600; }
  .tile-sub { font-size: 0.8125rem; color: hsl(var(--muted-foreground)); overflow-wrap: anywhere; }
  .tabs-wrap { max-width: 100%; overflow-x: auto; padding: 2px; margin: -2px; }
  .tabs {
    display: inline-flex; gap: 0.125rem; padding: 0.25rem;
    background: hsl(var(--muted)); border-radius: calc(var(--radius) + 2px);
  }
  .tab {
    display: inline-flex; align-items: center; gap: 0.375rem; flex: none;
    padding: 0.5rem 1rem; border: 0; border-radius: calc(var(--radius) - 1px);
    background: transparent; color: hsl(var(--muted-foreground));
    font: inherit; font-size: 0.875rem; font-weight: 500; white-space: nowrap; cursor: pointer;
  }
  .tab:hover { color: hsl(var(--foreground)); }
  .tab[aria-selected="true"] {
    background: hsl(var(--background)); color: hsl(var(--foreground));
    box-shadow: 0 1px 2px rgba(15,23,42,.12);
  }
  .tab-count { font-weight: 400; color: hsl(var(--muted-foreground)); }
  .tab:focus-visible, .tab-panel:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px hsl(var(--background)), 0 0 0 4px hsl(var(--ring));
  }
  .tab-panel { border-radius: var(--radius); }
  .tab-panel thead tr { background: hsl(var(--muted)); }
  .tab-panel th {
    height: 2.5rem; padding: 0 1.25rem;
    font-size: 0.75rem; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;
  }
  .tab-panel td { padding: 0.875rem 1.25rem; }
  .notice {
    display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.625rem;
    padding: 0.75rem 1rem; border-radius: calc(var(--radius) + 2px);
    background: hsl(var(--warning) / .14); color: hsl(var(--warning));
    font-size: 0.875rem; overflow-wrap: anywhere;
  }
  .notice strong { font-weight: 600; }
  @media (max-width: 640px) { .tab-panel td { padding: 0.75rem; } .tab-panel th { padding: 0 0.75rem; } }
  /* --- Status and payments: master list and detail ------------------------ */
  .pay-cols { display: grid; grid-template-columns: 20rem minmax(0, 1fr); gap: 1.25rem; align-items: start; }
  @media (max-width: 56.25rem) { .pay-cols { grid-template-columns: minmax(0, 1fr); } }
  .pay-master {
    display: flex; flex-direction: column; gap: 0.375rem; padding: 0.75rem;
    border: 1px solid hsl(var(--border)); border-radius: var(--radius);
    background: hsl(var(--muted) / .35);
  }
  .pay-master-title {
    margin: 0; padding: 0 0.375rem 0.375rem;
    font-size: 0.75rem; font-weight: 600; letter-spacing: .06em; text-transform: uppercase;
    color: hsl(var(--muted-foreground));
  }
  .pay-item {
    display: flex; flex-direction: column; gap: 0.25rem; width: 100%;
    padding: 0.625rem 0.75rem;
    border: 1px solid transparent; border-radius: calc(var(--radius) - 2px);
    background: hsl(var(--background)); color: hsl(var(--foreground));
    font: inherit; text-align: left; cursor: pointer;
  }
  .pay-item:hover { background: hsl(var(--accent)); }
  .pay-item[aria-current="true"] { background: hsl(var(--muted)); border-color: hsl(var(--foreground)); }
  .pay-item:focus-visible, .pay-toggle:focus-visible {
    outline: none; box-shadow: 0 0 0 2px hsl(var(--background)), 0 0 0 4px hsl(var(--ring));
  }
  .pay-item-top, .pay-item-meta { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
  .pay-item-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .pay-item-meta { font-size: 0.75rem; color: hsl(var(--muted-foreground)); }
  .pay-detail { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
  .pay-detail-head { display: flex; flex-wrap: wrap; gap: 0.75rem 1rem; align-items: flex-start; justify-content: space-between; }
  .pay-detail-title { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem; }
  .pay-detail-title h3 { font-size: 1.25rem; letter-spacing: -0.01em; }
  .pay-line { margin: 0.25rem 0 0; color: hsl(var(--muted-foreground)); }
  .pay-filters { display: flex; flex-wrap: wrap; gap: 0.5rem 0.75rem; align-items: center; }
  .pay-filters .pill-btn { height: 1.875rem; padding: 0 0.75rem; }
  .pay-searched { margin-left: auto; font-size: 0.8125rem; color: hsl(var(--muted-foreground)); }
  @media (max-width: 56.25rem) { .pay-searched { margin-left: 0; flex-basis: 100%; } }
  .pay-table { table-layout: fixed; min-width: 40rem; }
  .pay-table th { height: 2.5rem; font-size: 0.75rem; text-transform: uppercase; letter-spacing: .05em; }
  .pay-table td { padding: 0.625rem 1rem; }
  .pay-table .col-date { width: 8rem; }
  .pay-table .col-amount { width: 6.5rem; text-align: right; }
  .pay-table .col-status { width: 10rem; }
  .pay-table .col-source { width: 5.5rem; }
  .pay-table .pay-what, .pay-table .pay-subject {
    display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .pay-table .pay-what { font-weight: 500; }
  .pay-table .pay-subject { font-size: 0.75rem; color: hsl(var(--muted-foreground)); }
  .pay-table .pay-note { margin-top: 0.125rem; font-size: 0.75rem; color: hsl(var(--muted-foreground)); }
  .pay-table tr.pay-row { cursor: pointer; }
  .pay-table tr.pay-row:hover { background: hsl(var(--muted) / .5); }
  .pay-toggle {
    padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer;
    border-radius: 4px; font-variant-numeric: tabular-nums; white-space: nowrap;
  }
  .pay-more td { background: hsl(var(--muted) / .35); }
  .pay-facts { display: grid; grid-template-columns: 8rem minmax(0, 1fr); gap: 0.25rem 1rem; margin: 0; }
  .pay-facts dt { color: hsl(var(--muted-foreground)); }
  .pay-facts dd { margin: 0; overflow-wrap: anywhere; }
  .pay-hint { margin: 0; font-size: 0.8125rem; color: hsl(var(--muted-foreground)); }
  .person-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }

  /* --- Dialog ------------------------------------------------------------ */
  dialog {
    padding: 0; border: 1px solid hsl(var(--border));
    border-radius: var(--radius);
    background: hsl(var(--card)); color: hsl(var(--foreground));
    width: min(28rem, calc(100vw - 2rem));
    box-shadow: 0 10px 38px -10px rgba(22,23,24,.35), 0 10px 20px -15px rgba(22,23,24,.2);
  }
  dialog::backdrop { background: rgba(0,0,0,.5); }
  .dialog-body { padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; }
  .dialog-actions { display: flex; justify-content: flex-end; gap: 0.5rem; }

  /* --- Login ------------------------------------------------------------- */
  .login-wrap {
    min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    padding: 1.5rem;
  }
  .login-card { width: 100%; max-width: 22rem; }
  .login-form { display: flex; flex-direction: column; gap: 1rem; }

  @media (max-width: 640px) {
    /* With the nav it no longer fits one line on a phone, so it wraps. */
    .topbar { height: auto; min-height: 3.5rem; flex-wrap: wrap; padding: 0.5rem 1rem; gap: 0.5rem 1rem; }
    .topbar-email { display: none; }
    /* The build marker stays on a phone; the email is the one that goes. */
    main { padding: 1rem; }
    /*
      Tables scroll sideways at phone width rather than being rebuilt as cards.
      No minimum is set: headers are nowrap, which gives each table its own
      natural floor, so a narrow table (four columns of mailbox detail) fits
      the screen and only a genuinely wide one scrolls.
    */
    td { padding: 0.75rem; }
  }
`;

const FONT_LINK =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap">';

function head(title: string): string {
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
${FONT_LINK}
<style>${baseStyles}</style>`;
}

export function loginPage(opts: { error?: string }): string {
  const errorHtml = opts.error
    ? `<div class="alert alert-error" role="alert">${escapeHtml(opts.error)}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
${head("Verloq Admin")}
</head>
<body>
  <div class="login-wrap">
    <div class="card login-card">
      <div class="card-body">
        <div class="login-form">
          <div>
            <h1>Verloq Admin</h1>
            <p class="muted" style="margin:0.25rem 0 0">Sign in to view users and account health.</p>
          </div>
          ${errorHtml}
          <form method="post" action="/admin/login" class="login-form">
            <div>
              <label class="label" for="email">Email</label>
              <input class="input" id="email" name="email" type="email" required autocomplete="username" autofocus>
            </div>
            <div>
              <label class="label" for="password">Password</label>
              <input class="input" id="password" name="password" type="password" required autocomplete="current-password">
            </div>
            <button class="btn btn-primary" type="submit">Sign in</button>
          </form>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export function consolePage(opts: {
  csrfToken: string;
  adminEmail: string;
  version?: string;
}): string {
  const csrfToken = escapeHtml(opts.csrfToken);
  const adminEmail = escapeHtml(opts.adminEmail);
  const version = escapeHtml(opts.version || "unknown");

  return `<!doctype html>
<html lang="en">
<head>
${head("Verloq Admin")}
</head>
<body data-csrf="${csrfToken}" data-admin-email="${adminEmail}">
  <header class="topbar">
    <div class="topbar-left">
      <h1>Verloq Admin</h1>
      <nav class="nav" aria-label="Admin">
        <a href="#" id="nav-people">People</a>
        <a href="#features" id="nav-features">Features</a>
      </nav>
    </div>
    <div class="topbar-right">
      <span class="topbar-build" title="The commit this server was built from">build ${version}</span>
      <a class="btn btn-outline btn-sm" href="/admin/microsoft">Microsoft setup</a>
      <span class="topbar-email">${adminEmail}</span>
      <form method="post" action="/admin/logout">
        <button class="btn btn-outline btn-sm" type="submit">Sign out</button>
      </form>
    </div>
  </header>

  <main>
    <div class="stack">
      <div id="status" hidden></div>
      <div id="view"><p class="muted">Loading…</p></div>
    </div>
  </main>

  <dialog id="confirm">
    <form method="dialog" class="dialog-body">
      <h2 id="dialog-title">Confirm</h2>
      <p id="dialog-message" class="muted" style="margin:0"></p>
      <div id="dialog-email-field">
        <label class="label" for="dialog-email">Type the email address to confirm</label>
        <input class="input" id="dialog-email" type="text" autocomplete="off" spellcheck="false">
      </div>
      <div class="dialog-actions">
        <button class="btn btn-outline" type="button" id="dialog-cancel">Cancel</button>
        <button class="btn btn-destructive" type="button" id="dialog-confirm" disabled>Confirm</button>
      </div>
    </form>
  </dialog>

  <dialog id="new-feature" aria-labelledby="nf-title">
    <form class="dialog-body" id="nf-form" novalidate>
      <h2 id="nf-title">New feature</h2>
      <div id="nf-error" class="alert alert-error" role="alert" hidden></div>
      <div>
        <label class="label" for="nf-key">Key</label>
        <input class="input" id="nf-key" type="text" autocomplete="off" spellcheck="false" maxlength="50" placeholder="e.g. smart_reminders">
        <div class="hint">Lowercase letters, numbers and underscores, starting with a letter. Used in code, so it can’t be changed later.</div>
      </div>
      <div>
        <label class="label" for="nf-name">Name</label>
        <input class="input" id="nf-name" type="text" autocomplete="off" maxlength="80">
      </div>
      <div>
        <label class="label" for="nf-description">Description</label>
        <textarea class="input textarea" id="nf-description" rows="3" maxlength="500"></textarea>
      </div>
      <div>
        <label class="label" for="nf-tags">Tags</label>
        <div id="nf-tags-host"></div>
      </div>
      <p class="hint" style="margin:0">New features start off. Nobody sees them until you choose who gets them.</p>
      <div class="dialog-actions">
        <button class="btn btn-outline" type="button" id="nf-cancel">Cancel</button>
        <button class="btn btn-primary" type="submit" id="nf-submit">Create feature</button>
      </div>
    </form>
  </dialog>

<script>
(function () {
  "use strict";

  var CSRF = document.body.getAttribute("data-csrf");
  var statusEl = document.getElementById("status");
  var dialog = document.getElementById("confirm");
  var dialogTitle = document.getElementById("dialog-title");
  var dialogMessage = document.getElementById("dialog-message");
  var dialogEmail = document.getElementById("dialog-email");
  var dialogConfirm = document.getElementById("dialog-confirm");
  var dialogCancel = document.getElementById("dialog-cancel");
  var dialogEmailField = document.getElementById("dialog-email-field");
  var ADMIN_EMAIL = document.body.getAttribute("data-admin-email") || "";

  // "list", a user id, "features" or "features/<id>" (see parseRoute). The
  // whole reason a person is a route rather than an expanding row: three
  // sub-tables side by side inside a table cell overlapped each other and
  // became unreadable.
  var route = "list";
  var overview = null;
  var detailCache = {};
  var filter = "";
  var pending = null;

  // Features. The list, each opened feature, unsaved edits to a feature's
  // details (kept so a reload after adding a user does not throw them away),
  // and the list's two filters.
  var features = null;
  var featureCache = {};
  var drafts = {};
  var featureFilter = "";
  var featureTag = "";
  // A message to show once the next route has drawn. Navigating clears the
  // status line, so one set just before go() would never be seen.
  var flash = null;

  // --- small helpers ----------------------------------------------------

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  var MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  function fmtDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
  }

  function fmtRelative(iso) {
    if (!iso) return "";
    var then = new Date(iso).getTime();
    if (isNaN(then)) return "";
    var secs = Math.floor((Date.now() - then) / 1000);
    if (secs < 60) return "just now";
    var mins = Math.floor(secs / 60);
    if (mins < 60) return mins + (mins === 1 ? " minute ago" : " minutes ago");
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
    var days = Math.floor(hours / 24);
    if (days < 31) return days + (days === 1 ? " day ago" : " days ago");
    var months = Math.floor(days / 30);
    return months + (months === 1 ? " month ago" : " months ago");
  }

  function personName(user) {
    var name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
    return name || "No name given";
  }

  /**
   * Sync history only started being recorded when the sync_jobs table was
   * added, so an account can have a mailbox that plainly synced and no job
   * row at all. Saying "Never" there is simply wrong, so the mailbox's own
   * timestamp is used when no run was recorded.
   */
  function syncState(user) {
    if (user.last_sync_status === "succeeded") {
      return { label: "Succeeded", cls: "badge badge-success", at: user.last_sync_finished || user.last_sync_started };
    }
    if (user.last_sync_status === "failed") {
      return { label: "Failed", cls: "badge badge-destructive", at: user.last_sync_finished || user.last_sync_started, error: user.last_sync_error };
    }
    if (user.last_sync_status === "running") {
      return { label: "Running", cls: "badge badge-warning", at: user.last_sync_started };
    }
    if (user.last_mailbox_sync) {
      return { label: "Synced", cls: "badge badge-muted", at: user.last_mailbox_sync };
    }
    return { label: "Never", cls: "badge badge-muted", at: null };
  }

  // --- network ----------------------------------------------------------

  function handle(res) {
    if (res.status === 401) { location.reload(); throw new Error("Signed out"); }
    return res.json().then(function (body) {
      if (!res.ok) throw new Error((body && body.message) || "Something went wrong.");
      return body;
    });
  }

  function apiGet(url) { return fetch(url, { credentials: "same-origin" }).then(handle); }

  function apiSend(method, url, body) {
    var headers = { "x-admin-csrf": CSRF };
    var init = { method: method, credentials: "same-origin", headers: headers };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return fetch(url, init).then(handle);
  }

  function apiPost(url, body) { return apiSend("POST", url, body); }

  function showStatus(text, isError) {
    statusEl.className = "alert " + (isError ? "alert-error" : "alert-success");
    statusEl.textContent = text;
    statusEl.hidden = false;
  }

  function hideStatus() { statusEl.hidden = true; statusEl.textContent = ""; }

  // --- table builder ----------------------------------------------------

  function buildTable(headers, rows, buildRow) {
    var container = el("div", "table-container");
    var scroll = el("div", "table-scroll");
    var table = document.createElement("table");

    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    headers.forEach(function (h) { headRow.appendChild(el("th", "", h)); });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement("tbody");
    rows.forEach(function (row) { tbody.appendChild(buildRow(row)); });
    table.appendChild(tbody);

    scroll.appendChild(table);
    container.appendChild(scroll);
    return container;
  }

  function section(title, node) {
    var wrap = el("div", "section");
    wrap.appendChild(el("h2", "", title));
    wrap.appendChild(node);
    return wrap;
  }

  function emptyCard(text) {
    var card = el("div", "card");
    card.appendChild(el("div", "empty", text));
    return card;
  }

  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  /** Makes a table row open something, by mouse or keyboard. */
  function rowLink(tr, label, open) {
    tr.className = "row-link";
    tr.tabIndex = 0;
    tr.setAttribute("role", "button");
    tr.setAttribute("aria-label", label);
    tr.addEventListener("click", open);
    tr.addEventListener("keydown", function (e) {
      if (e.target !== tr) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
  }

  function codeEl(text) { var c = document.createElement("code"); c.textContent = text; return c; }

  // "Beta" is the one tag that says something about readiness, so it stands out.
  function tagClass(tag) {
    return "badge " + (String(tag).toLowerCase() === "beta" ? "badge-warning" : "badge-muted");
  }

  function tagList(tags) {
    var wrap = el("div", "tags");
    (tags || []).forEach(function (t) { wrap.appendChild(el("span", tagClass(t), t)); });
    return wrap;
  }

  var ROLLOUTS = [
    { value: "off", label: "Off", cls: "badge-muted" },
    { value: "selected", label: "Selected users", cls: "badge-info" },
    { value: "everyone", label: "Everyone", cls: "badge-success" }
  ];

  function rolloutBadge(rollout) {
    var spec = ROLLOUTS.filter(function (r) { return r.value === rollout; })[0] || ROLLOUTS[0];
    return el("span", "badge badge-dot " + spec.cls, spec.label);
  }

  /** "Who has it", in the words the list uses. */
  function whoHas(f) {
    if (f.rollout === "everyone") return "All " + plural(f.total_users, "user", "users");
    if (f.rollout === "selected" && f.listed_users > 0) return plural(f.listed_users, "user", "users");
    return "No one";
  }

  function addedBy(by) {
    if (!by) return "";
    return "by " + (by.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? "you" : by);
  }

  /**
   * A tag input: pills with a remove button, and a text box that adds one on
   * Enter or a comma. get() also takes whatever is still typed in the box.
   */
  function tagEditor(id, initial, onChange) {
    var list = (initial || []).slice();
    var wrap = el("div", "tag-editor");
    var pills = el("span", "tags");
    var input = document.createElement("input");
    input.id = id;
    input.type = "text";
    input.autocomplete = "off";
    input.placeholder = "Add a tag";
    input.maxLength = 30;
    wrap.appendChild(pills);
    wrap.appendChild(input);

    function changed() { draw(); if (onChange) onChange(list.slice()); }

    function draw() {
      clear(pills);
      list.forEach(function (tag, i) {
        var pill = el("span", tagClass(tag), tag);
        var x = el("button", "tag-remove", "×");
        x.type = "button";
        x.setAttribute("aria-label", "Remove tag " + tag);
        x.addEventListener("click", function () { list.splice(i, 1); changed(); input.focus(); });
        pill.appendChild(x);
        pills.appendChild(pill);
      });
    }

    function commit() {
      var value = input.value.split(",").join(" ").split(" ").filter(Boolean).join(" ");
      input.value = "";
      if (!value) return;
      var exists = list.some(function (t) { return t.toLowerCase() === value.toLowerCase(); });
      if (!exists && list.length < 12) { list.push(value); changed(); }
    }

    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); }
      else if (e.key === "Backspace" && !input.value && list.length) { list.pop(); changed(); }
    });
    input.addEventListener("blur", commit);
    wrap.addEventListener("click", function (e) { if (e.target === wrap || e.target === pills) input.focus(); });
    draw();

    return { node: wrap, get: function () { commit(); return list.slice(); } };
  }

  /** After any feature write: every cached view that shows features is stale. */
  function forgetFeatures() {
    features = null;
    featureCache = {};
    detailCache = {};
  }

  // --- the list view ----------------------------------------------------

  var STATS = [
    { key: "users", label: "Signed up" },
    { key: "verified", label: "Verified" },
    { key: "withMailbox", label: "Mailbox connected" },
    { key: "syncedLast7Days", label: "Synced this week" },
    { key: "quietOver7Days", label: "Quiet over a week", tone: "is-warning" },
    { key: "mailboxesInError", label: "Mailboxes erroring", tone: "is-destructive" },
    { key: "activeSubscriptions", label: "Active subscriptions" },
    { key: "invoices", label: "Invoices" }
  ];

  function buildStats(health) {
    var grid = el("div", "stats");
    STATS.forEach(function (spec) {
      var value = health[spec.key] || 0;
      var card = el("div", "card stat");
      // A tone only applies when there is something to be concerned about.
      var valueEl = el("div", "stat-value" + (spec.tone && value > 0 ? " " + spec.tone : ""), String(value));
      card.appendChild(valueEl);
      card.appendChild(el("div", "stat-label", spec.label));
      grid.appendChild(card);
    });
    return grid;
  }

  function matches(user) {
    if (!filter) return true;
    var hay = [user.first_name, user.last_name, user.email, user.organization_name]
      .filter(Boolean).join(" ").toLowerCase();
    return hay.indexOf(filter.toLowerCase()) !== -1;
  }

  function buildUserRow(user) {
    var tr = el("tr", "row-link");
    tr.tabIndex = 0;
    tr.setAttribute("role", "button");
    tr.setAttribute("aria-label", "Open " + user.email);

    var person = document.createElement("td");
    person.appendChild(el("div", "cell-title", personName(user)));
    person.appendChild(el("div", "cell-sub", user.email));
    if (user.organization_name) person.appendChild(el("div", "cell-sub", user.organization_name));
    tr.appendChild(person);

    tr.appendChild(el("td", "num nowrap", fmtDate(user.created_at)));

    var mailboxes = document.createElement("td");
    var count = (user.gmail_accounts || 0) + (user.outlook_accounts || 0);
    if (count === 0) {
      mailboxes.appendChild(el("span", "badge badge-muted", "None"));
    } else if (user.mailboxes_in_error > 0) {
      mailboxes.appendChild(el("span", "badge badge-destructive", count + " · " + user.mailboxes_in_error + " erroring"));
    } else {
      mailboxes.appendChild(el("span", "num", String(count)));
    }
    tr.appendChild(mailboxes);

    var subs = document.createElement("td");
    subs.appendChild(el("div", "num", String(user.subscriptions || 0)));
    if (user.pending_suggestions > 0) {
      subs.appendChild(el("div", "cell-sub", user.pending_suggestions + " awaiting review"));
    }
    tr.appendChild(subs);

    var inv = document.createElement("td");
    inv.appendChild(el("div", "num", String(user.invoices || 0)));
    var noFile = (user.invoices || 0) - (user.invoices_with_file || 0);
    if (noFile > 0) inv.appendChild(el("div", "cell-sub", noFile + " with no file"));
    tr.appendChild(inv);

    var sync = document.createElement("td");
    var state = syncState(user);
    sync.appendChild(el("span", state.cls, state.label));
    if (state.at) sync.appendChild(el("div", "cell-sub", fmtRelative(state.at)));
    tr.appendChild(sync);

    function open() { go(user.id); }
    tr.addEventListener("click", open);
    tr.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });

    return tr;
  }

  function renderList() {
    var root = document.createElement("div");
    root.className = "stack";

    root.appendChild(buildStats(overview.health));

    var users = (overview.users || []).filter(matches);

    var controls = el("div", "section");
    var labelEl = el("label", "sr-only", "Filter people");
    labelEl.setAttribute("for", "filter");
    var input = document.createElement("input");
    input.className = "input";
    input.id = "filter";
    input.type = "search";
    input.placeholder = "Filter by name, email or organisation";
    input.value = filter;
    input.style.maxWidth = "24rem";
    input.addEventListener("input", function () {
      filter = input.value;
      renderView({ keepFocus: "filter" });
    });
    controls.appendChild(labelEl);
    controls.appendChild(input);
    root.appendChild(controls);

    if ((overview.users || []).length === 0) {
      root.appendChild(emptyCard("No one has signed up yet."));
    } else if (users.length === 0) {
      root.appendChild(emptyCard("No one matches that filter."));
    } else {
      root.appendChild(buildTable(
        ["Person", "Joined", "Mailboxes", "Subscriptions", "Invoices", "Last sync"],
        users,
        buildUserRow
      ));
    }

    return root;
  }

  // --- the person view --------------------------------------------------

  // The tab chosen for each person, kept across re-draws (search again, add or remove a feature).
  var personTabs = {};
  var TAB_IDS = ["features", "mailboxes", "subscriptions", "status", "sync"];

  function initialsOf(detail) {
    var parts = [detail.first_name, detail.last_name].filter(Boolean);
    var text = parts.length ? parts.map(function (p) { return p.charAt(0); }).join("") : (detail.email || "?").charAt(0);
    return text.toUpperCase().slice(0, 2);
  }

  function mailboxNeedsReconnect(m) { return m.sync_status === "error"; }

  function newestSync(syncs) {
    var best = null;
    syncs.forEach(function (j) {
      if (!j.started_at) return;
      if (!best || new Date(j.started_at).getTime() > new Date(best.started_at).getTime()) best = j;
    });
    return best;
  }

  function buildTile(label, value, sub) {
    var tile = el("div", "tile");
    tile.appendChild(el("span", "tile-label", label));
    tile.appendChild(el("span", "tile-value", value));
    if (sub) tile.appendChild(el("span", "tile-sub", sub));
    return tile;
  }

  function buildPersonTiles(detail) {
    var tiles = el("div", "tiles");
    var subs = detail.subscriptions_detail || [];
    var mailboxes = detail.mailboxes || [];
    var syncs = detail.recent_syncs || [];

    var subSub = "";
    if (detail.status_payments) {
      var active = 0, review = 0;
      detail.status_payments.forEach(function (r) {
        if (r.lifecycle_status === "active") active++;
        else if (r.lifecycle_status === "needs_review") review++;
      });
      var bits = [];
      if (active) bits.push(active + " active");
      if (review) bits.push(review + " needs review");
      subSub = bits.join(", ");
    }
    tiles.appendChild(buildTile("Subscriptions", String(subs.length), subSub));

    var broken = mailboxes.filter(mailboxNeedsReconnect).length;
    tiles.appendChild(buildTile("Mailboxes", String(mailboxes.length),
      broken ? broken + (broken === 1 ? " needs" : " need") + " reconnect" : (mailboxes.length ? "All connected" : "None connected")));

    var last = newestSync(syncs);
    var lastSub = "No sync recorded";
    if (last) {
      lastSub = last.status === "succeeded" ? "Done, " + plural(last.emails_processed || 0, "email", "emails")
        : last.status === "failed" ? "Failed"
        : String(last.status || "");
    }
    tiles.appendChild(buildTile("Last sync", last ? fmtDate(last.started_at) : "Never", lastSub));

    var feats = detail.features;
    if (!feats) {
      tiles.appendChild(buildTile("Features on", "—", "Could not load"));
    } else {
      var on = feats.filter(function (f) { return f.enabled; });
      tiles.appendChild(buildTile("Features on", on.length + " of " + feats.length,
        on.length ? on.map(function (f) { return f.name; }).join(", ") : "None on"));
    }
    return tiles;
  }

  function buildPersonMailboxes(detail) {
    var mailboxes = detail.mailboxes || [];
    if (!mailboxes.length) return emptyCard("No mailbox connected.");
    var wrap = el("div", "stack");
    wrap.style.gap = "0.75rem";
    var broken = mailboxes.filter(mailboxNeedsReconnect);
    if (broken.length) {
      var note = el("div", "notice");
      note.setAttribute("role", "status");
      note.appendChild(el("strong", "", broken.length === 1 ? "1 mailbox needs reconnecting." : broken.length + " mailboxes need reconnecting."));
      note.appendChild(el("span", "", broken.map(function (m) { return m.address; }).join(", ") + (broken.length === 1 ? " stopped syncing." : " stopped syncing.")));
      wrap.appendChild(note);
    }
    wrap.appendChild(buildTable(["Provider", "Address", "Last sync", "Status"], mailboxes, function (m) {
      var tr = document.createElement("tr");
      tr.appendChild(el("td", "", m.provider === "gmail" ? "Gmail" : "Outlook"));
      tr.appendChild(el("td", "cell-title", m.address));
      var last = document.createElement("td");
      last.appendChild(el("div", "nowrap", fmtDate(m.last_sync)));
      if (m.last_sync) last.appendChild(el("div", "cell-sub", fmtRelative(m.last_sync)));
      tr.appendChild(last);
      var status = document.createElement("td");
      var bad = mailboxNeedsReconnect(m);
      status.appendChild(el("span", "badge " + (bad ? "badge-destructive" : "badge-muted"), m.sync_status || "idle"));
      if (bad && m.sync_error) {
        var err = el("div", "cell-sub", m.sync_error);
        err.style.color = "hsl(var(--destructive))";
        status.appendChild(err);
      }
      tr.appendChild(status);
      return tr;
    }));
    return wrap;
  }

  function buildPersonSubscriptions(detail) {
    var subs = detail.subscriptions_detail || [];
    if (!subs.length) return emptyCard("Nothing found yet.");
    return buildTable(["Service", "Amount", "Frequency", "Status", "Next billing", "Invoices"], subs, function (s) {
      var tr = document.createElement("tr");
      tr.appendChild(el("td", "cell-title", s.service_name));
      tr.appendChild(el("td", "num nowrap", s.currency + " " + s.amount));
      tr.appendChild(el("td", "", s.frequency));
      tr.appendChild(el("td", "", s.status));
      tr.appendChild(el("td", "num nowrap", fmtDate(s.next_billing_date)));
      var inv = document.createElement("td");
      inv.appendChild(el("div", "num", String(s.invoices || 0)));
      if (s.invoices_without_file > 0) {
        inv.appendChild(el("div", "cell-sub", s.invoices_without_file + " with no file"));
      }
      tr.appendChild(inv);
      return tr;
    });
  }

  function buildPersonSyncs(detail) {
    var syncs = detail.recent_syncs || [];
    if (!syncs.length) return emptyCard("No sync has been recorded for this account yet.");
    return buildTable(["Status", "Started", "Emails", "Suggestions", "Detail"], syncs, function (j) {
      var tr = document.createElement("tr");
      var cls = j.status === "succeeded" ? "badge-success"
        : j.status === "failed" ? "badge-destructive"
        : "badge-warning";
      var st = document.createElement("td");
      st.appendChild(el("span", "badge " + cls, j.status));
      tr.appendChild(st);
      var started = document.createElement("td");
      started.appendChild(el("div", "nowrap", fmtDate(j.started_at)));
      started.appendChild(el("div", "cell-sub", fmtRelative(j.started_at)));
      tr.appendChild(started);
      tr.appendChild(el("td", "num", String(j.emails_processed || 0)));
      tr.appendChild(el("td", "num", String(j.suggestions_generated || 0)));
      tr.appendChild(el("td", "cell-sub", j.error || j.trigger_source || "—"));
      return tr;
    });
  }

  function buildPerson(detail) {
    var root = document.createElement("div");
    root.className = "stack person-page";

    var back = el("button", "back", "← All people");
    back.type = "button";
    back.addEventListener("click", function () { go("list"); });
    root.appendChild(back);

    var head = el("div", "person-head");
    var identity = el("div", "person-id");
    var avatar = el("span", "avatar", initialsOf(detail));
    avatar.setAttribute("aria-hidden", "true");
    identity.appendChild(avatar);
    var who = el("div", "person-who");
    var titleRow = el("div", "person-title");
    var hasName = personName(detail) !== "No name given";
    titleRow.appendChild(el("h2", "", hasName ? personName(detail) : detail.email));
    titleRow.appendChild(el("span", "badge badge-dot " + (detail.email_verified ? "badge-success" : "badge-muted"),
      detail.email_verified ? "Verified" : "Not verified"));
    who.appendChild(titleRow);
    var meta = [];
    if (hasName) meta.push(detail.email);
    if (detail.organization_name) meta.push(detail.organization_name);
    meta.push("Joined " + fmtDate(detail.created_at));
    who.appendChild(el("div", "cell-sub", meta.join(" · ")));
    identity.appendChild(who);
    head.appendChild(identity);

    var actions = el("div", "person-actions");
    var clearBtn = el("button", "btn btn-outline", "Clear data");
    clearBtn.type = "button";
    clearBtn.addEventListener("click", function () { askConfirm(detail, "clear"); });
    var deleteBtn = el("button", "btn btn-outline btn-outline-destructive", "Delete user");
    deleteBtn.type = "button";
    deleteBtn.addEventListener("click", function () { askConfirm(detail, "delete"); });
    actions.appendChild(clearBtn);
    actions.appendChild(deleteBtn);
    head.appendChild(actions);
    root.appendChild(head);

    root.appendChild(buildPersonTiles(detail));

    // The tabs replace the old stacked sections. Status is only offered while
    // the subscription_status switch is on for this person.
    var tabs = [
      { id: "features", label: "Features", count: detail.features ? detail.features.length : null, build: buildPersonFeatures },
      { id: "mailboxes", label: "Mailboxes", count: (detail.mailboxes || []).length, build: buildPersonMailboxes },
      { id: "subscriptions", label: "Subscriptions", count: (detail.subscriptions_detail || []).length, build: buildPersonSubscriptions }
    ];
    if (detail.status_payments) tabs.push({ id: "status", label: "Status and payments", count: null, build: buildPersonStatus });
    tabs.push({ id: "sync", label: "Sync history", count: (detail.recent_syncs || []).length, build: buildPersonSyncs });

    var current = personTabs[detail.id];
    if (!tabs.some(function (t) { return t.id === current; })) current = "subscriptions";

    var tabWrap = el("div", "tabs-wrap");
    var tablist = el("div", "tabs");
    tablist.setAttribute("role", "tablist");
    tablist.setAttribute("aria-label", "About " + (hasName ? personName(detail) : detail.email));
    var panel = el("div", "tab-panel");
    panel.id = "person-panel";
    panel.setAttribute("role", "tabpanel");
    panel.tabIndex = 0;
    var buttons = [];

    function select(id, focus) {
      current = id;
      personTabs[detail.id] = id;
      var tab = null;
      buttons.forEach(function (b, i) {
        var on = tabs[i].id === id;
        b.setAttribute("aria-selected", String(on));
        b.tabIndex = on ? 0 : -1;
        if (on) { tab = b; panel.setAttribute("aria-labelledby", b.id); }
      });
      clear(panel);
      panel.appendChild(tabs.filter(function (t) { return t.id === id; })[0].build(detail));
      if (focus && tab) tab.focus();
      try {
        // Keeps the tab in the address without navigating, so it can be linked.
        var hash = "#" + encodeURIComponent(detail.id) + "?tab=" + id;
        if (location.hash !== hash) history.replaceState(null, "", hash);
        route = routeFromHash();
      } catch (e) {}
    }

    tabs.forEach(function (t, i) {
      var b = el("button", "tab", t.label);
      b.type = "button";
      b.id = "person-tab-" + t.id;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-controls", "person-panel");
      if (t.count !== null) b.appendChild(el("span", "tab-count", String(t.count)));
      b.addEventListener("click", function () { select(t.id, false); });
      b.addEventListener("keydown", function (e) {
        var next = -1;
        if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
        else if (e.key === "ArrowLeft") next = (i + tabs.length - 1) % tabs.length;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = tabs.length - 1;
        if (next < 0) return;
        e.preventDefault();
        select(tabs[next].id, true);
      });
      buttons.push(b);
      tablist.appendChild(b);
    });
    tabWrap.appendChild(tablist);
    root.appendChild(tabWrap);
    root.appendChild(panel);
    select(current, false);
    return root;
  }

  // --- one person's subscription status ---------------------------------

  var LIFECYCLE = {
    active: { label: "Active", cls: "badge-success" },
    needs_review: { label: "Needs review", cls: "badge-warning" },
    inactive: { label: "Inactive", cls: "badge-muted" }
  };

  /**
   * What the status feature has worked out for each subscription, so it can
   * be compared with the person's inbox before anyone is shown it. Read only.
   */
  /** A 'YYYY-MM-DD' day as written, with no timezone shift. */
  function fmtDay(day) {
    var m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})/.exec(day || "");
    if (!m) return fmtDate(day);
    return Number(m[3]) + " " + MONTHS[Number(m[2]) - 1] + " " + m[1];
  }

  /** Queues a history search for this person (one subscription, or all not yet searched). */
  function queueHistory(detail, subscriptionId, fresh) {
    var body = subscriptionId ? { subscriptionId: subscriptionId } : {};
    if (fresh) body.fresh = true;
    return apiPost("/admin/api/users/" + encodeURIComponent(detail.id) + "/history-search", body)
      .then(function (result) {
        showStatus(result.message || "Queued.", false);
        return load(true);
      });
  }

  /** The admin's view of each person: which subscription is selected, kept across re-draws. */
  var statusSelection = {};
  var KIND_WORDS = {
    receipt: "Receipt", invoice: "Bill", card_alert: "Bank alert",
    failed: "Failed payment", refund: "Refund", pause: "Access paused"
  };

  function buildPersonStatus(detail) {
    var rows = detail.status_payments;
    if (rows.length === 0) return emptyCard("No subscriptions yet.");
    var wrap = el("div", "stack");
    wrap.style.gap = "0.75rem";

    var bar = el("div", "person-actions");
    var searchAll = el("button", "btn btn-outline btn-sm", "Search history for all subscriptions");
    searchAll.type = "button";
    searchAll.addEventListener("click", function () {
      askChoice({
        title: "Search history?",
        message: "Looks through the last 12 months of billing emails for every subscription of " +
          detail.email + " that has not been searched yet, in the background. Nothing they see changes.",
        confirmLabel: "Search history",
        destructive: false,
        run: function () { return queueHistory(detail, null); }
      });
    });
    bar.appendChild(searchAll);
    var searchFresh = el("button", "btn btn-outline btn-sm", "Search all again from scratch");
    searchFresh.type = "button";
    searchFresh.addEventListener("click", function () {
      askChoice({
        title: "Search everything again from scratch?",
        message: "Deletes the payments the history search recorded for every subscription of " + detail.email +
          " (payments from the sync or from approvals are kept, but read again with today\u2019s rules: changed ones are updated, ones that are no longer payments are removed), then searches the last 12 months again in the background. Nothing they see changes.",
        confirmLabel: "Delete and search again",
        destructive: true,
        run: function () { return queueHistory(detail, null, true); }
      });
    });
    bar.appendChild(searchFresh);
    var removeCards = el("button", "btn btn-outline btn-sm", "Remove stored credit card emails");
    removeCards.type = "button";
    removeCards.addEventListener("click", function () {
      askChoice({
        title: "Remove stored credit card emails?",
        message: "Deletes the stored emails of " + detail.email + " that are credit card bills, statements or due reminders, " +
          "and the payments read from them. This cannot be undone. Nothing they see changes.",
        confirmLabel: "Remove emails",
        destructive: true,
        run: function () {
          return apiPost("/admin/api/users/" + encodeURIComponent(detail.id) + "/remove-credit-card-emails", {})
            .then(function (result) {
              showStatus(result.message || "Done.", false);
              return load(true);
            });
        }
      });
    });
    bar.appendChild(removeCards);
    var removeBank = el("button", "btn btn-outline btn-sm", "Remove stored bank and card emails");
    removeBank.type = "button";
    removeBank.addEventListener("click", function () {
      askChoice({
        title: "Remove stored bank and card emails?",
        message: "Deletes the stored emails of " + detail.email + " that come from a bank or card issuer or read like a card alert, " +
          "credit card bill or statement, and the files attached to them. Bank alerts that counted as payments are kept as plain " +
          "payment records (date, amount, currency only); other payments read from these emails are deleted. The model-written notes " +
          "on suggestions that cited these emails are cleared. This cannot be undone. Nothing they see changes.",
        confirmLabel: "Remove emails",
        destructive: true,
        run: function () {
          return apiPost("/admin/api/users/" + encodeURIComponent(detail.id) + "/remove-bank-emails", {})
            .then(function (result) {
              showStatus(result.message || "Done.", false);
              return load(true);
            });
        }
      });
    });
    bar.appendChild(removeBank);
    wrap.appendChild(bar);

    var cols = el("div", "pay-cols");
    wrap.appendChild(cols);
    var chosen = statusSelection[detail.id];
    var selIndex = 0;
    rows.forEach(function (r, i) { if (r.id === chosen) selIndex = i; });
    var filterMode = "all";
    var openRows = {};

    function badgeFor(s) {
      var spec = LIFECYCLE[s.lifecycle_status];
      var b = el("span", "badge badge-dot " + (spec ? spec.cls : "badge-muted"), spec ? spec.label : "Not worked out yet");
      return b;
    }

    function draw(focusIndex) {
      clear(cols);
      var s = rows[selIndex];

      // Left: the person's subscriptions.
      var master = el("nav", "pay-master");
      master.setAttribute("aria-label", "Subscriptions");
      master.appendChild(el("h3", "pay-master-title", "Subscriptions · " + rows.length));
      var buttons = [];
      rows.forEach(function (r, i) {
        var item = el("button", "pay-item");
        item.type = "button";
        if (i === selIndex) item.setAttribute("aria-current", "true");
        var top = el("span", "pay-item-top");
        top.appendChild(el("span", "pay-item-name", r.service_name));
        top.appendChild(badgeFor(r));
        item.appendChild(top);
        var meta = el("span", "pay-item-meta");
        meta.appendChild(el("span", "", r.frequency));
        meta.appendChild(el("span", "", "Last paid " + (r.last_payment_at ? fmtDay(r.last_payment_at) : "—")));
        item.appendChild(meta);
        item.addEventListener("click", function () {
          if (i === selIndex) return;
          selIndex = i;
          statusSelection[detail.id] = r.id;
          filterMode = "all";
          openRows = {};
          draw(i);
        });
        buttons.push(item);
        master.appendChild(item);
      });
      cols.appendChild(master);

      // Right: the chosen subscription.
      var panel = el("div", "pay-detail");
      var head = el("div", "pay-detail-head");
      var headText = el("div");
      var title = el("div", "pay-detail-title");
      title.appendChild(el("h3", "", s.service_name));
      title.appendChild(badgeFor(s));
      headText.appendChild(title);
      var why = [];
      if (s.reason) why.push(s.reason);
      why.push("last payment " + (s.last_payment_at ? fmtDay(s.last_payment_at) : "—"));
      why.push("next expected " + (s.expected_next_payment_at ? fmtDay(s.expected_next_payment_at) : "—"));
      if (s.ends_on) why.push("access ends " + fmtDay(s.ends_on));
      if (s.inactive_since) why.push("inactive since " + fmtDay(s.inactive_since) + (s.inactive_source ? " (" + s.inactive_source + ")" : ""));
      if (s.still_active_taps > 0) why.push("Still active tapped " + plural(s.still_active_taps, "time", "times"));
      if (s.last_bill_at && !s.last_payment_at) why.push("last bill " + fmtDay(s.last_bill_at));
      headText.appendChild(el("p", "pay-line", why.join(" · ")));
      head.appendChild(headText);

      if (s.history_status === "done" || s.history_status === "failed") {
        var acts = el("div", "person-actions");
        var again = el("button", "btn btn-outline btn-sm", "Search again");
        again.type = "button";
        again.setAttribute("aria-label", "Search history again for " + s.service_name);
        again.addEventListener("click", function () {
          askChoice({
            title: "Search again?",
            message: "Looks through the last 12 months of billing emails for " + s.service_name +
              " again, in the background. Emails already found are not read twice.",
            confirmLabel: "Search again",
            destructive: false,
            run: function () { return queueHistory(detail, s.id); }
          });
        });
        acts.appendChild(again);
        var fresh = el("button", "btn btn-outline btn-sm", "From scratch");
        fresh.type = "button";
        fresh.setAttribute("aria-label", "Delete history findings and search again for " + s.service_name);
        fresh.addEventListener("click", function () {
          askChoice({
            title: "Search again from scratch?",
            message: "Deletes the payments the history search recorded for " + s.service_name +
              " (payments from the sync or approvals are kept, but read again with today\u2019s rules: changed ones are updated, ones that are no longer payments are removed), then searches the last 12 months again in the background.",
            confirmLabel: "Delete and search again",
            destructive: true,
            run: function () { return queueHistory(detail, s.id, true); }
          });
        });
        acts.appendChild(fresh);
        head.appendChild(acts);
      }
      panel.appendChild(head);

      var list = s.payment_list || [];
      var nCounted = list.filter(function (p) { return p.counted; }).length;
      var filters = el("div", "pay-filters");
      filters.setAttribute("role", "group");
      filters.setAttribute("aria-label", "Filter payments");
      var table = null;
      var fillRows = function () {};
      [["all", "All", list.length], ["counted", "Counted", nCounted], ["not", "Not counted", list.length - nCounted]].forEach(function (f) {
        var b = el("button", "pill-btn", f[1] + " " + f[2]);
        b.type = "button";
        b.setAttribute("aria-pressed", String(filterMode === f[0]));
        b.addEventListener("click", function () {
          filterMode = f[0];
          Array.prototype.forEach.call(filters.querySelectorAll(".pill-btn"), function (x) { x.setAttribute("aria-pressed", "false"); });
          b.setAttribute("aria-pressed", "true");
          fillRows();
        });
        filters.appendChild(b);
      });
      var searched = (s.history_label || "Not searched yet");
      if (/^Since /.test(searched)) searched = "Searched " + searched.charAt(0).toLowerCase() + searched.slice(1);
      var bits = [searched].concat(s.history_details || []);
      filters.appendChild(el("span", "pay-searched", bits.join(" · ")));
      panel.appendChild(filters);

      if (list.length === 0) {
        panel.appendChild(emptyCard("No payments recorded yet. Run a history search."));
      } else {
        var box = el("div", "table-container");
        var scroll = el("div", "table-scroll");
        table = el("table", "pay-table");
        var thead = el("thead");
        var htr = el("tr");
        [["Date", "col-date"], ["What", ""], ["Amount", "col-amount"], ["Status", "col-status"], ["Source", "col-source"]].forEach(function (h) {
          var th = el("th", h[1], h[0]);
          th.scope = "col";
          htr.appendChild(th);
        });
        thead.appendChild(htr);
        table.appendChild(thead);
        var tbody = el("tbody");
        table.appendChild(tbody);
        scroll.appendChild(table);
        box.appendChild(scroll);
        panel.appendChild(box);
        panel.appendChild(el("p", "pay-hint", "Select a row to see why it counts, or doesn’t, and the full email subject."));

        fillRows = function () {
          clear(tbody);
          var shown = 0;
          list.forEach(function (p, idx) {
            if (filterMode === "counted" && !p.counted) return;
            if (filterMode === "not" && p.counted) return;
            shown++;
            appendPaymentRows(tbody, p, idx);
          });
          if (shown === 0) {
            var tr = el("tr");
            var td = el("td", "muted", "No payments in this view.");
            td.colSpan = 5;
            tr.appendChild(td);
            tbody.appendChild(tr);
          }
        };
        var appendPaymentRows = function (tbody, p, idx) {
          var tr = el("tr", "pay-row");
          var more = null;
          var toggle = el("button", "pay-toggle", fmtDay(p.paid_at));
          toggle.type = "button";
          toggle.setAttribute("aria-expanded", String(!!openRows[idx]));
          function flip() {
            openRows[idx] = !openRows[idx];
            toggle.setAttribute("aria-expanded", String(openRows[idx]));
            more.hidden = !openRows[idx];
          }
          tr.addEventListener("click", function (e) { if (e.target !== toggle) flip(); });
          toggle.addEventListener("click", flip);
          var dateTd = el("td");
          dateTd.appendChild(toggle);
          tr.appendChild(dateTd);

          var what = el("td");
          what.appendChild(el("span", "pay-what", KIND_WORDS[p.kind] || "Welcome or other"));
          if (p.subject) {
            var sub = el("span", "pay-subject", p.subject);
            sub.title = p.subject;
            what.appendChild(sub);
          }
          tr.appendChild(what);

          tr.appendChild(el("td", "num nowrap col-amount", p.amount === null ? "—" : p.amount + (p.currency ? " " + p.currency : "")));

          var st = el("td");
          var chip;
          if (p.counted) chip = el("span", "badge badge-success", "Counted");
          else if (p.kind === "invoice") chip = el("span", "badge " + (/not found/.test(p.note || "") ? "badge-warning" : "badge-info"), "Bill");
          else chip = el("span", "badge badge-muted", "Not counted");
          if (p.note) { st.title = p.note; chip.title = p.note; }
          st.appendChild(chip);
          if (!p.counted && p.note) st.appendChild(el("div", "pay-note", p.note));
          tr.appendChild(st);

          tr.appendChild(el("td", "", p.source));
          tbody.appendChild(tr);

          more = el("tr", "pay-more");
          more.hidden = !openRows[idx];
          var mtd = el("td");
          mtd.colSpan = 5;
          var dl = el("dl", "pay-facts");
          [
            ["Email subject", p.discarded ? "— (bank alert read and discarded: only date, amount and currency kept)" : (p.subject || "—")],
            ["Kind", p.kind],
            ["Document type", p.document_type || "—"],
            ["Paid status", p.paid_status || "—"],
            ["Due date", p.kind === "invoice" ? (p.due_on ? fmtDay(p.due_on) : "—") : null],
            ["Amount", p.amount === null ? "—" : p.amount + (p.currency ? " " + p.currency : "")],
            ["Source", p.source],
            [p.counted ? "Why it counts" : "Why it doesn’t count", p.note || "—"]
          ].forEach(function (f) {
            if (f[1] === null) return;
            dl.appendChild(el("dt", "", f[0]));
            dl.appendChild(el("dd", "", f[1]));
          });
          mtd.appendChild(dl);
          more.appendChild(mtd);
          tbody.appendChild(more);
        };
        fillRows();
      }
      cols.appendChild(panel);
      if (typeof focusIndex === "number") buttons[focusIndex].focus();
    }
    draw();
    return wrap;
  }

  // --- one person's features --------------------------------------------

  /**
   * Every feature and whether this person has it, with the reason. Read
   * only: who has a feature is changed on the feature itself.
   */
  function buildPersonFeatures(detail) {
    if (!detail.features) return emptyCard("Could not load features for this person.");
    if (detail.features.length === 0) return emptyCard("No features have been set up yet.");

    return buildTable(["Feature", "Rollout", "For this user"], detail.features, function (f) {
      var tr = document.createElement("tr");
      rowLink(tr, "Open " + f.name, function () { go("features/" + f.id); });

      var name = document.createElement("td");
      name.appendChild(el("div", "cell-title", f.name));
      var key = el("div", "cell-sub");
      key.appendChild(codeEl(f.key));
      name.appendChild(key);
      tr.appendChild(name);

      var rollout = document.createElement("td");
      rollout.appendChild(rolloutBadge(f.rollout));
      tr.appendChild(rollout);

      var state = document.createElement("td");
      var why;
      if (f.enabled && f.rollout === "everyone") why = "Everyone";
      else if (f.enabled) why = "Added on " + fmtDate(f.added_at) + (f.added_by ? " " + addedBy(f.added_by) : "");
      else if (f.listed) why = "Listed since " + fmtDate(f.added_at) + ", but the feature is off";
      else if (f.rollout === "selected") why = "Not on the list";
      else why = "Off for everyone";
      state.appendChild(el("span", "badge " + (f.enabled ? "badge-success" : "badge-muted"), f.enabled ? "On" : "Off"));
      state.appendChild(el("div", "cell-sub", why));
      tr.appendChild(state);
      return tr;
    });
  }

  // --- the features list ------------------------------------------------

  function featureMatches(f) {
    if (featureTag && (f.tags || []).indexOf(featureTag) === -1) return false;
    if (!featureFilter) return true;
    var q = featureFilter.toLowerCase();
    return f.name.toLowerCase().indexOf(q) !== -1 || f.key.toLowerCase().indexOf(q) !== -1;
  }

  function buildFeatureRow(f) {
    var tr = document.createElement("tr");
    function open() { go("features/" + f.id); }
    rowLink(tr, "Open " + f.name, open);

    var feature = document.createElement("td");
    feature.appendChild(el("div", "cell-title", f.name));
    var key = el("div", "cell-sub");
    key.appendChild(codeEl(f.key));
    feature.appendChild(key);
    if (f.description) feature.appendChild(el("div", "cell-sub", f.description));
    tr.appendChild(feature);

    var tags = document.createElement("td");
    tags.appendChild(tagList(f.tags));
    tr.appendChild(tags);

    var rollout = document.createElement("td");
    rollout.appendChild(rolloutBadge(f.rollout));
    tr.appendChild(rollout);

    var who = document.createElement("td");
    var label = whoHas(f);
    who.appendChild(el("div", "nowrap" + (label === "No one" ? " muted" : ""), label));
    // Off with people listed: they are waiting, not forgotten.
    if (f.rollout === "off" && f.listed_users > 0) {
      who.appendChild(el("div", "cell-sub", plural(f.listed_users, "person", "people") + " listed"));
    }
    tr.appendChild(who);

    var openCell = document.createElement("td");
    var btn = el("button", "btn btn-outline btn-sm", "Open");
    btn.type = "button";
    btn.tabIndex = -1;
    btn.addEventListener("click", function (e) { e.stopPropagation(); open(); });
    openCell.appendChild(btn);
    tr.appendChild(openCell);
    return tr;
  }

  function renderFeatures() {
    var root = el("div", "stack");
    var all = features.features || [];

    var head = el("div", "page-head");
    var titles = document.createElement("div");
    titles.appendChild(el("h2", "", "Features"));
    titles.appendChild(el("div", "cell-sub", "Open a feature to change who has it."));
    head.appendChild(titles);
    var newBtn = el("button", "btn btn-primary", "New feature");
    newBtn.type = "button";
    newBtn.addEventListener("click", openNewFeature);
    head.appendChild(newBtn);
    root.appendChild(head);

    // Tags in use, most used first.
    var counts = {};
    all.forEach(function (f) { (f.tags || []).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; }); });
    var tags = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
    if (featureTag && !counts[featureTag]) featureTag = "";

    var controls = el("div", "section");
    var labelEl = el("label", "sr-only", "Filter features");
    labelEl.setAttribute("for", "feature-filter");
    var input = document.createElement("input");
    input.className = "input";
    input.id = "feature-filter";
    input.type = "search";
    input.placeholder = "Filter by name or key";
    input.value = featureFilter;
    input.style.maxWidth = "24rem";
    input.addEventListener("input", function () {
      featureFilter = input.value;
      renderView({ keepFocus: "feature-filter" });
    });
    controls.appendChild(labelEl);
    controls.appendChild(input);

    if (tags.length) {
      var pills = el("div", "pills");
      pills.setAttribute("role", "group");
      pills.setAttribute("aria-label", "Filter by tag");
      pills.appendChild(el("span", "cell-sub", "Tags"));
      [""].concat(tags).forEach(function (t) {
        var b = el("button", "pill-btn", t || "All");
        b.type = "button";
        b.setAttribute("aria-pressed", String(featureTag === t));
        b.addEventListener("click", function () { featureTag = t; renderView(); });
        pills.appendChild(b);
      });
      controls.appendChild(pills);
    }
    root.appendChild(controls);

    var shown = all.filter(featureMatches);
    if (all.length === 0) {
      root.appendChild(emptyCard("No features yet."));
      return root;
    }
    if (shown.length === 0) {
      root.appendChild(emptyCard("No feature matches that filter."));
      return root;
    }

    root.appendChild(buildTable(["Feature", "Tags", "Rollout", "Who has it", "Open"], shown, buildFeatureRow));

    var by = { off: 0, selected: 0, everyone: 0 };
    shown.forEach(function (f) { by[f.rollout] = (by[f.rollout] || 0) + 1; });
    root.appendChild(el("p", "footer-line", [
      plural(shown.length, "feature", "features"),
      by.selected + " on for selected users",
      by.everyone + " on for everyone",
      by.off + " off"
    ].join(" · ")));
    return root;
  }

  // --- one feature ------------------------------------------------------

  function rolloutExplained(f) {
    if (f.rollout === "everyone") {
      return "On for all " + plural(f.total_users, "user", "users") +
        ", and anyone who signs up. The list below is kept in case you switch back.";
    }
    if (f.rollout === "selected") {
      if (f.listed_users === 0) return "On for the users listed, but no one is listed yet, so no one sees it.";
      return "On for the " + plural(f.listed_users, "user", "users") + " listed. Everyone else doesn’t see it.";
    }
    return "Off for everyone, including anyone listed. No one sees it.";
  }

  function askRollout(f, next) {
    var name = "“" + f.name + "”";
    var opts;
    if (next === "off") {
      opts = {
        title: "Turn off for everyone?",
        message: name + " will stop showing for everyone who has it now. The list of users is kept.",
        confirmLabel: "Turn off",
        destructive: true
      };
    } else if (next === "everyone") {
      opts = {
        title: "Turn on for everyone?",
        message: "All " + plural(f.total_users, "user", "users") + " will get " + name +
          ", and so will anyone who signs up from now on.",
        confirmLabel: "Turn on for everyone"
      };
    } else {
      opts = {
        title: "Turn on for selected users only?",
        message: (f.listed_users === 0
          ? "No one is listed yet, so no one will have " + name + " until you add users."
          : "Only the " + plural(f.listed_users, "user", "users") + " listed will have " + name + ".") +
          (f.rollout === "everyone" ? " Everyone else loses it." : ""),
        confirmLabel: "Switch to selected users",
        destructive: f.rollout === "everyone"
      };
    }
    opts.run = function () {
      return apiPost("/admin/api/features/" + encodeURIComponent(f.id) + "/rollout", { rollout: next })
        .then(function (result) {
          showStatus(result.message || "Rollout changed.", false);
          forgetFeatures();
          return load(true);
        });
    };
    askChoice(opts);
  }

  function buildDetailsCard(f) {
    var card = el("div", "card");
    var header = el("div", "card-header split");
    header.appendChild(el("h3", "", "Details"));
    header.appendChild(el("span", "cell-sub", "Created " + fmtDate(f.created_at)));
    card.appendChild(header);

    var original = { name: f.name, description: f.description || "", tags: (f.tags || []).slice() };
    var draft = drafts[f.id] || { name: original.name, description: original.description, tags: original.tags.slice() };

    var form = el("form", "card-body form");
    form.noValidate = true;

    var nameWrap = document.createElement("div");
    var nameLabel = el("label", "label", "Name");
    nameLabel.setAttribute("for", "fd-name");
    var nameInput = document.createElement("input");
    nameInput.className = "input";
    nameInput.id = "fd-name";
    nameInput.maxLength = 80;
    nameInput.value = draft.name;
    nameWrap.appendChild(nameLabel);
    nameWrap.appendChild(nameInput);
    form.appendChild(nameWrap);

    var keyWrap = document.createElement("div");
    keyWrap.appendChild(el("div", "label", "Key"));
    var keyLine = el("div", "pills");
    keyLine.appendChild(codeEl(f.key));
    keyLine.appendChild(el("span", "cell-sub", "Used in code, can’t be changed"));
    keyWrap.appendChild(keyLine);
    form.appendChild(keyWrap);

    var descWrap = document.createElement("div");
    var descLabel = el("label", "label", "Description");
    descLabel.setAttribute("for", "fd-description");
    var descInput = document.createElement("textarea");
    descInput.className = "input textarea";
    descInput.id = "fd-description";
    descInput.rows = 3;
    descInput.maxLength = 500;
    descInput.value = draft.description;
    descWrap.appendChild(descLabel);
    descWrap.appendChild(descInput);
    form.appendChild(descWrap);

    var tagsWrap = document.createElement("div");
    var tagsLabel = el("label", "label", "Tags");
    tagsLabel.setAttribute("for", "fd-tags");
    var editor = tagEditor("fd-tags", draft.tags, function (tags) { draft.tags = tags; sync(); });
    tagsWrap.appendChild(tagsLabel);
    tagsWrap.appendChild(editor.node);
    form.appendChild(tagsWrap);

    var actions = el("div", "form-actions");
    var cancel = el("button", "btn btn-outline", "Cancel");
    cancel.type = "button";
    var save = el("button", "btn btn-primary", "Save changes");
    save.type = "submit";
    actions.appendChild(cancel);
    actions.appendChild(save);
    form.appendChild(actions);

    function dirty() {
      return draft.name !== original.name || draft.description !== original.description ||
        JSON.stringify(draft.tags) !== JSON.stringify(original.tags);
    }
    function sync() {
      if (dirty()) drafts[f.id] = draft; else delete drafts[f.id];
      save.disabled = !dirty() || !draft.name.trim();
      cancel.disabled = !dirty();
    }

    nameInput.addEventListener("input", function () { draft.name = nameInput.value; sync(); });
    descInput.addEventListener("input", function () { draft.description = descInput.value; sync(); });
    cancel.addEventListener("click", function () {
      delete drafts[f.id];
      renderView();
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      draft.tags = editor.get();
      if (!dirty() || !draft.name.trim()) return;
      save.disabled = true;
      apiSend("PATCH", "/admin/api/features/" + encodeURIComponent(f.id), {
        name: draft.name,
        description: draft.description,
        tags: draft.tags
      }).then(function (result) {
        delete drafts[f.id];
        showStatus(result.message || "Changes saved.", false);
        forgetFeatures();
        return load(true);
      }).catch(function (err) {
        showStatus(err.message || "Could not save the changes.", true);
        sync();
      });
    });

    sync();
    card.appendChild(form);
    return card;
  }

  function buildRolloutCard(f) {
    var card = el("div", "card");
    var header = el("div", "card-header");
    header.appendChild(el("h3", "", "Rollout"));
    card.appendChild(header);

    var body = el("div", "card-body form");
    var seg = el("div", "seg");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "Who has this feature");
    ROLLOUTS.forEach(function (r) {
      var b = el("button", "", r.label);
      b.type = "button";
      b.setAttribute("aria-pressed", String(f.rollout === r.value));
      b.addEventListener("click", function () {
        if (f.rollout !== r.value) askRollout(f, r.value);
      });
      seg.appendChild(b);
    });
    body.appendChild(seg);
    body.appendChild(el("p", "muted", rolloutExplained(f))).style.margin = "0";
    card.appendChild(body);
    return card;
  }

  function buildUsersCard(data) {
    var f = data.feature;
    var users = data.users || [];
    var card = el("div", "card");
    var header = el("div", "card-header split");
    header.appendChild(el("h3", "", "Users with this feature"));
    header.appendChild(el("span", "badge badge-muted", plural(users.length, "user", "users")));
    card.appendChild(header);

    var body = el("div", "card-body form");

    if (f.rollout !== "selected") {
      body.appendChild(el("p", "cell-sub", f.rollout === "everyone"
        ? "Everyone has this feature right now. This list only counts when the rollout is Selected users."
        : "The feature is off, so no one on this list has it yet.")).style.margin = "0";
    }

    // Add users: search, pick one or more, add.
    var addWrap = document.createElement("div");
    var addLabel = el("label", "label", "Add users");
    addLabel.setAttribute("for", "fu-search");
    addWrap.appendChild(addLabel);
    var row = el("div", "search-row");
    var input = document.createElement("input");
    input.className = "input";
    input.id = "fu-search";
    input.type = "search";
    input.autocomplete = "off";
    input.placeholder = "Type an email or name";
    var addBtn = el("button", "btn btn-primary", "Add");
    addBtn.type = "button";
    addBtn.disabled = true;
    row.appendChild(input);
    row.appendChild(addBtn);
    addWrap.appendChild(row);
    var matchesEl = el("div", "match-list");
    matchesEl.setAttribute("aria-live", "polite");
    matchesEl.style.marginTop = "0.5rem";
    addWrap.appendChild(matchesEl);
    body.appendChild(addWrap);

    var selected = {};
    var results = [];
    var seq = 0;
    var timer = null;

    function selectedIds() { return Object.keys(selected).filter(function (id) { return selected[id]; }); }

    function drawMatches(message) {
      clear(matchesEl);
      if (message) { matchesEl.appendChild(el("div", "cell-sub", message)); }
      results.forEach(function (u) {
        var b = el("button", "match");
        b.type = "button";
        b.setAttribute("aria-pressed", String(Boolean(selected[u.id])));
        var who = document.createElement("span");
        who.appendChild(el("div", "cell-title", personName(u)));
        who.appendChild(el("div", "cell-sub", u.email));
        b.appendChild(who);
        b.appendChild(el("span", "cell-sub nowrap", "Joined " + fmtDate(u.created_at)));
        b.addEventListener("click", function () {
          selected[u.id] = !selected[u.id];
          b.setAttribute("aria-pressed", String(selected[u.id]));
          var n = selectedIds().length;
          addBtn.disabled = n === 0;
          addBtn.textContent = n > 1 ? "Add " + n : "Add";
        });
        matchesEl.appendChild(b);
      });
    }

    input.addEventListener("input", function () {
      clearTimeout(timer);
      var q = input.value.trim();
      timer = setTimeout(function () {
        var mine = ++seq;
        if (q.length < 2) {
          // Keep anyone already picked; drop the rest.
          results = results.filter(function (u) { return selected[u.id]; });
          drawMatches("");
          return;
        }
        apiGet("/admin/api/features/" + encodeURIComponent(f.id) + "/user-search?q=" + encodeURIComponent(q))
          .then(function (res) {
            if (mine !== seq) return;
            var picked = results.filter(function (u) { return selected[u.id]; });
            var fresh = (res.users || []).filter(function (u) { return !selected[u.id]; });
            results = picked.concat(fresh);
            drawMatches(fresh.length || picked.length ? "" : "No one matches, or they’re already on the list.");
          })
          .catch(function (err) { if (mine === seq) drawMatches(err.message || "Could not search."); });
      }, 250);
    });

    addBtn.addEventListener("click", function () {
      var ids = selectedIds();
      if (!ids.length) return;
      addBtn.disabled = true;
      apiPost("/admin/api/features/" + encodeURIComponent(f.id) + "/users", { userIds: ids })
        .then(function (result) {
          showStatus(result.message || "Added.", false);
          forgetFeatures();
          return load(true);
        })
        .catch(function (err) {
          addBtn.disabled = false;
          showStatus(err.message || "Could not add those users.", true);
        });
    });

    if (users.length === 0) {
      body.appendChild(el("div", "empty", "No one has been added yet."));
    } else {
      body.appendChild(buildTable(["Person", "Added", "Remove"], users, function (u) {
        var tr = document.createElement("tr");
        var person = document.createElement("td");
        person.appendChild(el("div", "cell-title", personName(u)));
        person.appendChild(el("div", "cell-sub", u.email));
        tr.appendChild(person);

        var added = document.createElement("td");
        added.appendChild(el("div", "nowrap", fmtDate(u.added_at)));
        if (u.added_by) added.appendChild(el("div", "cell-sub", addedBy(u.added_by)));
        tr.appendChild(added);

        var removeCell = document.createElement("td");
        removeCell.style.textAlign = "right";
        var remove = el("button", "btn btn-ghost btn-sm", "Remove");
        remove.type = "button";
        remove.setAttribute("aria-label", "Remove " + u.email);
        remove.addEventListener("click", function () {
          function run() {
            return apiSend("DELETE", "/admin/api/features/" + encodeURIComponent(f.id) +
              "/users/" + encodeURIComponent(u.id))
              .then(function (result) {
                showStatus((u.email || "User") + " removed from " + f.name + ".", false);
                forgetFeatures();
                return load(true);
              });
          }
          // Only asked when it takes the feature away from them right now.
          if (f.rollout === "selected") {
            askChoice({
              title: "Remove " + u.email + "?",
              message: "They lose “" + f.name + "” straight away.",
              confirmLabel: "Remove",
              destructive: true,
              run: run
            });
          } else {
            run().catch(function (err) { showStatus(err.message || "Could not remove that user.", true); });
          }
        });
        removeCell.appendChild(remove);
        tr.appendChild(removeCell);
        return tr;
      }));
    }

    card.appendChild(body);
    return card;
  }

  function buildFeature(data) {
    var root = el("div", "stack");
    var back = el("button", "back", "← All features");
    back.type = "button";
    back.addEventListener("click", function () { go("features"); });
    root.appendChild(back);

    var head = el("div", "page-head");
    var titles = document.createElement("div");
    titles.appendChild(el("h2", "", data.feature.name));
    if (data.feature.description) titles.appendChild(el("div", "cell-sub", data.feature.description));
    head.appendChild(titles);
    head.appendChild(rolloutBadge(data.feature.rollout));
    root.appendChild(head);

    var grid = el("div", "feature-grid");
    var left = el("div", "stack");
    left.appendChild(buildDetailsCard(data.feature));
    left.appendChild(buildRolloutCard(data.feature));
    grid.appendChild(left);
    grid.appendChild(buildUsersCard(data));
    root.appendChild(grid);
    return root;
  }

  // --- new feature ------------------------------------------------------

  var KEY_PATTERN = /^[a-z][a-z0-9_]{2,49}$/;
  var nfDialog = document.getElementById("new-feature");
  var nfForm = document.getElementById("nf-form");
  var nfError = document.getElementById("nf-error");
  var nfKey = document.getElementById("nf-key");
  var nfName = document.getElementById("nf-name");
  var nfDescription = document.getElementById("nf-description");
  var nfTagsHost = document.getElementById("nf-tags-host");
  var nfSubmit = document.getElementById("nf-submit");
  var nfTags = null;

  function nfShowError(text) {
    nfError.textContent = text;
    nfError.hidden = !text;
  }

  function openNewFeature() {
    nfForm.reset();
    nfShowError("");
    clear(nfTagsHost);
    nfTags = tagEditor("nf-tags", [], null);
    nfTagsHost.appendChild(nfTags.node);
    nfSubmit.disabled = false;
    if (typeof nfDialog.showModal === "function") nfDialog.showModal();
    else nfDialog.setAttribute("open", "open");
    nfKey.focus();
  }

  function closeNewFeature() {
    if (typeof nfDialog.close === "function") nfDialog.close();
    else nfDialog.removeAttribute("open");
  }

  // Keys are lowercase snake_case, so type them that way.
  nfKey.addEventListener("input", function () {
    var v = nfKey.value.toLowerCase().split(" ").join("_").split("-").join("_");
    if (v !== nfKey.value) nfKey.value = v;
  });

  document.getElementById("nf-cancel").addEventListener("click", closeNewFeature);

  nfForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var key = nfKey.value.trim();
    var name = nfName.value.trim();
    var tags = nfTags ? nfTags.get() : [];
    if (!KEY_PATTERN.test(key)) {
      nfShowError("The key must be 3 to 50 lowercase letters, numbers or underscores, starting with a letter.");
      nfKey.focus();
      return;
    }
    if (features && (features.features || []).some(function (f) { return f.key === key; })) {
      nfShowError("A feature with the key " + key + " already exists.");
      nfKey.focus();
      return;
    }
    if (!name) {
      nfShowError("Give the feature a name.");
      nfName.focus();
      return;
    }
    nfShowError("");
    nfSubmit.disabled = true;
    apiPost("/admin/api/features", {
      key: key,
      name: name,
      description: nfDescription.value.trim(),
      tags: tags
    }).then(function (result) {
      closeNewFeature();
      forgetFeatures();
      flash = { text: "Created " + name + ". It’s off until you choose who gets it.", isError: false };
      go("features/" + result.feature.id);
    }).catch(function (err) {
      nfSubmit.disabled = false;
      nfShowError(err.message || "Could not create the feature.");
    });
  });

  // --- confirmation -----------------------------------------------------

  function askConfirm(user, action) {
    pending = { user: user, action: action };
    dialogEmailField.hidden = false;
    dialogConfirm.className = "btn btn-destructive";
    dialogEmail.value = "";
    dialogConfirm.disabled = true;

    if (action === "clear") {
      dialogTitle.textContent = "Clear data";
      dialogMessage.textContent =
        "This removes everything Verloq found for " + user.email +
        ": their subscriptions, invoices and stored files, and their mailbox connection. " +
        "Their account stays and they can sign in and reconnect. This cannot be undone.";
      dialogConfirm.textContent = "Clear data";
    } else {
      dialogTitle.textContent = "Delete user";
      dialogMessage.textContent =
        "This deletes " + user.email +
        " completely: their account, their subscriptions, invoices, stored files and " +
        "mailbox connections. They will not be able to sign in again. This cannot be undone.";
      dialogConfirm.textContent = "Delete user";
    }

    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "open");
    dialogEmail.focus();
  }

  /**
   * The same dialog for a change that needs a second look but not the
   * type-the-address guard deletion has: a feature's rollout, removing
   * someone from a feature. opts.run does the work and returns a promise.
   */
  function askChoice(opts) {
    pending = { run: opts.run };
    dialogTitle.textContent = opts.title;
    dialogMessage.textContent = opts.message;
    dialogConfirm.textContent = opts.confirmLabel;
    dialogConfirm.className = "btn " + (opts.destructive ? "btn-destructive" : "btn-primary");
    dialogEmailField.hidden = true;
    dialogConfirm.disabled = false;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "open");
    dialogConfirm.focus();
  }

  function closeDialog() {
    pending = null;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  dialogEmail.addEventListener("input", function () {
    dialogConfirm.disabled = !pending || !pending.user ||
      dialogEmail.value.trim().toLowerCase() !== String(pending.user.email).toLowerCase();
  });

  dialogCancel.addEventListener("click", closeDialog);

  dialogConfirm.addEventListener("click", function () {
    if (!pending) return;
    if (pending.run) {
      var run = pending.run;
      dialogConfirm.disabled = true;
      run().then(closeDialog, function (err) {
        closeDialog();
        showStatus(err.message || "That did not work.", true);
      });
      return;
    }
    var user = pending.user;
    var action = pending.action;
    var url = "/admin/api/users/" + encodeURIComponent(user.id) +
      (action === "clear" ? "/clear-data" : "/delete");

    dialogConfirm.disabled = true;
    apiPost(url).then(function (result) {
      closeDialog();
      showStatus(result.message || "Done.", false);
      delete detailCache[user.id];
      if (action === "delete") {
        // A deleted account has no page to go back to.
        overview = null;
        go("list");
        return;
      }
      return load(true);
    }).catch(function (err) {
      closeDialog();
      showStatus(err.message || "That did not work.", true);
    });
  });

  // --- routing ----------------------------------------------------------

  /**
   * The route lives in the URL fragment, so a person can be refreshed,
   * bookmarked and reached with the browser's back button. Without it a
   * reload always dumped you back on the list.
   */
  function routeFromHash() {
    var hash = (location.hash || "").replace(/^#/, "");
    return hash || "list";
  }

  function go(next) {
    if (routeFromHash() === next) { applyRoute(); return; }
    // Writing the hash fires hashchange, which is what actually navigates.
    location.hash = next === "list" ? "" : next;
    if (routeFromHash() !== next) applyRoute();
  }

  /** "list", "features", "features/<id>", or a user id. */
  function parseRoute(r) {
    if (r === "list") return { view: "people" };
    if (r === "features") return { view: "features" };
    if (r.indexOf("features/") === 0) return { view: "feature", id: decodeURIComponent(r.slice(9)) };
    var tabbed = /^(.+)\\?tab=([a-z]+)$/.exec(r);
    if (tabbed) return { view: "person", id: decodeURIComponent(tabbed[1]), tab: tabbed[2] };
    return { view: "person", id: r };
  }

  var navPeople = document.getElementById("nav-people");
  var navFeatures = document.getElementById("nav-features");

  function applyRoute() {
    route = routeFromHash();
    var parsed = parseRoute(route);
    var view = parsed.view;
    // A linked tab (#<id>?tab=mailboxes) is only taken if it is one we know.
    if (view === "person" && parsed.tab && TAB_IDS.indexOf(parsed.tab) !== -1) personTabs[parsed.id] = parsed.tab;
    var onFeatures = view === "features" || view === "feature";
    if (onFeatures) { navFeatures.setAttribute("aria-current", "page"); navPeople.removeAttribute("aria-current"); }
    else { navPeople.setAttribute("aria-current", "page"); navFeatures.removeAttribute("aria-current"); }
    if (flash) { showStatus(flash.text, flash.isError); flash = null; }
    else hideStatus();
    window.scrollTo(0, 0);
    load(false);
  }

  window.addEventListener("hashchange", applyRoute);

  function renderView(options) {
    var host = document.getElementById("view");
    try {
      renderInto(host, options);
    } catch (err) {
      // Better a visible message than the blank body an uncaught throw leaves
      // behind, which says nothing about what went wrong.
      clear(host);
      host.appendChild(el("p", "muted", "Could not draw this page."));
      showStatus((err && err.message) || "Something went wrong drawing the page.", true);
    }
  }

  function restoreFocus(options) {
    if (!options || !options.keepFocus) return;
    var again = document.getElementById(options.keepFocus);
    if (again) {
      again.focus();
      var end = again.value.length;
      try { again.setSelectionRange(end, end); } catch (e) {}
    }
  }

  function renderInto(host, options) {
    clear(host);
    var r = parseRoute(route);

    if (r.view === "features") {
      if (!features) { host.appendChild(el("p", "muted", "Loading…")); return; }
      host.appendChild(renderFeatures());
      restoreFocus(options);
      return;
    }

    if (r.view === "feature") {
      var data = featureCache[r.id];
      if (!data) { host.appendChild(el("p", "muted", "Loading…")); return; }
      host.appendChild(buildFeature(data));
      return;
    }

    if (r.view === "people") {
      // load() renders once before its requests resolve, so the page shows
      // something immediately rather than a blank body.
      if (!overview) { host.appendChild(el("p", "muted", "Loading\u2026")); return; }
      host.appendChild(renderList());
      restoreFocus(options);
      return;
    }

    var detail = detailCache[r.id];
    if (!detail) { host.appendChild(el("p", "muted", "Loading…")); return; }
    host.appendChild(buildPerson(detail));
  }

  function load(force) {
    var jobs = [];
    var r = parseRoute(route);
    if (r.view === "features" && (!features || force)) {
      jobs.push(apiGet("/admin/api/features").then(function (data) { features = data; }));
    }
    if (r.view === "feature" && (!featureCache[r.id] || force)) {
      var featureId = r.id;
      jobs.push(apiGet("/admin/api/features/" + encodeURIComponent(featureId)).then(function (data) {
        featureCache[featureId] = data;
      }));
    }
    if ((r.view === "people" || r.view === "person") && (!overview || force)) {
      jobs.push(apiGet("/admin/api/overview").then(function (data) { overview = data; }));
    }
    if (r.view === "person" && (!detailCache[r.id] || force)) {
      var id = r.id;
      jobs.push(apiGet("/admin/api/users/" + encodeURIComponent(id)).then(function (data) {
        detailCache[id] = data;
      }));
    }

    if (jobs.length === 0) { renderView(); return Promise.resolve(); }

    renderView();
    return Promise.all(jobs).then(function () {
      renderView();
    }).catch(function (err) {
      showStatus(err.message || "Could not load that.", true);
    });
  }

  applyRoute();
})();
</script>
</body>
</html>`;
}

/**
 * The Microsoft setup page.
 *
 * Plain server-rendered HTML with no scripting: its whole job is to answer
 * "are these credentials still good?" in one look, from a browser, on a
 * phone. Everything on it is either a yes/no or a value to paste into Azure.
 */
export function microsoftPage(opts: {
  checks: import("../lib/microsoftConfigCheck").AppCheck[];
  /** Microsoft-ish variables this server has under other names. */
  relatedVariables: string[];
  version?: string;
}): string {
  const version = escapeHtml(opts.version || "unknown");

  const badge = (status: string) => {
    switch (status) {
      case "ok": return '<span class="badge badge-success">Working</span>';
      case "unconfigured": return '<span class="badge badge-muted">Not set up</span>';
      case "unreachable": return '<span class="badge badge-warning">Could not check</span>';
      default: return '<span class="badge badge-destructive">Not recognised</span>';
    }
  };

  const cards = opts.checks
    .map((check) => {
      const variables = check.variables
        .map(
          (v) =>
            `<tr><td><code>${escapeHtml(v.name)}</code></td><td>${
              v.set
                ? '<span class="badge badge-success">Set</span>'
                : '<span class="badge badge-destructive">Missing</span>'
            }</td></tr>`
        )
        .join("");

      const code = check.code
        ? `<p class="cell-sub" style="margin:.5rem 0 0">Microsoft's code for this: <code>${escapeHtml(check.code)}</code></p>`
        : "";

      // Said out loud, so a green badge is never read as "everything is fine".
      const notChecked = check.notChecked.length
        ? `<p class="cell-sub" style="margin:1.25rem 0 .5rem">What this does not tell you</p>
           <ul class="muted" style="margin:0;padding-left:1.1rem;font-size:0.8125rem;line-height:1.55">
             ${check.notChecked.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}
           </ul>`
        : "";

      return `
      <section class="card">
        <div class="card-header" style="display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap">
          <strong>${escapeHtml(check.name)}</strong>
          ${badge(check.status)}
        </div>
        <div class="card-body">
          <p style="margin:0 0 1rem">${escapeHtml(check.detail)}</p>
          ${code}
          ${notChecked}

          ${
            check.clientId
              ? `<p class="cell-sub" style="margin:1.25rem 0 .5rem">Client ID this server is using — check it matches the app you are editing in Azure</p>
                 <p style="margin:0"><code>${escapeHtml(check.clientId)}</code></p>`
              : ""
          }

          <p class="cell-sub" style="margin:1.25rem 0 .5rem">Redirect URI — this must be registered in Azure, character for character</p>
          <p style="margin:0"><code>${escapeHtml(check.redirectUri)}</code></p>

          <p class="cell-sub" style="margin:1.25rem 0 .5rem">Permissions this asks for</p>
          <p style="margin:0">${check.scopes.map((sc) => `<code>${escapeHtml(sc)}</code>`).join(" &middot; ")}</p>

          <p class="cell-sub" style="margin:1.25rem 0 .5rem">Settings on this server</p>
          <div class="table-container"><div class="table-scroll"><table><tbody>${variables}</tbody></table></div></div>
        </div>
      </section>`;
    })
    .join("");

  /*
   * Shown only when something is missing. "I definitely set that" is almost
   * always a name mismatch -- the value is on the server under a name nothing
   * reads -- and the only way to see that from here is to say which names are
   * actually present.
   */
  const anythingMissing = opts.checks.some((c) => c.variables.some((v) => !v.set));
  const related = !anythingMissing
    ? ""
    : opts.relatedVariables.length
      ? `<section class="card">
           <div class="card-header"><strong>Other Microsoft settings on this server</strong></div>
           <div class="card-body">
             <p style="margin:0 0 1rem">
               These are set, but under names nothing reads. If a value you expected is in one
               of these, copy it to the name listed above instead. Names only — no value is shown.
             </p>
             <p style="margin:0">${opts.relatedVariables.map((n) => `<code>${escapeHtml(n)}</code>`).join(" &middot; ")}</p>
           </div>
         </section>`
      : `<section class="card">
           <div class="card-header"><strong>Other Microsoft settings on this server</strong></div>
           <div class="card-body">
             <p style="margin:0">
               None. This server has no Microsoft or Azure settings at all, under any name — so
               if you have added them somewhere, it is not to the service running this site.
               Check you are editing the same Railway service and environment, and that the
               deploy finished after the change.
             </p>
           </div>
         </section>`;

  return `<!doctype html>
<html lang="en">
<head>
${head("Microsoft setup")}
<style>
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8125rem;
    background: hsl(var(--muted));
    padding: 0.125rem 0.375rem;
    border-radius: 4px;
    overflow-wrap: anywhere;
  }
</style>
</head>
<body>
  <header class="topbar">
    <h1>Microsoft setup</h1>
    <div class="topbar-right">
      <span class="topbar-build" title="The commit this server was built from">build ${version}</span>
      <a class="btn btn-outline btn-sm" href="/admin">Back to console</a>
    </div>
  </header>

  <main>
    <div class="stack">
      <p class="muted" style="margin:0">
        Asked of Microsoft just now, without signing anyone in. This confirms the
        application exists; it cannot confirm the secret or the redirect URI,
        which Microsoft only tests during a real sign-in. No secret is shown on
        this page or written to the logs.
      </p>
      ${cards}
      ${related}
    </div>
  </main>
</body>
</html>`;
}
