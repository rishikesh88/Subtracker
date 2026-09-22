import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { findService, type CatalogueService } from "@/lib/serviceCatalogue";

/**
 * Where a logo comes from, in order.
 *
 * 1. Simple Icons, for the 21 catalogue brands it still carries. Official
 *    mark, official colour, no API key, and one consistent silhouette weight
 *    across the whole grid.
 * 2. A favicon, for the nine Simple Icons has withdrawn at the trademark
 *    holders' request -- Slack, Salesforce, Adobe, AWS, Azure, Microsoft 365,
 *    Canva, OpenAI and Monday.com. Whatever the site publishes, so quality
 *    varies, but a real logo beats a letter.
 * 3. The service's first letter, for everything else -- which is every
 *    subscription found in email, since those are named by whatever the
 *    receipt called them and have no domain to look up.
 *
 * Changing provider is these two functions and nothing else.
 */
function simpleIconsUrl(slug: string): string {
  return `https://cdn.simpleicons.org/${slug}`;
}

function faviconUrl(domain: string): string {
  return `https://icons.duckduckgo.com/ip3/${domain}.ico`;
}

function sourcesFor(service: CatalogueService | undefined): string[] {
  if (!service) return [];
  return service.slug
    ? [simpleIconsUrl(service.slug), faviconUrl(service.domain)]
    : [faviconUrl(service.domain)];
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
