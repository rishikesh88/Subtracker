# Schema migrations

This project uses `drizzle-kit push`, not a migrations folder. `npm run db:push`
diffs [shared/schema.ts](../shared/schema.ts) against the live database and
applies the difference.

**`db:push` must never enter the Railway build command.** A build that mutates
the production schema turns every deploy into a migration, including rollbacks.

Run it once, from a machine holding the Neon connection string:

```bash
npm run db:push
```

Take a Neon snapshot first and read the SQL drizzle-kit proposes. **If it wants
to drop anything, stop** — that is a sign the local schema is behind, not ahead.

## When you cannot run db:push

Applying the DDL by hand in the Neon SQL editor is equivalent, as long as it
matches what `shared/schema.ts` declares. Each change below is recorded so a
database migrated by hand can be reconciled later.

Every statement is written to be safe to re-run.

---

## 2026-08-22 — `screened_messages` (Phase 4, #16)

Records which provider message IDs a sync has already screened, so a repeat sync
can skip them.

Needed because `emails` holds only the small subset that survives the AI
pre-filter — roughly 120 rows against a 2,500 message window — so it cannot tell
you what has been *looked at*, only what was kept.

```sql
CREATE TABLE IF NOT EXISTS "screened_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"provider" text DEFAULT 'gmail' NOT NULL,
	"message_id" text NOT NULL,
	"screened_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_screened_user_provider_message"
	ON "screened_messages" USING btree ("user_id","provider","message_id");

CREATE INDEX IF NOT EXISTS "idx_screened_user_provider"
	ON "screened_messages" USING btree ("user_id","provider");
```

The unique index is scoped per user, unlike `emails.gmail_id`, which is globally
unique. Two mailboxes may legitimately carry the same provider message ID.

**Deploying the code before creating the table is safe.**
`getScreenedMessageIds` returns an empty set when the query fails, so the sync
falls back to a full run rather than dropping mail. `recordScreenedMessages`
swallows its error for the same reason — losing the bookkeeping costs a
re-screen on the next run, never a wrong result. You will see the errors logged
until the table exists.

To confirm it is working, look for this in the sync log:

```
📇 N messages already seen (N screened, N stored)
📇 Recorded N screened message IDs
```

The first line reads 0 screened on the very first run after the table is
created, then should track the window size from the second run onward.
