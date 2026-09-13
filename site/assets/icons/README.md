# Service icons

Drop the seven brand marks here, then swap the letter fallback in `index.html`
for an `<img>`. Each ledger row already carries a commented example of the
exact line to use.

## Filenames

    slack.svg
    figma.svg
    notion.svg
    claude.svg
    canva.svg
    adobe.svg
    google.svg

## Format

- **SVG** if you have it — scales cleanly, a few KB, sharp on any screen
- PNG at **80×80 or larger** works too; it renders at 20×20 so anything
  smaller will look soft on a retina display
- Transparent background
- **Square**, with the artwork centred and a little breathing room
- The **brand mark alone**, not the mark plus wordmark — the name is already
  next to it in text

## Swapping one in

Each row has a comment showing its line. Replace the letter span:

```html
<span class="ledger__chip ledger__chip--sky" aria-hidden="true">S</span>
```

with:

```html
<span class="ledger__chip ledger__chip--plain">
  <img src="assets/icons/slack.svg" alt="" width="20" height="20">
</span>
```

`.ledger__chip--plain` swaps the coloured tile for a white one with a hairline
border, which suits a full-colour logo better than a tinted square. Keep
`alt=""` — the service name sits beside it, so the icon is decorative and a
screen reader should skip it.

## One caution

These are other companies' trademarks. Showing them to illustrate "here are
subscriptions Verloq detected" is descriptive use and normally fine, but do not
arrange them in a way that reads as a partner or integration wall, and do not
recolour or distort them. Adobe and Google both publish brand guidelines worth
a glance if you want to be careful.
