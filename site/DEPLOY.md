# Deploying verloq.co

Everything in this folder is plain HTML and CSS. There is no build step, no npm,
no framework. Netlify publishes it straight from the repo; the manual upload
route is kept below as a fallback.

**Do not touch `app.verloq.co`.** That subdomain CNAMEs to Railway and serves the
application. Nothing in this guide should change it.

---

## Part 1 — What you need to supply

### 1a. Text and data

**Done.** Contact email, entity name, year, hosting regions, retention and
response windows and the minimum age are all filled in. The registered address
and city/country were dropped at your instruction, and the sentences that held
them were rewritten rather than left with holes.

Two markers remain on purpose:

| Marker | Where | What to do |
|---|---|---|
| `[SET ON UPLOAD]` | `privacy.html` line 42, twice | Replace both with the date you actually publish, e.g. `13 September 2026`. They are deliberately not pre-filled so the policy is never in force before it existed |

Two things worth revisiting, neither blocking:

- The contact address is a **personal Gmail**. On a page asking finance teams to
  grant mailbox access, `privacy@verloq.co` reads very differently — and you own
  the domain and already run Resend on it.
- There is **no registered address** in the policy. A privacy policy is expected
  to identify the data controller contactably, and Google's reviewer checks the
  policy is complete. Removed as asked; may come back at verification.

### 1b. The waitlist endpoint

The form does not submit anywhere yet. Until it does, it tells visitors to email
you instead of failing silently.

