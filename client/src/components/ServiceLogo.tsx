import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { findService } from "@/lib/serviceCatalogue";

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

interface ServiceLogoProps {
  name: string | null | undefined;
  /** Tile edge in px. The mark is inset within it. */
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
export function ServiceLogo({ name, size = 34, className }: ServiceLogoProps) {
  const service = findService(name);
  const src = service ? logoUrl(service.domain) : null;
  const [failed, setFailed] = useState(false);

  // A card can be reused for a different subscription as a list re-renders;
  // without this, one failed logo would poison every later name in that slot.
  useEffect(() => setFailed(false), [src]);

  const tile = cn(
    "flex-none rounded-logo bg-line-soft flex items-center justify-center overflow-hidden",
    className
  );
  const style = { width: size, height: size };

  if (!src || failed) {
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
        src={src}
        alt=""
        width={Math.round(size * 0.58)}
        height={Math.round(size * 0.58)}
        loading="lazy"
        onError={() => setFailed(true)}
        data-testid="service-logo-image"
      />
    </span>
  );
}
