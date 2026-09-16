/**
 * Presentation layer for the private admin console.
 *
 * Plain server-rendered HTML -- not React, not part of the Vite client
 * bundle. Everything (styles, script) is inlined so the page needs no
 * network access beyond its own API calls. See server/routes/admin.ts for
 * the routes this is rendered from and the JSON contract it talks to.
 */

function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Shared by both pages so the login form and the console always match. */
const baseStyles = `
  :root {
    --accent: #6366D8;
    --accent-strong: #4F52C4;
    --ink: #1A1830;
    --body: #494F63;
    --muted: #6E7489;
    --rule: #E2E4EA;
    --ground: #F2F3F6;
    --surface: #FFFFFF;
    --red: #B23A32;
    --red-bg: #FBEAE8;
    --amber: #8A6014;
    --amber-bg: #FBF3DC;
    --green: #1F7A5C;
    --green-bg: #E3F3EC;
    --shadow: 0 1px 2px rgba(26, 24, 48, 0.06), 0 8px 24px rgba(26, 24, 48, 0.08);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --accent: #8689F2;
      --accent-strong: #A0A3F7;
      --ink: #F0EFF7;
      --body: #C6C9DA;
      --muted: #9296AC;
      --rule: #35364A;
      --ground: #15141E;
      --surface: #1F1E2C;
      --red: #E38A82;
      --red-bg: rgba(226, 104, 95, 0.16);
      --amber: #E3BE71;
      --amber-bg: rgba(224, 177, 82, 0.16);
      --green: #6BCB9E;
      --green-bg: rgba(76, 195, 138, 0.16);
      --shadow: 0 1px 2px rgba(0, 0, 0, 0.35), 0 8px 24px rgba(0, 0, 0, 0.4);
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: var(--ground);
    color: var(--body);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 15px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  h1, h2, h3 {
    font-family: ui-serif, Georgia, serif;
    color: var(--ink);
    font-weight: 600;
    margin: 0;
  }
  p { margin: 0; }
  a { color: var(--accent); }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  button { font: inherit; }
  input[type="text"],
  input[type="email"],
  input[type="password"] {
    font: inherit;
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: 8px;
    padding: 10px 12px;
    width: 100%;
  }
  input:focus-visible,
  button:focus-visible,
  tr:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border-radius: 8px;
    border: 1px solid var(--rule);
    background: var(--surface);
    color: var(--ink);
    padding: 8px 14px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }
  .btn:hover { border-color: var(--accent); }
  .btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .btn-primary:hover { background: var(--accent-strong); border-color: var(--accent-strong); }
  .btn-ghost { background: transparent; }
  .btn-destructive { color: var(--red); border-color: var(--red); background: transparent; }
  .btn-destructive:hover { background: var(--red-bg); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .num { font-variant-numeric: tabular-nums; }
  .muted { color: var(--muted); }

  /* Login page */
  .login-wrap {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 16px;
  }
  .login-card {
    width: 100%;
    max-width: 380px;
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: 12px;
    padding: 32px 28px;
    box-shadow: var(--shadow);
  }
  .login-card h1 { font-size: 22px; margin-bottom: 6px; }
  .login-sub { color: var(--muted); font-size: 14px; margin: 0 0 24px; }
  .field { margin-bottom: 16px; }
  .field label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
    margin-bottom: 6px;
  }
  .alert {
    border-radius: 8px;
    padding: 12px 14px;
    font-size: 14px;
    margin-bottom: 20px;
  }
  .alert-error { background: var(--red-bg); color: var(--red); border: 1px solid var(--red); }
  .login-card .btn-primary { width: 100%; margin-top: 4px; padding: 10px 14px; font-size: 15px; }

  /* Console shell */
  .app-shell { max-width: 1120px; margin: 0 auto; padding: 20px 16px 64px; }
  .topbar {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    padding: 8px 0 24px;
    border-bottom: 1px solid var(--rule);
    margin-bottom: 24px;
  }
  .topbar h1 { font-size: 20px; }
  .topbar-right { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .admin-email { color: var(--muted); font-size: 13px; }
  .status {
    border-radius: 8px;
    padding: 12px 14px;
    font-size: 14px;
    margin-bottom: 20px;
  }
  .status-success { background: var(--green-bg); color: var(--green); border: 1px solid var(--green); }
  .status-error { background: var(--red-bg); color: var(--red); border: 1px solid var(--red); }

  .health-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 28px;
    margin-bottom: 32px;
    padding: 20px;
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: 12px;
  }
  .health-figure { min-width: 96px; }
  .health-figure .value {
    font-size: 26px;
    font-weight: 600;
    color: var(--ink);
  }
  .health-figure .value.amber { color: var(--amber); }
  .health-figure .value.red { color: var(--red); }
  .health-figure .label {
    display: block;
    font-size: 12px;
    color: var(--muted);
    margin-top: 2px;
  }

  .filter-row { margin-bottom: 16px; max-width: 360px; }

  .empty-state {
    padding: 40px 20px;
    text-align: center;
    color: var(--muted);
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: 12px;
  }

  .table-scroll {
    overflow-x: auto;
    border: 1px solid var(--rule);
    border-radius: 12px;
    background: var(--surface);
  }
  table.users-table { width: 100%; border-collapse: collapse; min-width: 760px; }
  .users-table th,
  .users-table td {
    text-align: left;
    padding: 12px 14px;
    border-bottom: 1px solid var(--rule);
    font-size: 14px;
    vertical-align: top;
  }
  .users-table th {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    font-weight: 600;
    white-space: nowrap;
  }
  .users-table tbody tr.user-row { cursor: pointer; }
  .users-table tbody tr.user-row:hover { background: var(--ground); }
  .users-table td.col-joined { white-space: nowrap; }
  .cell-name { color: var(--ink); font-weight: 600; }
  .cell-sub { color: var(--muted); font-size: 12.5px; margin-top: 2px; }
  .cell-org { color: var(--muted); font-size: 12.5px; }
  .tag-succeeded { color: var(--green); }
  .tag-failed { color: var(--red); }
  .tag-running { color: var(--amber); }
  .tag-never { color: var(--muted); }
  .row-actions { display: flex; gap: 8px; flex-wrap: wrap; }

  .detail-row td { background: var(--ground); padding: 18px; }
  .detail-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 24px;
  }
  .detail-block h3 {
    font-size: 13px;
    margin-bottom: 10px;
  }
  .mini-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .mini-table th,
  .mini-table td {
    text-align: left;
    padding: 5px 6px;
    border-bottom: 1px solid var(--rule);
  }
  .mini-table th { color: var(--muted); font-weight: 600; }
  dl.kv { margin: 0; font-size: 13px; }
  dl.kv dt { color: var(--ink); margin-top: 8px; }
  dl.kv dt:first-child { margin-top: 0; }
  dl.kv dd { margin: 2px 0 0; color: var(--muted); }

  /* Confirmation dialog */
  dialog.confirm-dialog {
    border: none;
    border-radius: 12px;
    padding: 0;
    width: min(420px, 92vw);
    background: var(--surface);
    color: var(--body);
    box-shadow: var(--shadow);
  }
  dialog.confirm-dialog::backdrop { background: rgba(20, 18, 36, 0.5); }
  .dialog-inner { padding: 24px; }
  .dialog-inner h2 { font-size: 18px; margin-bottom: 12px; }
  .dialog-message { font-size: 14px; line-height: 1.5; margin-bottom: 18px; color: var(--body); }
  .dialog-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }

  /*
    Below the table's own min-width there is no honest way to show seven
    columns, and scrolling sideways hides the two that matter most -- the sync
    status and the buttons -- behind an edge nothing signals. Each row becomes
    a stacked card instead, every cell labelled by the heading it lost.
  */
  @media (max-width: 760px) {
    .table-scroll { overflow-x: visible; border: none; background: transparent; }
    table.users-table { min-width: 0; }
    .users-table thead { display: none; }
    .users-table,
    .users-table tbody,
    .users-table tr,
    .users-table td { display: block; }

    .users-table tbody tr.user-row {
      background: var(--surface);
      border: 1px solid var(--rule);
      border-radius: 12px;
      padding: 4px 0;
      margin-bottom: 10px;
    }
    /*
      A grid rather than a flex row. A cell can hold several lines -- a status,
      a relative time and an error message -- and as flex items those sat side
      by side and squeezed each other into slivers. In the grid the label takes
      column one and every value stacks down column two.
    */
    .users-table td {
      border-bottom: none;
      padding: 7px 14px;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 2px 14px;
      align-items: baseline;
      /* Set on the cell, not only its children: a cell whose value is bare
         text rather than an element still has to sit against the right edge
         with the rest of the column. */
      text-align: right;
    }
    /* The label the column heading used to supply. */
    .users-table td::before {
      content: attr(data-label);
      grid-column: 1;
      grid-row: 1;
      font-size: 11.5px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
      font-weight: 600;
    }
    .users-table td > * { grid-column: 2; text-align: right; }
    /* The person is the card's heading, so it keeps no label and stays left. */
    .users-table td.col-person { display: block; padding-top: 12px; text-align: left; }
    .users-table td.col-actions { display: block; }
    .users-table td.col-person::before { content: none; }
    .users-table td.col-person > * { text-align: left; }
    .users-table td.col-actions { padding-bottom: 12px; }
    .users-table td.col-actions::before { content: none; }
    .users-table td.col-actions .row-actions { width: 100%; }
    .users-table td.col-actions .btn { flex: 1 1 auto; }

    .detail-row { padding: 0; }
    .detail-row td { border-radius: 0 0 12px 12px; }
    .detail-row td::before { content: none; }
    .detail-grid { gap: 18px; }
  }

  @media (max-width: 480px) {
    .app-shell { padding: 16px 12px 48px; }
    .health-strip { gap: 18px; padding: 16px; }
    .topbar { flex-direction: column; align-items: flex-start; }
    .login-card { padding: 28px 20px; }
  }
`;

