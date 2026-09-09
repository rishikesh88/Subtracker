import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { storage } from "./storage";
import { setupVite, serveStatic, log } from "./vite";
import fs from "fs";
import path from "path";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    // A malformed percent-escape in the URL makes Express throw URIError out of
    // decodeURIComponent before any route sees it. That is a bad request, not a
    // server fault -- production logged a full stack trace for a scanner sending
    // "/%c0".
    const isMalformedUrl = err instanceof URIError;
    const status = isMalformedUrl ? 400 : (err.status || err.statusCode || 500);
    const message = isMalformedUrl ? "Malformed URL" : (err.message || "Internal Server Error");

    if (!res.headersSent) {
      res.status(status).json({ message });
    }

    // Logged rather than rethrown. Throwing after the response is already sent
    // produced an unhandled rejection and a stack trace for every bad URL,
    // without making the error any more visible than this does.
    if (isMalformedUrl) {
      console.warn(`Rejected malformed URL: ${err.message}`);
    } else {
      console.error('Unhandled request error:', err);
    }
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  // In production (running from dist/index.js), public/ is a sibling directory
  // In development, always use Vite regardless of whether dist exists
  const isProduction = process.env.NODE_ENV === 'production';
  const prodPublicPath = path.resolve(import.meta.dirname, "public");
  
  if (isProduction && fs.existsSync(prodPublicPath)) {
    serveStatic(app);
  } else {
    await setupVite(app, server);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, async () => {
    log(`serving on port ${port}`);

    // A process that restarts mid-sync leaves its job `running` forever, which
    // the one-running-per-user index would then read as "already in progress"
    // and use to refuse every future sync. Clearing them here is what makes an
    // interrupted run recoverable rather than permanently blocking.
    //
    // Safe only because this runs as a single instance: with several replicas
    // on one database it would fail jobs that are legitimately running.
    try {
      const swept = await storage.sweepStuckSyncJobs();
      if (swept > 0) {
        log(`swept ${swept} sync job(s) left running by a previous process`);
      }
    } catch (error) {
      console.error('Failed to sweep stuck sync jobs:', error);
    }
  });
})();
