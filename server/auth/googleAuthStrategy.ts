import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import type { IStorage } from "../storage";
import { APP_BASE_URL } from "../config";

// Google OAuth Strategy for user authentication (separate from Gmail email access)
export function setupGoogleAuthStrategy(storage: IStorage) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    console.warn("Google Auth credentials not configured. Google sign-in will be disabled.");
    return;
  }

  const callbackURL = `${APP_BASE_URL}/api/auth/google-login/callback`;

  passport.use(
    "google-auth",
    new GoogleStrategy(
      {
        clientID: clientId,
        clientSecret: clientSecret,
        callbackURL,
        scope: ["openid", "profile", "email"],
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          // Extract user info from Google profile
          const email = profile.emails?.[0]?.value;
          const firstName = profile.name?.givenName || null;
          const lastName = profile.name?.familyName || null;
          const profileImageUrl = profile.photos?.[0]?.value || null;

          if (!email) {
            return done(new Error("No email found in Google profile"));
          }

          // Check if user exists by email
          let user = await storage.getUserByEmail(email);

          if (!user) {
            // Create new user account
            user = await storage.createUserWithPassword({
              email,
              firstName,
              lastName,
              profileImageUrl,
              passwordHash: null, // No password for OAuth users
            });
            
            console.log('[Event: user_signup_google]', { userId: user.id, email });
          } else {
            // Update profile image if available
            if (profileImageUrl && user.profileImageUrl !== profileImageUrl) {
              await storage.updateUser(user.id, { 
                profileImageUrl,
                updatedAt: new Date()
              });
            }
            
            console.log('[Event: user_login_google]', { userId: user.id, email });
          }

          // Return normalized user object for session (consistent with email/password auth)
          return done(null, { 
            authType: 'google_oauth',
            userId: user.id,
            claims: { sub: user.id, email: user.email }
          });
        } catch (error) {
          console.error("Google Auth error:", error);
          return done(error);
        }
      }
    )
  );

  console.log("Google Auth strategy configured");
}