1. Create a form at [formspree.io](https://formspree.io) (or Tally)
2. Copy the endpoint — it looks like `https://formspree.io/f/abcdwxyz`
3. Paste it into `FORM_ENDPOINT` near the bottom of `index.html`
4. If it is **not** Formspree, also add the host to `connect-src` and
   `form-action` in `netlify.toml` (and in `site/.htaccess` if you also use
   the GoDaddy route), or the browser will block the request silently

### 1c. Images

Only one is genuinely missing.

| File | Size | Status |
|---|---|---|
| `assets/og-cover.png` | 1200 × 630 | **Missing.** Referenced by the social-preview meta on both pages. Without it, links shared to Slack, WhatsApp or LinkedIn show a broken image |
| `assets/favicon.svg` | 32 × 32 | Done |
| `assets/logo.svg` | 28 × 28 | Done |
| `assets/icons/` (7 files) | 400 × 400 | Done — the brand marks in the sample ledger |

Nothing else. Apart from the seven service icons the site uses no photographs —
every other graphic is SVG or a CSS gradient. If you would rather I generate the
OG cover in the site's own visual language, say so and I will.

### 1d. Product screenshots

**Not needed right now.** The page was deliberately built without them, because
the app UI is due for a redesign and screenshots of the old one would date the
page immediately.

They become worth adding once the new UI exists. The natural slots are the
invoice-archive section (currently a hand-built card) and a possible new section
between "how it works" and the FAQ.

### 1e. Legal

The privacy policy is drafted from what the code actually does, not from law.
Have a lawyer read it before it goes live — particularly section 5, which names
sub-processors, and section 8, if you serve EU or UK customers.

### 1f. Suggested folder to share back

```
verloq-assets/
  og-cover.png            1200x630
  details.txt             the placeholder values, one per line
  formspree-endpoint.txt  the URL
```

Or just paste the values into chat — whichever is easier.

---

## Part 2 — Netlify (recommended)

`git push` and the site is live in about thirty seconds. Every branch gets a
preview URL, and a bad deploy rolls back in one click.

**Your domain does not move.** verloq.co stays registered at GoDaddy and GoDaddy
keeps serving DNS. Two records in that zone get pointed at Netlify. The `app`
record — Railway — and your Resend mail records are never touched.

`netlify.toml` at the repository root already carries the security headers, the
CSP and the cache policy, translated from `.htaccess`. Netlify handles HTTPS,
the www redirect, extensionless URLs, `404.html` and compression natively, so
there is nothing else to configure.

### Step 1 — Connect the repository

1. Sign in at [netlify.com](https://netlify.com) with GitHub
2. **Add new site → Import an existing project →** `rishikesh88/Subtracker`
3. **Build command: leave empty. Publish directory: `site`.** Netlify reads the
   rest from `netlify.toml`
4. Set the production branch to the branch holding the site — `main-tikaex`
   today, or merge it into `main` first and deploy from there, which is tidier
5. Deploy

You get a `something.netlify.app` URL. **Check the whole site on that URL before
you touch DNS** — it is the same files, so anything wrong is wrong now.

### Step 2 — Claim the domain

**Domain management → Add a custom domain →** `verloq.co`. Set the apex as the
**primary domain** so `www` redirects to it. Netlify will show you the exact DNS
records to create; use what the dashboard says rather than any value copied from
a guide, since these change.

### Step 3 — Point two records at it, in GoDaddy

**Domains → verloq.co → DNS**:

| Type | Name | Value |
|---|---|---|
| A | `@` | Netlify's load-balancer IP, exactly as its dashboard gives it |
| CNAME | `www` | your `something.netlify.app` hostname |
| CNAME | `app` | **do not touch — this is Railway** |

Then two things people miss:

- **Delete the old A record** pointing at GoDaddy hosting, or you will get
  whichever answers first.
- **Check Domains → verloq.co → Forwarding is empty.** A leftover domain forward
  silently overrides DNS, and is the usual reason "I changed the record and
  nothing happened".

Netlify issues the certificate automatically once DNS resolves — usually
minutes, occasionally an hour.

### Step 4 — Check the headers landed

The rest of the checklist is Part 2b Step 5, which applies either way. This part
is specific to the move:

```
curl -sI https://verloq.co | grep -iE 'content-security-policy|x-frame|cache-control'
curl -sI https://verloq.co/assets/styles.css | grep -i cache-control
```

Expect the CSP and `no-cache` on the page, and
`public, max-age=31536000, immutable` on the stylesheet. If the CSP is missing,
`netlify.toml` is not being read — check it sits at the **repository root**, not
inside `site/`.

### Updating the site afterwards

Push to the production branch. That is the whole procedure. Pushes that do not
touch `site/` are skipped automatically, so ordinary app work does not trigger
deploys.

---

## Part 2b — GoDaddy cPanel (fallback)

Only needed if you would rather not use Netlify, or want a second copy live.
Everything here is manual: no preview, no rollback, and you repeat it in full
for every change.

### Step 0 — Work out which product you have

GoDaddy sells two things that both get called "hosting", and only one of them
can host these files.

- **Web Hosting / cPanel** (Linux, Economy/Deluxe/Ultimate) — has a File
  Manager and supports `.htaccess`. **This is what you need.**
- **Website Builder** — a drag-and-drop editor with no file upload. It
  **cannot** host these files. If this is what you have, you need to either add
  a Web Hosting plan or use a free static host instead.

Check at **GoDaddy → My Products**. If you see "cPanel Admin", you are fine.

### Step 1 — Get the files

From the repository, download the `site/` folder — on GitHub, use **Code →
Download ZIP** and take the `site/` directory out of it. Make sure you have the
hidden `.htaccess` file; some unzip tools hide it.

Fill in the placeholders and drop in `og-cover.png` before uploading.

### Step 2 — Upload

1. **My Products → Web Hosting → Manage → cPanel Admin**
2. Open **File Manager**
3. Go into **`public_html`**
4. Delete GoDaddy's default `index.html` or "coming soon" page if one is there
5. Upload **the contents of `site/`**, not the folder itself. `index.html` must
   sit directly in `public_html`, not in `public_html/site/`

The structure should end up as:

```
public_html/
  index.html
  privacy.html
  404.html
  robots.txt
  sitemap.xml
  .htaccess
  assets/
    styles.css
    logo.svg
    favicon.svg
    og-cover.png
    fonts/
      literata-latin.woff2
      manrope-latin.woff2
    icons/
      slack.png   figma.png   notion.jpeg   claude.png
      canva.png   adobe.jpeg  google.png
```

`DEPLOY.md` and `assets/icons/README.md` are notes for you, not part of the
site. Uploading them is harmless — nothing links to them — but you may as well
leave them out.

The whole upload is about 440 KB.

**Show hidden files** in File Manager (Settings, top right) or you will not see
whether `.htaccess` uploaded. If it did not, create it manually and paste the
contents in.

### Step 3 — Point the domain

If verloq.co is registered *and* hosted at GoDaddy, this is usually already
done. Confirm at **Domains → verloq.co → DNS**:

| Type | Name | Value |
|---|---|---|
| A | `@` | your hosting account's IP (cPanel shows it as "Shared IP Address") |
| CNAME | `www` | `verloq.co` |
| CNAME | `app` | **leave exactly as it is** — this is Railway |

Give it up to an hour, though it is usually minutes.

### Step 4 — Turn on SSL

1. **Web Hosting → Manage → Security**, or cPanel → **SSL/TLS Status**
2. Your plan includes a free certificate; issue it for both `verloq.co` and
   `www.verloq.co`
3. Wait for it to say Active

`.htaccess` already forces HTTPS and redirects `www` to the bare domain, so once
the certificate is live there is nothing more to configure.

### Step 5 — Check it

In this order:

- `https://verloq.co` loads with a padlock
- `http://verloq.co` redirects to HTTPS
- `https://www.verloq.co` redirects to the bare domain
- `https://verloq.co/privacy.html` loads
- `https://verloq.co/privacy` also loads, without the extension
- `https://verloq.co/nonsense` shows the styled 404, not GoDaddy's
- **All seven icons appear in the ledger** — if you see coloured letter tiles
  instead, `assets/icons/` did not upload
- The headings render in a serif face — if everything is sans-serif, the fonts
  in `assets/fonts/` did not upload
- Submit the form with a real address, and confirm it arrives in Formspree
- Open it on a phone
- **`https://app.verloq.co` still works**

---

## Part 3 — After it is live

1. Verify the domain in [Google Search Console](https://search.google.com/search-console)
2. Add it as an authorised domain on the OAuth consent screen
3. Complete the consent screen: app name, logo, support email, scope
   justification, and links to the homepage and privacy policy
4. Record the demo video Google requires for restricted scopes
5. Submit for verification

**Before you submit**, fix the in-app privacy modal at
`client/src/pages/onboarding/Connect.tsx` — it still tells users "we never read
your email content", which the sync contradicts on every run and which now
contradicts this privacy policy too. A reviewer reads both.

---

## Updating the site later

**On Netlify:** push to the production branch. Nothing else.

**On GoDaddy:** edit the file and re-upload it. There is no build and no cache
to clear — `.htaccess` tells browsers not to cache the HTML, so changes appear
immediately.

Either way, **assets under `assets/` are cached for a year and their filenames
carry no fingerprint.** If you change the stylesheet, a font or an icon, rename
the file and update the reference, or returning visitors keep the old one.
