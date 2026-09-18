# Verloq — Graphite + Crimson

The design system the app is built to. Extracted from the three Claude Design
files (foundations, screens, dashboard) supplied on 17 September 2026.

**The tokens live in `client/src/index.css`.** This document explains what they
mean and when to use which. Components reference tokens, never a raw hex value.

---

## The one rule that is easy to get wrong

**Black is primary. Violet is not.**

Violet (`--accent`, `#4F46E5`) is reserved for four things:

1. the brand mark
2. the active navigation row's icon
3. focus rings
4. **the single action that moves someone forward on a screen** — connect a
   mailbox, reconnect, add a subscription

**One violet button per screen, never two.** On the dashboard that is "Add
subscription", which makes "Sync now" a secondary button. If a screen seems to
need two, one of them is not really the forward action.

---

## Colour

| Token | Value | Used for |
|---|---|---|
| `--canvas` | `#FAFAFA` | the page behind everything. Never white |
| `--surface` | `#FFFFFF` | cards, rows, bars — the things on the canvas |
| `--rail` | `#F5F5F5` | the sidebar |
| `--rail-active` | `#E8E8E8` | the current nav row |
| `--rail-hover` | `#EFEFEF` | nav row hover |
| `--foreground` | `#0A0A0A` | headings, figures |
| `--ink-strong` | `#333333` | control labels |
| `--ink-body` | `#525252` | running text |
| `--muted-foreground` | `#666666` | captions, inactive nav |
| `--border` | `#E4E4E4` | card and section edges |
| `--border-soft` | `#F0F0F0` | dividers inside a card |
| `--border-firm` | `#D8D8D8` | input and button outlines |
| `--accent` | `#4F46E5` | see the rule above |
| `--accent-hover` | `#4338CA` | its hover |
| `--accent-deep` | `#3730A3` | accent text on `--accent-soft` |
| `--accent-soft` | `#EEEDFC` | the trial badge ground |

### Status — ink on a soft ground, never a saturated fill

| State | Ink | Ground | Class |
|---|---|---|---|
| Active | `#1E6B45` | `#E3F2E8` | `.status-active` |
| Needs review | `#7A5C15` | `#F7EDD3` | `.status-review` |
| Trial | `#3730A3` | `#EEEDFC` | `.status-trial` |
| Cancelled | `#6B6B6B` | `#EFEFEF` | `.status-cancelled` |

The review banner has its own pair: `--warning-bg` `#FDF8EC` inside
`--warning-line` `#EADFC2`.

---

## Type

Three faces. **Crimson Pro at 400 only** — weight comes from size, and a bold
Crimson reads as a different typeface.

| Class | Size / weight | Face | Used for |
|---|---|---|---|
| `.t-display` | 46 / 400 | Crimson Pro | the largest heading on a page |
| `.t-page` | 34 / 400 | Crimson Pro | page titles — "Dashboard" |
| `.t-section` | 21 / 400 | Crimson Pro | the brand wordmark, section titles |
| `.t-metric` | 22 / 700 | Archivo | the figure on a metric card |
| `.t-price` | 18 / 700 | Archivo | a price on a subscription card |
| `.t-card-title` | 14.5 / 600 | Archivo | a subscription name |
| `.t-body` | 13 / 400 | Archivo | running text |
| `.t-caption` | 11.5 / 400 | Archivo | "Synced 2 hours ago" |
| `.t-eyebrow` | 11 / 600, uppercase, `0.06em` | Archivo | metric card labels |

Every figure that appears in a column gets `font-variant-numeric: tabular-nums`
— the `.tabular` utility, already on `.t-metric` and `.t-price`.

JetBrains Mono is for literal values (a hex code, an ID), not for prices.

---

## Space and radius

A 4px base. **Compact density** — card padding lands on 14 and grid gaps on 12.
Nothing breathes for the sake of breathing.

| Step | Used for |
|---|---|
| 4 | icon ↔ label gap |
| 8 | button group |
| 12 | grid gap |
| 14 | card padding |
| 20 | section gap |
| 24 | page gutter |

Five radii, each named for its job: `rounded-badge` (5), `rounded-button` (7),
`rounded-logo` (9), `rounded-card` (12), `rounded-shell` (16).

---

## Atoms

**Buttons** are 32px tall, 13px side padding, `rounded-button`, 12.5px label.

| Class | Looks like | When |
|---|---|---|
| `.btn-base .btn-primary` | black fill, white text, 600 | the default action |
| `.btn-base .btn-accent` | violet fill, white text, 600 | the one forward action |
| `.btn-base .btn-secondary` | white fill, `--border-firm` outline, 500 | everything else |
| `.btn-base .btn-ghost` | no fill, no border, 500 | tertiary, in dense rows |

**Badges**: status is filled (`.badge-status` + a `.status-*`), cadence is
outlined (`.badge-cadence`), category is soft (`.badge-category`).

**Fields** are 32px, `.field`, with a 2px accent focus ring.

**Icons** are Lucide — the shadcn set. 15px inside rows and buttons, 17px
standalone, 2px stroke, `--muted-foreground` unless the item is active.

---

## The shell

A 212px sidebar on `--rail`, collapsing to 56px. Brand tile (22px, violet,
`rounded-logo`) plus "Verloq" in Crimson Pro 21. Nav rows are 32px, `rounded-lg`,
active on `--rail-active` at weight 600 with a violet icon. The account block
sits at the bottom.

Nav: **Dashboard · Subscriptions · Review inbox · Settings.**

---

## What the design shows that the app cannot do yet

Deliberately **left out**, not stubbed — a section that does nothing is worse
than no section, particularly with a Google reviewer reading these screens.

- price history and the "up 8% since 2024" trend
- "Paid with HDFC card ending 4412"
- seat counts
- renewal reminders and price-rise alerts
- Settings tabs for Team and Billing

Add them to the design's layout only once the data behind them is real.

---

## Dark mode

There is none. The design specifies light values only, and deriving fifteen
dark equivalents would mean shipping colours nobody chose. `darkMode` is off in
`tailwind.config.ts`, so a stray `dark:` utility does nothing rather than
half-working.
