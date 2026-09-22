import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { findService, type CatalogueService } from "@/lib/serviceCatalogue";

/**
 * Where a logo comes from, in order.
 *
 * 1. Brandfetch, once a client id is configured. It resolves by domain, so it
 *    covers all thirty rather than the subset one icon set happens to carry.
 *    The id is publishable by design -- it travels in the image URL and is
 *    visible in the browser either way -- which is why it can live in the
 *    client bundle. Absent, this tier is simply skipped.
 * 2. Simple Icons, pinned to a major version on jsDelivr, which is the URL
 *    their README documents. Pinning matters: they withdraw brands twice a
 *    year at trademark holders' request, and an unpinned URL 404s when they
 *    do. Nine of our thirty have already gone that way.
 * 3. The service's first letter. Not an edge case -- it is what every
 *    subscription found in email gets, since those are named by whatever the
 *    receipt called them and have no domain to look up.
 *
 * An earlier version used `icons.duckduckgo.com/ip3/{domain}.ico` for tier 2.
 * That endpoint exists for DuckDuckGo's own browser extension: undocumented,
 * no published terms, no stability commitment. It should not have shipped and
 * has been removed rather than demoted.
 */
const BRANDFETCH_CLIENT_ID = import.meta.env.VITE_BRANDFETCH_CLIENT_ID as string | undefined;

/* Exactly the shape Brandfetch's own snippet uses. An earlier version added
   /w/{n}/h/{n} path segments for a retina-sized fetch; those are an extension
   this environment cannot reach the CDN to confirm, and a wrong path returns
   nothing rather than a smaller image. The tile is 30-34px and the img is
   sized in CSS, so the default serves it. */
function brandfetchUrl(domain: string): string | null {
  if (!BRANDFETCH_CLIENT_ID) return null;
  return `https://cdn.brandfetch.io/${domain}?c=${BRANDFETCH_CLIENT_ID}`;
}

function simpleIconsUrl(slug: string): string {
  return `https://cdn.jsdelivr.net/npm/simple-icons@v16/icons/${slug}.svg`;
}

function sourcesFor(service: CatalogueService | undefined): string[] {
  if (!service) return [];
  return [
    brandfetchUrl(service.domain),
    service.slug ? simpleIconsUrl(service.slug) : null,
  ].filter((u): u is string => u !== null);
}

interface ServiceLogoProps {
  name: string | null | undefined;
  /** Tile edge in px. The mark is inset within it. */
  size?: number;
  className?: string;
}

/**
 * A service's logo, falling back to its first letter.
 *
 * The fallback is not an edge case -- it is what every subscription outside
 * the catalogue gets. So the letter tile keeps the exact dimensions and shape
 * of the logo tile, and a row of cards does not shift when one of them cannot
 * find a mark.
 */
export function ServiceLogo({ name, size = 34, className }: ServiceLogoProps) {
  const service = findService(name);
  const sources = useMemo(() => sourcesFor(service), [service]);
  const [attempt, setAttempt] = useState(0);

  // A card can be reused for a different subscription as a list re-renders;
  // without this, one failed logo would poison every later name in that slot.
  useEffect(() => setAttempt(0), [service?.name]);

  const tile = cn(
    "flex-none rounded-logo bg-line-soft flex items-center justify-center overflow-hidden",
    className
  );
  const style = { width: size, height: size };
  const src = sources[attempt];

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
        // second source is actually attempted rather than staying broken.
        key={src}
        src={src}
        alt=""
        width={Math.round(size * 0.58)}
        height={Math.round(size * 0.58)}
        loading="lazy"
        onError={() => setAttempt((n) => n + 1)}
        data-testid="service-logo-image"
      />
    </span>
  );
}
