// Central runtime configuration.
//
// Values that used to come from Replit's injected environment (REPLIT_DOMAINS,
// REPLIT_DEV_DOMAIN, REPL_ID) are replaced by explicit env vars here. Anything
// required in production fails loudly at startup rather than silently falling
// back to a development default — a wrong base URL surfaces as a broken OAuth
// redirect much later and much less obviously.

const isProduction = process.env.NODE_ENV === "production";

function requiredInProduction(name: string, devDefault: string): string {
  const value = process.env[name];
  if (value) {
    return value;
  }
  if (isProduction) {
    throw new Error(
      `${name} must be set in production. Refusing to start with the development default.`
    );
  }
  return devDefault;
}

// Public origin the app is served from, with no trailing slash.
// Used to build every OAuth redirect URI.
export const APP_BASE_URL = requiredInProduction(
  "APP_BASE_URL",
  "http://localhost:5000"
).replace(/\/+$/, "");

// express-session secret. No fallback in production: a default here would let
// every deploy share a guessable signing key.
export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) {
    return secret;
  }
  if (isProduction) {
    throw new Error("SESSION_SECRET must be set in production.");
  }
  return "dev-only-insecure-session-secret";
}
