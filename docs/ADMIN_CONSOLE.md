# Admin console

A private page at `https://app.verloq.co/admin` for answering two questions
during the beta: **who has signed up**, and **is the app actually working for
them**.

It is not linked from anywhere in the app, it is not part of the React bundle,
and it has its own sign-in that shares nothing with the app's. It is read and
delete only — there is no way to edit anyone's data from it.

---

## Turning it on

Two environment variables. Set neither and the page does not exist: `/admin`
behaves exactly like any other unknown address, so a deploy that has not been
configured does not advertise that a console is there.

### 1. Choose a password

In the project folder:

```
npm run admin:password
```

It asks twice, with your typing hidden, and prints a hash. **The password
itself is never shown, saved or sent anywhere** — only you ever know it. If you
would rather not invent one, the script offers a random suggestion.

**The hash is what goes into Railway, not the password.** They look nothing
alike: a hash is exactly 60 characters and starts with `$2b$`. Putting the
password in `ADMIN_PASSWORD_HASH` is the one mistake worth naming, because it
used to produce a sign-in page that refused the correct password forever. The
console now refuses to start on a value that is not a bcrypt hash, and says so
in the server log on a line beginning `[Admin]`.

At least 12 characters. A passphrase of a few unrelated words is easier to
remember and harder to guess than a short mangled word.

### 2. Put two variables in Railway

| Variable | Value |
|---|---|
| `ADMIN_EMAIL` | the address you sign in with |
| `ADMIN_PASSWORD_HASH` | the `$2b$12$…` string the script printed |

The hash is safe to paste and safe in a screenshot. It cannot be turned back
into your password.

Redeploy, then open `https://app.verloq.co/admin`.

**If `/admin` shows the app instead of a sign-in page**, the console did not
start. Open Railway's logs and search for `[Admin]` — one line says exactly
which of the three things is wrong.

### Changing the password later

Run the script again and replace `ADMIN_PASSWORD_HASH`. That **signs the
console out everywhere immediately** — the signing key for the session cookie
is derived from the hash, so every cookie ever issued stops working the moment
it changes. That is also how you lock someone out in a hurry.

---

## What it shows

**Across the top**, the numbers that say whether the app is healthy:

| Figure | Why it is there |
|---|---|
| Signed up / Verified | how many accounts exist, and how many completed email verification |
| Mailbox connected | accounts that got as far as connecting Gmail |
| Synced this week | mailboxes that have actually run in the last seven days |
| **Quiet over a week** | **connected but silent for seven days — usually an expired connection** |
| Mailboxes erroring | connections the last sync failed on |
| Active subscriptions / Invoices | what the app has found in total |

"Quiet over a week" is the one to watch. While the app is in Google's testing
mode, a mailbox connection expires after **seven days** and the only symptom is
that syncing silently stops. Nothing records the expiry, so "connected but
hasn't synced in a week" is the closest honest signal — and it tells you
somebody needs to reconnect before they email to ask why nothing is updating.

**Below that**, one row per person: name, email, when they joined, how many
mailboxes, how many subscriptions, how many invoices, and how their last sync
went. Click a row to see their mailboxes, their subscriptions and their last
ten sync runs.

Under Invoices you may see "N with no file". That is **normal, not a fault**:
most services put the receipt in the email itself and attach nothing, so those
are recorded with the file left blank.

---

## The two destructive actions

Both ask you to type the person's email address before they will run, and
neither can be undone.

**Clear data** — removes everything Verloq found for them: subscriptions,
invoices, the stored invoice files, cached emails and sync history. Their
mailbox connection is removed **and withdrawn at Google**, not merely
forgotten. Their account survives; they can still sign in, and they land on an
empty dashboard where they can reconnect and start again.

**Delete user** — all of the above, plus the account itself, their password,
their verification codes and their sessions. They cannot sign in again.

Both write a line to the server log beginning `ADMIN_ACTION`, recording what
was done, to whom, when, and how much was removed. Search Railway's logs for
that word to see the history. It is not a database table — if the trail needs
to outlive Railway's log retention, that is a small table to add later.

---

## How the sign-in works, and why

- **Its own cookie**, scoped to `/admin`, so it is never sent with an ordinary
  request. Signing into the console does not sign you into Verloq, and signing
  into Verloq does not get you into the console — even from the same address.
  An account takeover on the app side must not become a takeover of every
  user's data.
- **No admin table.** The credentials live in the environment, so there is
  nothing in the database to steal and no "forgot password" path to attack.
- **Five sign-in attempts per fifteen minutes**, per address.
- **A wrong email address costs the same as a wrong password**, so response
  time cannot be used to discover which address is the admin's.
- **Sessions last eight hours**, then you sign in again.
- **`SameSite=Strict` plus a second token** on both delete actions, so a
  request from another site cannot reach them even carrying your cookie.

Covered by tests: `npm run test:admin-auth`.

---

## What it deliberately does not do

- **No editing.** An operator slip should not be able to quietly corrupt
  somebody's account.
- **No mailbox tokens.** Every query behind the console selects counts and
  timestamps by hand rather than whole rows, so there is no read path that
  could leak one.
- **No forcing a sync for someone else.** That runs against their mailbox with
  their credentials and reports progress into their session; doing it from
  here would need enough new machinery to be its own piece of work. Ask them to
  press sync, or clear their data and have them reconnect.
