import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { findService, domainsFromEmail } from "@/lib/serviceCatalogue";

/**
 * The one place a logo URL is built.
 *
 * Brandfetch, keyed on the service's domain. All thirty catalogue domains
 * were checked against it in a browser and every one resolves, so there is
 * no second icon source to fall through to -- an earlier revision carried
 * Simple Icons behind this, which turned out to be covering nothing.
 *
 * The client id is publishable by design: it travels inside every image URL
 * and is readable from the browser regardless, which is why it is compiled
 * into the bundle. Unset is a supported state -- every logo becomes a letter
 * tile and nothing breaks, which is what a deploy looks like before the
 * variable is set.
 *
 * Changing provider is this function and nothing else.
 */
const BRANDFETCH_CLIENT_ID = import.meta.env.VITE_BRANDFETCH_CLIENT_ID as string | undefined;

function logoUrl(domain: string): string | null {
  if (!BRANDFETCH_CLIENT_ID) return null;
  return `https://cdn.brandfetch.io/${domain}?c=${BRANDFETCH_CLIENT_ID}`;
}

/**
 * Every domain worth trying for this subscription, best first.
 *
 * The catalogue's own domain leads because it is curated. After that comes
 * the address the receipt arrived from, which is what gives a logo to
 * everything the catalogue does not list -- Netflix, Swiggy, an insurer --
 * since for a billing email the sender is the brand.
 */
function candidateUrls(name: string | null | undefined, merchantEmail?: string | null): string[] {
  const service = findService(name);
  const domains = [service?.domain, ...domainsFromEmail(merchantEmail)]
    .filter((d): d is string => Boolean(d));

  const seen = new Set<string>();
  return domains
    .filter((d) => !seen.has(d) && seen.add(d))
    .map(logoUrl)
    .filter((u): u is string => u !== null);
}

interface ServiceLogoProps {
  name: string | null | undefined;
  /**
   * The address this subscription's receipts come from, where there is one.
   * Passing it is what lets a brand outside the catalogue find its logo.
   */
  merchantEmail?: string | null;
  /** Tile edge in px. */
  size?: number;
  className?: string;
}

/**
 * A service's logo, falling back to its first letter.
 *
 * The fallback is not an edge case. It is what every subscription found in
 * email gets, since those are named by whatever the receipt called them and
 * have no domain to look up. So the letter tile keeps the exact dimensions
 * and shape of the logo tile, and a row of cards does not shift when one of
 * them cannot find a mark.
 */
export function ServiceLogo({ name, merchantEmail, size = 34, className }: ServiceLogoProps) {
  const sources = useMemo(() => candidateUrls(name, merchantEmail), [name, merchantEmail]);
  const [attempt, setAttempt] = useState(0);
  const src = sources[attempt];

  // A card can be reused for a different subscription as a list re-renders;
  // without this, one failed logo would poison every later name in that slot.
  useEffect(() => setAttempt(0), [sources.join("|")]);

  /* A white tile with a hairline edge and `overflow-hidden`, which is what
     does the work here: Brandfetch sends a square image that usually carries
     its own background, so insetting it left a square sitting inside a round
     box. Filling the tile instead puts the image's own corners under the
     tile's radius, and they get clipped to it. */
  const tile = cn(
    "flex-none rounded-logo bg-surface border border-line",
    "flex items-center justify-center overflow-hidden",
    className
  );
  const style = { width: size, height: size };

  if (!src) {
    return (
      <span
        className={cn(tile, "font-bold text-ink-body")}
        style={{ ...style, fontSize: Math.round(size * 0.41) }}
        aria-hidden="true"
        data-testid="service-logo-initial"
      >
        {(name?.trim()?.[0] ?? "?").toUpperCase()}
      </span>
    );
  }

  return (
    <span className={tile} style={style}>
      <img
        // Remounting on src change resets the element's own error state, so a
        // second candidate is actually attempted rather than staying broken.
        key={src}
        src={src}
        alt=""
        loading="lazy"
        // Advances to the next candidate domain; running out lands on the letter.
        onError={() => setAttempt((n) => n + 1)}
        /* Fills the tile edge to edge so the radius has something to clip.
           `cover` rather than `contain`: contain letterboxes, which leaves the
           tile's own white showing in two corners and defeats the point. The
           source is square, so nothing is cropped. */
        className="w-full h-full object-cover"
        data-testid="service-logo-image"
      />
    </span>
  );
}
