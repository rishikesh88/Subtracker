# Generated schema, for reference — nothing here runs

`0000_baseline.sql` is what `drizzle-kit generate` produces from
`shared/schema.ts` as it stands. It was generated while investigating why
`npm run db:push` reports drift against the live database.

## Do not run `drizzle-kit migrate` against an existing database

The baseline is a full `CREATE TABLE` script for all 11 tables. Neon already
has them. Running it would fail on the first statement at best, and there is
no reason to find out what the worst is.

This project still applies schema changes with `npm run db:push`. That has not
changed, and nothing in this folder is wired into the build or the start
command.

## What it is for

Two things.

**A target to diff against.** `push` will not say what it objects to in terms
you can read. This will:

```bash
DATABASE_URL="<neon url>" npx drizzle-kit pull --out ./drift
diff <(sort drift/schema.ts) <(sort shared/schema.ts)
```

`pull` only reads — it introspects the live database and writes a local file.
No backup window is needed to find out what the drift is. One is only needed
to fix it, which is why this was parked longer than it had to be.

**Proof the schema itself is sound.** It generates cleanly: 11 tables, no
errors. So whatever `push` is unhappy about is a difference between this
schema and what is in Neon, not a broken definition.

## If this project ever moves off `push`

Generated migrations are the better end state: versioned SQL you read before
it runs, rather than a diff guessed fresh each time with destructive options
attached. Getting there from a live database means baselining — telling
drizzle the existing tables are already applied — not running this file.

That is a deliberate change to how deploys work and has not been made.
