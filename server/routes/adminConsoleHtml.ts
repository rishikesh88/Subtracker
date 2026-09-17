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
  .topbar-right { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }
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

  .person-head { display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-start; justify-content: space-between; }
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
    .topbar { padding: 0 1rem; }
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
<body data-csrf="${csrfToken}">
  <header class="topbar">
    <h1>Verloq Admin</h1>
    <div class="topbar-right">
      <span class="topbar-build" title="The commit this server was built from">build ${version}</span>
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
      <div>
        <label class="label" for="dialog-email">Type the email address to confirm</label>
        <input class="input" id="dialog-email" type="text" autocomplete="off" spellcheck="false">
      </div>
      <div class="dialog-actions">
        <button class="btn btn-outline" type="button" id="dialog-cancel">Cancel</button>
        <button class="btn btn-destructive" type="button" id="dialog-confirm" disabled>Confirm</button>
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

  // "list" or a user id. The whole reason this is a route rather than an
  // expanding row: three sub-tables side by side inside a table cell
  // overlapped each other and became unreadable.
  var route = "list";
  var overview = null;
  var detailCache = {};
  var filter = "";
  var pending = null;

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

  function apiPost(url) {
    return fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "x-admin-csrf": CSRF }
    }).then(handle);
  }

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

  function buildPerson(detail) {
    var root = document.createElement("div");
    root.className = "stack";

    var back = el("button", "back", "← All people");
    back.type = "button";
    back.addEventListener("click", function () { go("list"); });
    root.appendChild(back);

    var headCard = el("div", "card");
    var headBody = el("div", "card-body person-head");

    var who = document.createElement("div");
    var title = el("h2", "", personName(detail));
    who.appendChild(title);
    who.appendChild(el("div", "cell-sub", detail.email));
    var meta = [];
    if (detail.organization_name) meta.push(detail.organization_name);
    meta.push("Joined " + fmtDate(detail.created_at));
    meta.push(detail.email_verified ? "Verified" : "Not verified");
    who.appendChild(el("div", "cell-sub", meta.join(" · ")));
    headBody.appendChild(who);

    var actions = el("div", "person-actions");
    var clearBtn = el("button", "btn btn-outline", "Clear data");
    clearBtn.type = "button";
    clearBtn.addEventListener("click", function () { askConfirm(detail, "clear"); });
    var deleteBtn = el("button", "btn btn-destructive", "Delete user");
    deleteBtn.type = "button";
    deleteBtn.addEventListener("click", function () { askConfirm(detail, "delete"); });
    actions.appendChild(clearBtn);
    actions.appendChild(deleteBtn);
    headBody.appendChild(actions);

    headCard.appendChild(headBody);
    root.appendChild(headCard);

    // Each section is full width and stacked. Nothing sits beside anything
    // else, which is what broke the previous layout.
    var mailboxes = detail.mailboxes || [];
    root.appendChild(section("Mailboxes", mailboxes.length
      ? buildTable(["Provider", "Address", "Last sync", "Status"], mailboxes, function (m) {
          var tr = document.createElement("tr");
          tr.appendChild(el("td", "", m.provider === "gmail" ? "Gmail" : "Outlook"));
          tr.appendChild(el("td", "", m.address));
          var last = document.createElement("td");
          last.appendChild(el("div", "nowrap", fmtDate(m.last_sync)));
          if (m.last_sync) last.appendChild(el("div", "cell-sub", fmtRelative(m.last_sync)));
          tr.appendChild(last);
          var status = document.createElement("td");
          var bad = m.sync_status === "error";
          status.appendChild(el("span", "badge " + (bad ? "badge-destructive" : "badge-muted"), m.sync_status || "idle"));
          if (bad && m.sync_error) {
            var err = el("div", "cell-sub", m.sync_error);
            err.style.color = "hsl(var(--destructive))";
            status.appendChild(err);
          }
          tr.appendChild(status);
          return tr;
        })
      : emptyCard("No mailbox connected.")));

    var subs = detail.subscriptions_detail || [];
    root.appendChild(section("Subscriptions", subs.length
      ? buildTable(["Service", "Amount", "Frequency", "Status", "Next billing", "Invoices"], subs, function (s) {
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
        })
      : emptyCard("Nothing found yet.")));

    var syncs = detail.recent_syncs || [];
    root.appendChild(section("Recent syncs", syncs.length
      ? buildTable(["Status", "Started", "Emails", "Suggestions", "Detail"], syncs, function (j) {
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
        })
      : emptyCard("No sync has been recorded for this account yet.")));

    return root;
  }

  // --- confirmation -----------------------------------------------------

  function askConfirm(user, action) {
    pending = { user: user, action: action };
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

  function closeDialog() {
    pending = null;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  dialogEmail.addEventListener("input", function () {
    dialogConfirm.disabled = !pending ||
      dialogEmail.value.trim().toLowerCase() !== String(pending.user.email).toLowerCase();
  });

  dialogCancel.addEventListener("click", closeDialog);

  dialogConfirm.addEventListener("click", function () {
    if (!pending) return;
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

  function applyRoute() {
    route = routeFromHash();
    hideStatus();
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

  function renderInto(host, options) {
    clear(host);

    if (route === "list") {
      // load() renders once before its requests resolve, so the page shows
      // something immediately rather than a blank body.
      if (!overview) { host.appendChild(el("p", "muted", "Loading\u2026")); return; }
      host.appendChild(renderList());
      if (options && options.keepFocus) {
        var again = document.getElementById(options.keepFocus);
        if (again) {
          again.focus();
          var end = again.value.length;
          try { again.setSelectionRange(end, end); } catch (e) {}
        }
      }
      return;
    }

    var detail = detailCache[route];
    if (!detail) { host.appendChild(el("p", "muted", "Loading…")); return; }
    host.appendChild(buildPerson(detail));
  }

  function load(force) {
    var jobs = [];
    if (!overview || force) {
      jobs.push(apiGet("/admin/api/overview").then(function (data) { overview = data; }));
    }
    if (route !== "list" && (!detailCache[route] || force)) {
      var id = route;
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