export function loginPage(opts: { error?: string }): string {
  const errorHtml = opts.error
    ? `<div class="alert alert-error" role="alert">${escapeHtml(opts.error)}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex, nofollow">
<title>Verloq Admin</title>
<style>${baseStyles}</style>
</head>
<body>
<div class="login-wrap">
  <div class="login-card">
    <h1>Verloq Admin</h1>
    <p class="login-sub">Sign in to view users and account health.</p>
    ${errorHtml}
    <form method="post" action="/admin/login">
      <div class="field">
        <label for="login-email">Email</label>
        <input type="email" id="login-email" name="email" required autocomplete="username">
      </div>
      <div class="field">
        <label for="login-password">Password</label>
        <input type="password" id="login-password" name="password" required autocomplete="current-password">
      </div>
      <button type="submit" class="btn btn-primary">Sign in</button>
    </form>
  </div>
</div>
</body>
</html>`;
}

export function consolePage(opts: { csrfToken: string; adminEmail: string }): string {
  const csrfToken = escapeHtml(opts.csrfToken);
  const adminEmail = escapeHtml(opts.adminEmail);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex, nofollow">
<title>Verloq Admin</title>
<style>${baseStyles}</style>
</head>
<body>
<div id="app" data-csrf="${csrfToken}">
  <div class="app-shell">
    <header class="topbar">
      <h1>Verloq Admin</h1>
      <div class="topbar-right">
        <span class="admin-email">${adminEmail}</span>
        <form method="post" action="/admin/logout">
          <button type="submit" class="btn btn-ghost">Sign out</button>
        </form>
      </div>
    </header>

    <div id="status" class="status" role="status" hidden></div>

    <section id="health" class="health-strip" aria-label="Health overview">Loading&hellip;</section>

    <section class="users-section">
      <div class="filter-row">
        <label for="filter-input" class="visually-hidden">Filter users by name, email or organisation</label>
        <input type="text" id="filter-input" placeholder="Filter by name, email or organisation">
      </div>
      <div id="users-container">Loading&hellip;</div>
    </section>
  </div>

  <dialog id="confirm-dialog" class="confirm-dialog">
    <div class="dialog-inner">
      <h2 id="dialog-title">Confirm</h2>
      <p id="dialog-message" class="dialog-message"></p>
      <div class="field">
        <label for="dialog-email-input">Type the user's email address to confirm</label>
        <input type="text" id="dialog-email-input" autocomplete="off" spellcheck="false">
      </div>
      <div class="dialog-actions">
        <button type="button" id="dialog-cancel-btn" class="btn btn-ghost">Cancel</button>
        <button type="button" id="dialog-confirm-btn" class="btn btn-destructive" disabled>Confirm</button>
      </div>
    </div>
  </dialog>
</div>

<script>
(function () {
  "use strict";

  var appEl = document.getElementById("app");
  var csrfToken = appEl.getAttribute("data-csrf") || "";
  var healthEl = document.getElementById("health");
  var usersContainer = document.getElementById("users-container");
  var filterInput = document.getElementById("filter-input");
  var statusEl = document.getElementById("status");
  var dialog = document.getElementById("confirm-dialog");
  var dialogTitle = document.getElementById("dialog-title");
  var dialogMessage = document.getElementById("dialog-message");
  var dialogEmailInput = document.getElementById("dialog-email-input");
  var dialogConfirmBtn = document.getElementById("dialog-confirm-btn");
  var dialogCancelBtn = document.getElementById("dialog-cancel-btn");

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  var state = {
    overview: null,
    filter: "",
    detailCache: {},
    pendingAction: null
  };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

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
    var diff = Date.now() - then;
    if (diff < 0) diff = 0;
    var sec = Math.floor(diff / 1000);
    if (sec < 45) return "just now";
    var min = Math.floor(sec / 60);
    if (min < 60) return min + (min === 1 ? " minute ago" : " minutes ago");
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + (hr === 1 ? " hour ago" : " hours ago");
    var day = Math.floor(hr / 24);
    if (day < 30) return day + (day === 1 ? " day ago" : " days ago");
    var mon = Math.floor(day / 30);
    if (mon < 12) return mon + (mon === 1 ? " month ago" : " months ago");
    var yr = Math.floor(day / 365);
    return yr + (yr === 1 ? " year ago" : " years ago");
  }

  function truncate(text, max) {
    if (!text) return "";
    if (text.length <= max) return text;
    return text.slice(0, max - 1) + "…";
  }

  function handleResponse(res) {
    if (res.status === 401) {
      location.reload();
      return Promise.reject(new Error("Not signed in"));
    }
    return res
      .json()
      .catch(function () {
        return {};
      })
      .then(function (body) {
        if (!res.ok) {
          var msg = body && body.message ? body.message : "Something went wrong.";
          throw new Error(msg);
        }
        return body;
      });
  }

  function apiGet(url) {
    return fetch(url, { credentials: "same-origin" }).then(handleResponse);
  }

  function apiPost(url) {
    return fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "x-admin-csrf": csrfToken }
    }).then(handleResponse);
  }

  function showStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.hidden = false;
    statusEl.className = "status " + (isError ? "status-error" : "status-success");
  }

  function clearStatus() {
    statusEl.hidden = true;
    statusEl.textContent = "";
    statusEl.className = "status";
  }

  var HEALTH_FIELDS = [
    { key: "users", label: "Signed up" },
    { key: "verified", label: "Verified" },
    { key: "withMailbox", label: "Mailbox connected" },
    { key: "syncedLast7Days", label: "Synced this week" },
    { key: "quietOver7Days", label: "Quiet over a week" },
    { key: "mailboxesInError", label: "Mailboxes erroring" },
    { key: "activeSubscriptions", label: "Active subscriptions" },
    { key: "invoices", label: "Invoices" }
  ];

  function renderHealth() {
    clearNode(healthEl);
    if (!state.overview) return;
    var health = state.overview.health;
    HEALTH_FIELDS.forEach(function (field) {
      var value = health[field.key];
      var figure = el("div", "health-figure");
      var valueEl = el("div", "value num", String(value == null ? 0 : value));
      if (field.key === "quietOver7Days" && health.quietOver7Days > 0) {
        valueEl.className += " amber";
      }
      if (field.key === "mailboxesInError" && health.mailboxesInError > 0) {
        valueEl.className += " red";
      }
      figure.appendChild(valueEl);
      figure.appendChild(el("div", "label", field.label));
      healthEl.appendChild(figure);
    });
  }

  function matchesFilter(user, filter) {
    if (!filter) return true;
    var f = filter.toLowerCase();
    var name = ((user.first_name || "") + " " + (user.last_name || "")).toLowerCase();
    var email = (user.email || "").toLowerCase();
    var org = (user.organization_name || "").toLowerCase();
    return name.indexOf(f) !== -1 || email.indexOf(f) !== -1 || org.indexOf(f) !== -1;
  }

  function personName(user) {
    var name = ((user.first_name || "") + " " + (user.last_name || "")).trim();
    return name || "—";
  }

  function syncStatusInfo(user) {
    var status = user.last_sync_status;
    if (status === "succeeded") {
      return { text: "Succeeded", cls: "tag-succeeded", time: user.last_sync_finished };
    }
    if (status === "failed") {
      return { text: "Failed", cls: "tag-failed", time: user.last_sync_finished || user.last_sync_started };
    }
    if (status === "running") {
      return { text: "Running", cls: "tag-running", time: user.last_sync_started };
    }
    return { text: "Never", cls: "tag-never", time: null };
  }

  function buildUserRow(user) {
    var tr = el("tr", "user-row");
    tr.setAttribute("data-user-id", String(user.id));
    tr.tabIndex = 0;

    var tdPerson = document.createElement("td");
    tdPerson.appendChild(el("div", "cell-name", personName(user)));
    tdPerson.appendChild(el("div", "cell-sub", user.email));
    if (user.organization_name) {
      tdPerson.appendChild(el("div", "cell-org", "Org · " + user.organization_name));
    }
    tr.appendChild(tdPerson);

    tr.appendChild(el("td", "num", fmtDate(user.created_at)));

    var tdMailboxes = document.createElement("td");
    var mailboxCount = (user.gmail_accounts || 0) + (user.outlook_accounts || 0);
    if (mailboxCount === 0) {
      tdMailboxes.appendChild(el("span", "muted", "None"));
    } else {
      var mbLine = el("div", "num");
      mbLine.appendChild(document.createTextNode(String(mailboxCount)));
      if (user.mailboxes_in_error > 0) {
        var errSpan = el("span", "tag-failed", " (" + user.mailboxes_in_error + " erroring)");
        mbLine.appendChild(errSpan);
      }
      tdMailboxes.appendChild(mbLine);
    }
    tr.appendChild(tdMailboxes);

    var tdSubs = document.createElement("td");
    tdSubs.appendChild(el("div", "num", String(user.subscriptions || 0)));
    if (user.pending_suggestions > 0) {
      tdSubs.appendChild(el("div", "cell-sub", user.pending_suggestions + " awaiting review"));
    }
    tr.appendChild(tdSubs);

    var tdInvoices = document.createElement("td");
    tdInvoices.appendChild(el("div", "num", String(user.invoices || 0)));
    if (user.invoices > user.invoices_with_file) {
      var noFile = user.invoices - user.invoices_with_file;
      tdInvoices.appendChild(el("div", "cell-sub", noFile + " with no file"));
    }
    tr.appendChild(tdInvoices);

    var tdSync = document.createElement("td");
    var syncInfo = syncStatusInfo(user);
    tdSync.appendChild(el("div", syncInfo.cls, syncInfo.text));
    if (syncInfo.time) {
      tdSync.appendChild(el("div", "cell-sub", fmtRelative(syncInfo.time)));
    }
    if (user.last_sync_status === "failed" && user.last_sync_error) {
      var errLine = el("div", "cell-sub tag-failed", truncate(user.last_sync_error, 80));
      errLine.title = user.last_sync_error;
      tdSync.appendChild(errLine);
    }
    tr.appendChild(tdSync);

    var tdActions = document.createElement("td");
    var actionsWrap = el("div", "row-actions");
    var clearBtn = el("button", "btn", "Clear data");
    clearBtn.type = "button";
    clearBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      openConfirmDialog(user, "clear");
    });
    var deleteBtn = el("button", "btn btn-destructive", "Delete user");
    deleteBtn.type = "button";
    deleteBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      openConfirmDialog(user, "delete");
    });
    actionsWrap.appendChild(clearBtn);
    actionsWrap.appendChild(deleteBtn);
    tdActions.appendChild(actionsWrap);
    tr.appendChild(tdActions);

    // The stacked card layout at narrow widths has no table head to read
    // from, so each cell carries its own heading and column name.
    var columns = ["Person", "Joined", "Mailboxes", "Subscriptions", "Invoices", "Last sync", "Actions"];
    var slugs = ["person", "joined", "mailboxes", "subscriptions", "invoices", "sync", "actions"];
    for (var i = 0; i < tr.children.length && i < columns.length; i++) {
      tr.children[i].setAttribute("data-label", columns[i]);
      tr.children[i].className = ((tr.children[i].className || "") + " col-" + slugs[i]).trim();
    }

    tr.addEventListener("click", function () {
      toggleDetail(user.id);
    });
    tr.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleDetail(user.id);
      }
    });

    return tr;
  }

  function toggleDetail(userId) {
    var existing = document.querySelector('tr.detail-row[data-for="' + userId + '"]');
    if (existing) {
      existing.parentNode.removeChild(existing);
      return;
    }
    var openDetail = document.querySelector("tr.detail-row");
    if (openDetail) openDetail.parentNode.removeChild(openDetail);

    var rowEl = document.querySelector('tr.user-row[data-user-id="' + userId + '"]');
    if (!rowEl) return;

    var detailRow = el("tr", "detail-row");
    detailRow.setAttribute("data-for", String(userId));
    var td = document.createElement("td");
    td.colSpan = 7;
    td.appendChild(el("div", "muted", "Loading…"));
    detailRow.appendChild(td);
    rowEl.parentNode.insertBefore(detailRow, rowEl.nextSibling);

    loadDetail(userId)
      .then(function (detail) {
        clearNode(td);
        td.appendChild(buildDetailContent(detail));
      })
      .catch(function (err) {
        clearNode(td);
        td.appendChild(el("div", "tag-failed", err.message || "Could not load details."));
      });
  }

  function loadDetail(userId) {
    if (state.detailCache[userId]) {
      return Promise.resolve(state.detailCache[userId]);
    }
    return apiGet("/admin/api/users/" + userId).then(function (data) {
      state.detailCache[userId] = data;
      return data;
    });
  }

  function buildMiniTable(headers, rows, rowBuilder) {
    var table = document.createElement("table");
    table.className = "mini-table";
    var headRow = document.createElement("tr");
    headers.forEach(function (h) {
      headRow.appendChild(el("th", "", h));
    });
    table.appendChild(headRow);
    rows.forEach(function (item) {
      table.appendChild(rowBuilder(item));
    });
    return table;
  }

  function buildDetailContent(detail) {
    var wrap = el("div", "detail-grid");

    var mbBlock = el("div", "detail-block");
    mbBlock.appendChild(el("h3", "", "Mailboxes"));
    var mailboxes = detail.mailboxes || [];
    if (mailboxes.length === 0) {
      mbBlock.appendChild(el("div", "muted", "No mailboxes connected."));
    } else {
      mbBlock.appendChild(
        buildMiniTable(["Provider", "Address", "Last sync", "Status"], mailboxes, function (mb) {
          var row = document.createElement("tr");
          row.appendChild(el("td", "", mb.provider));
          row.appendChild(el("td", "", mb.address || "—"));
          row.appendChild(el("td", "num", mb.last_sync ? fmtRelative(mb.last_sync) : "Never"));
          var statusTd = el("td", "", mb.sync_status || "—");
          if (mb.sync_error) statusTd.title = mb.sync_error;
          row.appendChild(statusTd);
          return row;
        })
      );
    }
    wrap.appendChild(mbBlock);

    var subBlock = el("div", "detail-block");
    subBlock.appendChild(el("h3", "", "Subscriptions"));
    var subs = detail.subscriptions_detail || [];
    if (subs.length === 0) {
      subBlock.appendChild(el("div", "muted", "No subscriptions."));
    } else {
      subBlock.appendChild(
        buildMiniTable(["Service", "Amount", "Frequency", "Status", "Next billing"], subs, function (s) {
          var row = document.createElement("tr");
          row.appendChild(el("td", "", s.service_name || "—"));
          var amountText =
            s.amount !== null && s.amount !== undefined
              ? (s.currency ? s.currency + " " : "") + s.amount
              : "—";
          row.appendChild(el("td", "num", amountText));
          row.appendChild(el("td", "", s.frequency || "—"));
          row.appendChild(el("td", "", s.status || "—"));
          row.appendChild(el("td", "num", s.next_billing_date ? fmtDate(s.next_billing_date) : "—"));
          return row;
        })
      );
    }
    wrap.appendChild(subBlock);

    var syncBlock = el("div", "detail-block");
    syncBlock.appendChild(el("h3", "", "Recent syncs"));
    var syncs = detail.recent_syncs || [];
    if (syncs.length === 0) {
      syncBlock.appendChild(el("div", "muted", "No sync history."));
    } else {
      var dl = document.createElement("dl");
      dl.className = "kv";
      syncs.forEach(function (s) {
        var statusLabel =
          s.status === "succeeded" ? "Succeeded" : s.status === "failed" ? "Failed" : s.status === "running" ? "Running" : s.status || "Unknown";
        var dtText = statusLabel + (s.started_at ? " · " + fmtRelative(s.started_at) : "") + (s.trigger_source ? " · " + s.trigger_source : "");
        dl.appendChild(el("dt", "", dtText));
        var ddText = (s.emails_processed || 0) + " emails, " + (s.suggestions_generated || 0) + " suggestions";
        if (s.status === "failed" && s.error) {
          ddText += " — " + truncate(s.error, 80);
        }
        dl.appendChild(el("dd", "", ddText));
      });
      syncBlock.appendChild(dl);
    }
    wrap.appendChild(syncBlock);

    return wrap;
  }

  function renderUsers() {
    clearNode(usersContainer);
    if (!state.overview) return;
    var users = state.overview.users || [];
    if (users.length === 0) {
      usersContainer.appendChild(el("div", "empty-state", "No one has signed up yet."));
      return;
    }
    var filtered = users.filter(function (u) {
      return matchesFilter(u, state.filter);
    });
    if (filtered.length === 0) {
      usersContainer.appendChild(el("div", "empty-state", "No users match your filter."));
      return;
    }
    var scrollWrap = el("div", "table-scroll");
    var table = document.createElement("table");
    table.className = "users-table";
    var thead = document.createElement("thead");
    var headRow = document.createElement("tr");
    ["Person", "Joined", "Mailboxes", "Subscriptions", "Invoices", "Last sync", "Actions"].forEach(function (h) {
      headRow.appendChild(el("th", "", h));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = document.createElement("tbody");
    filtered.forEach(function (user) {
      tbody.appendChild(buildUserRow(user));
    });
    table.appendChild(tbody);
    scrollWrap.appendChild(table);
    usersContainer.appendChild(scrollWrap);
  }

  function render() {
    renderHealth();
    renderUsers();
  }

  function loadOverview() {
    return apiGet("/admin/api/overview")
      .then(function (data) {
        state.overview = data;
        render();
      })
      .catch(function (err) {
        showStatus(err.message || "Could not load data.", true);
      });
  }

  function openConfirmDialog(user, action) {
    state.pendingAction = { user: user, action: action };
    dialogEmailInput.value = "";
    dialogConfirmBtn.disabled = true;
    if (action === "clear") {
      dialogTitle.textContent = "Clear data";
      dialogMessage.textContent =
        "This removes everything Verloq found for " +
        user.email +
        ": their subscriptions, invoices and stored files, and their mailbox connection. Their account stays and they can sign in and reconnect. This cannot be undone.";
      dialogConfirmBtn.textContent = "Clear data";
    } else {
      dialogTitle.textContent = "Delete user";
      dialogMessage.textContent =
        "This deletes " +
        user.email +
        " completely: their account, their subscriptions, invoices, stored files and mailbox connections. They will not be able to sign in again. This cannot be undone.";
      dialogConfirmBtn.textContent = "Delete user";
    }
    dialogConfirmBtn.className = "btn btn-destructive";
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "open");
    }
    dialogEmailInput.focus();
  }

  function closeDialog() {
    if (typeof dialog.close === "function") {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
    }
    state.pendingAction = null;
  }

  dialogEmailInput.addEventListener("input", function () {
    if (!state.pendingAction) return;
    var expected = String(state.pendingAction.user.email || "").trim().toLowerCase();
    var typed = dialogEmailInput.value.trim().toLowerCase();
    dialogConfirmBtn.disabled = typed.length === 0 || typed !== expected;
  });

  dialogCancelBtn.addEventListener("click", function () {
    closeDialog();
  });

  dialog.addEventListener("cancel", function () {
    state.pendingAction = null;
  });

  dialogConfirmBtn.addEventListener("click", function () {
    if (!state.pendingAction) return;
    var user = state.pendingAction.user;
    var action = state.pendingAction.action;
    var url = "/admin/api/users/" + user.id + (action === "clear" ? "/clear-data" : "/delete");
    dialogConfirmBtn.disabled = true;
    apiPost(url)
      .then(function (body) {
        closeDialog();
        showStatus(body.message || "Done.", false);
        delete state.detailCache[user.id];
        return loadOverview();
      })
      .catch(function (err) {
        dialogConfirmBtn.disabled = false;
        showStatus(err.message || "Something went wrong.", true);
      });
  });

  filterInput.addEventListener("input", function () {
    state.filter = filterInput.value;
    renderUsers();
  });

  clearStatus();
  loadOverview();
})();
</script>
</body>
</html>`;
}
