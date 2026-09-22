/*
 * The Verloq mark.
 *
 * One copy, because it sits in four separate screens and a logo that drifts
 * between them is worse than no logo at all.
 *
 * The paths are filled with `currentColor` rather than the brand indigo, so
 * the colour comes from the surrounding text colour: `text-accent` on a light
 * surface, `text-white` on a dark one. The brand indigo and `--accent` are the
 * same value (#4F46E5), so the default needs no special case.
 *
 * Hidden from screen readers by default: every use pairs it with the word
 * "Verloq", and announcing both reads the name twice.
 */
export function Logo({
  size = 22,
  className = "text-accent",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 300 300"
      fill="none"
      aria-hidden="true"
      className={`flex-none ${className}`}
    >
      <path
        d="M31 179.033V108.938C31 105.7 34.5859 103.748 37.3048 105.506L147.281 176.619C148.632 177.492 150.368 177.492 151.719 176.619L261.695 105.506C264.414 103.748 268 105.7 268 108.938V181.046C268 182.373 267.356 183.618 266.272 184.383L151.887 265.25C150.46 266.26 148.548 266.249 147.132 265.223L32.6896 182.342C31.6284 181.574 31 180.343 31 179.033Z"
        fill="currentColor"
      />
      <path
        d="M208.944 34.7382C210.389 33.7529 212.316 33.7545 213.762 34.7402L266.215 70.5104C268.595 72.133 268.595 75.5572 266.215 77.1798L213.762 112.95C212.316 113.936 210.389 113.936 208.944 112.95C208.944 112.95 160.681 77.9199 157.573 77.9199C154.465 77.9199 143.843 77.9182 141.428 77.9199C139.014 77.9217 90.0575 112.95 90.0575 112.95C88.6119 113.936 86.6853 113.936 85.2397 112.95L32.7838 77.1798C30.4054 75.5572 30.4054 72.1331 32.7838 70.5104L85.2397 34.7382C86.6852 33.7527 88.6121 33.7545 90.0575 34.7402C90.0575 34.7402 136.917 69.7697 141.428 69.7703C145.939 69.7708 155.166 69.7703 157.573 69.7703C159.981 69.7703 208.944 34.7382 208.944 34.7382Z"
        fill="currentColor"
      />
    </svg>
  );
}
