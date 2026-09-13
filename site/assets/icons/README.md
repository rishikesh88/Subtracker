# Service icons

Seven files, dropped in here, then the letter tile in `index.html` swaps for an
`<img>`. Every ledger row already carries a commented example of its own line.

## Filenames

    slack.png    figma.png    notion.png    claude.png
    canva.png    adobe.png    google.png

`.jpg` works too — just change the extension in the `<img src>` to match.

## Format

- **PNG preferred.** These are flat-colour logos with hard edges, which is
  exactly what JPEG handles worst: at 20px you get visible ringing around the
  Notion cube's outline and the Google G. PNG is lossless and the files are
  tiny at this size.
- **80×80 or larger.** They render at 20×20, so anything smaller looks soft on
  a retina screen. 160×160 is a safe upper bound; there is no benefit beyond it.
- **Square.** The tile is square with rounded corners and the image fills it
  edge to edge.

## Two kinds of icon, both handled

The supplied set mixes full-bleed app tiles that carry their own background
(Canva, Adobe Creative Cloud) with flat marks on white or transparent (Slack,
Figma, Notion, Google, Claude).

`.ledger__chip--icon` lets the image fill the whole rounded tile, so the
gradient ones *become* the tile and the flat ones sit on a white one. Both read
as the same component. Do not add padding to make the flat marks smaller — that
is what makes a mixed set look mismatched.

## Swapping one in

Replace the letter span:

```html
<span class="ledger__chip ledger__chip--sky" aria-hidden="true">S</span>
```

with:

```html
<span class="ledger__chip ledger__chip--icon">
  <img src="assets/icons/slack.png" alt="">
</span>
```

Keep `alt=""` — the service name is right beside it, so the icon is decorative
and a screen reader should skip rather than announce it twice.

## Canva

The Canva icon is a script wordmark on a gradient tile. At 20px that word is
unreadable. Either find Canva's standalone mark, or leave that row on its letter
tile — an honest "C" beats an illegible smudge.

## One caution

These are other companies' trademarks. Showing them to illustrate "subscriptions
Verloq detected" is descriptive use and normally fine, but do not arrange them
so the page reads as a partner or integration wall, and do not recolour, crop or
distort them. Adobe and Google both publish brand guidelines worth a glance.
