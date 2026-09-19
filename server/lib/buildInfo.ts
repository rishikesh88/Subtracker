import fs from "fs";
import path from "path";

/**
 * What is actually running, as opposed to what the platform says is running.
 *
 * The distinction matters. RAILWAY_GIT_COMMIT_SHA is set on the container at
 * deploy time, not baked into the image -- so a deploy that reused cached
 * build layers still reports the newest commit while serving the previous
 * build's code. Trusting it is how three separate changes were merged,
 * reported as deployed, and never actually ran.
 *
 * So this reports two independent things side by side:
 *
 *   commit  -- what the platform claims it deployed (runtime)
 *   client  -- the built asset filenames, which Vite derives from the
 *              content of the client source (build)
 *   builtAt -- when the server bundle was written (build)
 *
 * If the commit moves and the asset names do not, the build was cached and
 * the deploy shipped old code. That is the question this endpoint exists to
 * answer without anyone reading a build log.
 */
export interface BuildInfo {
  commit: string;
  client: { js: string | null; css: string | null };
  builtAt: string | null;
}

function findPublicDir(): string | null {
  const candidates = [
    // Production: the server is one bundle at dist/index.js, so this resolves
    // to dist/ and the client sits beside it.
    path.resolve(import.meta.dirname, "public"),
    path.resolve(import.meta.dirname, "..", "public"),
    path.resolve(process.cwd(), "dist", "public"),
  ];
  return candidates.find((dir) => fs.existsSync(path.join(dir, "index.html"))) ?? null;
}

function readAssets(publicDir: string): { js: string | null; css: string | null } {
  try {
    const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
    const js = html.match(/assets\/[A-Za-z0-9._-]+\.js/)?.[0] ?? null;
    const css = html.match(/assets\/[A-Za-z0-9._-]+\.css/)?.[0] ?? null;
    return { js, css };
  } catch {
    return { js: null, css: null };
  }
}

function readBuiltAt(publicDir: string): string | null {
  // The server bundle's timestamp. A reused layer keeps the old one, which is
  // the tell: a "fresh" deploy whose builtAt has not moved did not rebuild.
  try {
    return fs.statSync(path.resolve(publicDir, "..", "index.js")).mtime.toISOString();
  } catch {
    return null;
  }
}

/**
 * Read once at startup. The answer cannot change while the process runs, and
 * a health check should not touch the filesystem on every request.
 */
export const buildInfo: BuildInfo = (() => {
  const commit = (
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.SOURCE_COMMIT ||
    process.env.GIT_COMMIT ||
    ""
  ).slice(0, 7) || "unknown";

  const publicDir = findPublicDir();
  if (!publicDir) {
    // Development: Vite serves the client, so there is nothing built to report.
    return { commit, client: { js: null, css: null }, builtAt: null };
  }

  return { commit, client: readAssets(publicDir), builtAt: readBuiltAt(publicDir) };
})();
