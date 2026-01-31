import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";

// Note: REPLIT_DOMAINS check moved to setupAuth() to avoid throwing at module load time

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // Only require HTTPS in production
      sameSite: 'lax',
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(
  claims: any,
) {
  await storage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  // Unified session serialization for both Replit Auth and email/password
  passport.serializeUser((user: Express.User, cb) => {
    // User object shape: { authType, userId, claims?, access_token?, refresh_token?, expires_at? }
    cb(null, user);
  });
  
  passport.deserializeUser(async (user: Express.User, cb) => {
    // User is already in normalized format from serialization
    cb(null, user);
  });

  // Only setup Replit OIDC auth if REPLIT_DOMAINS is available
  // This allows the app to work in production without Replit-specific auth
  if (!process.env.REPLIT_DOMAINS) {
    console.log('[Auth] REPLIT_DOMAINS not set, skipping Replit OIDC auth setup');
    return;
  }

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const claims = tokens.claims();
    if (!claims) {
      return verified(new Error("No claims in token"));
    }
    const user = {
      authType: 'replit_oidc',
      userId: claims.sub,
    } as any;
    updateUserSession(user, tokens);
    await upsertUser(claims);
    verified(null, user);
  };

  for (const domain of process.env.REPLIT_DOMAINS.split(",")) {
    const strategy = new Strategy(
      {
        name: `replitauth:${domain}`,
        config,
        scope: "openid email profile offline_access",
        callbackURL: `https://${domain}/api/callback`,
      },
      verify,
    );
    passport.use(strategy);
  }

  app.get("/api/login", (req, res, next) => {
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    passport.authenticate(`replitauth:${req.hostname}`, {
      successReturnToOrRedirect: "/",
      failureRedirect: "/api/login",
    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      // Add signed_out parameter to indicate successful logout
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}/?signed_out=true`,
        }).href
      );
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const user = req.user as any;
  
  // Handle email/password and OAuth authentication (non-OIDC)
  if (user.authType === 'password' || user.authType === 'google_oauth' || user.authType === 'microsoft_oauth') {
    // These auth types rely on cookie expiry (7 days) managed by express-session
    // No token refresh needed - just verify user still exists in database
    try {
      const dbUser = await storage.getUser(user.userId);
      if (!dbUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      // Attach full user data to request for downstream use
      user.dbUser = dbUser;
      return next();
    } catch (error) {
      return res.status(401).json({ message: "Unauthorized" });
    }
  }

  // Handle Replit OIDC authentication (with token refresh)
  if (user.authType === 'replit_oidc') {
    if (!user.expires_at) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const now = Math.floor(Date.now() / 1000);
    if (now <= user.expires_at) {
      return next();
    }

    const refreshToken = user.refresh_token;
    if (!refreshToken) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      const config = await getOidcConfig();
      const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
      updateUserSession(user, tokenResponse);
      return next();
    } catch (error) {
      return res.status(401).json({ message: "Unauthorized" });
    }
  }

  // Unknown auth type
  return res.status(401).json({ message: "Unauthorized" });
};