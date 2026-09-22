# Service icons

Seven brand marks, one per ledger row in `index.html`.

## These are now the fallback, not the first choice

The ledger rows fetch their logo from Brandfetch, keyed on the service's
domain, so the site and the app draw a brand the same way. Each `<img>` still
names its file here in an `onerror` handler: if Brandfetch is unreachable,
rate-limited, or has no mark for that domain, the row falls back to the file
beside this README and the hero keeps working.

Do not delete them. They are the reason a third-party outage cannot empty the
hero, and they are the only copies normalised to the inset described below.

The rest of this file records what was done to them and why.

## What is here

    slack.png    figma.png    notion.jpeg    claude.png
    canva.png    adobe.jpeg   google.png

Two are JPEG because that is how they were supplied. The `<img src>` in each row
matches the real extension; do not rename a JPEG to `.png`.

## They were normalised, and that mattered

The supplied set mixed two kinds of asset:

- **Full-bleed app tiles** that carry their own background — Adobe and Canva.
  These *are* the tile.
- **Flat marks** on white or transparent — Slack, Figma, Notion, Claude, Google.

Left alone they looked mismatched, because the flat marks ship with wildly
different built-in margins. Measured against their own canvas:

| Icon | Filled | After |
|---|---|---|
| Slack | 46% | 79% |
| Figma | 44% × 60% | 79% |
| Google | 100% | 79% |
| Claude | 100% | 79% |
| Notion | 79% | unchanged |

Slack would have rendered at roughly half Adobe's size in the same tile. So the
four outliers were trimmed to their content bounding box and re-centred on a
square 400×400 transparent canvas with the mark at 79% — the inset Notion
already had. Adobe and Canva were left untouched, full-bleed, as designed.

Aspect ratios were preserved and nothing was recoloured or cropped into the
mark itself. Figma's mark is naturally taller than it is wide and stayed that
way; it is padded to square rather than stretched.

**If you replace an icon, match the 79% inset** or it will read as the wrong
size next to the others.

## Format

- **PNG for flat marks** — lossless, and transparency lets the tile show
  through. **80×80 minimum**; these are 400×400.
- **Square.** `object-fit: cover` on a non-square source crops it.

## The markup

Each row carries:

```html
<span class="ledger__chip ledger__chip--icon">
  <img src="assets/icons/slack.png" alt="">
</span>
```

`alt=""` is deliberate — the service name sits right beside it, so the icon is
decorative and a screen reader should not announce it twice.

## One caution

These are other companies' trademarks. Showing them to illustrate
"subscriptions Verloq detected" is descriptive use and normally fine, but do
not arrange them so the page reads as a partner or integration wall, and do not
recolour or distort them. Adobe and Google both publish brand guidelines worth
a glance.
