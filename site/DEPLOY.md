# Deploying verloq.co

Everything in this folder is plain HTML and CSS. There is no build step, no npm,
no framework — you upload the files as they are.

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
   `form-action` in `.htaccess`, or the browser will block the request

### 1c. Images

Only one is genuinely missing.

| File | Size | Status |
|---|---|---|
| `assets/og-cover.png` | 1200 × 630 | **Missing.** Referenced by the social-preview meta on both pages. Without it, links shared to Slack, WhatsApp or LinkedIn show a broken image |
| `assets/favicon.svg` | 32 × 32 | Done |
| `assets/logo.svg` | 28 × 28 | Done |

Nothing else. The site uses no photographs — every graphic is SVG or a CSS
gradient. If you would rather I generate the OG cover in the site's own visual
language, say so and I will.

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

## Part 2 — GoDaddy, step by step

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
```

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
- `https://verloq.co/privacy` also loads (this proves `.htaccess` is working)
- `https://verloq.co/nonsense` shows the styled 404, not GoDaddy's
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

Edit the file, re-upload it, done. There is no build and no cache to clear —
`.htaccess` tells browsers not to cache the HTML, so changes appear immediately.
Assets under `assets/` are cached for a year, so if you change the CSS or a font,
rename the file and update the reference, or the change will not reach people who
have already visited.
