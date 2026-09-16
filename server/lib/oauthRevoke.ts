/**
 * Revoking OAuth grants with the provider.
 *
 * Deleting Verloq's copy of a token stops Verloq using it, but the grant
 * itself stays listed in the user's Google or Microsoft account until the
 * provider is told. Disconnect and account deletion both need this, which is
 * why it lives here rather than beside one of them.
 */

/**
 * Revokes a Google OAuth token.
 *
 * Google answers 400 for a token that is already expired or already revoked,
 * which is a normal outcome rather than a failure worth surfacing. This never
 * throws: callers must be free to continue with local cleanup whatever the
 * provider says, because the user asked to be disconnected either way.
 */
export async function revokeGoogleToken(token: string): Promise<boolean> {
  try {
    const response = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `token=${encodeURIComponent(token)}`,
    });

    if (!response.ok) {
      console.warn(`Google token revoke returned ${response.status} (likely already expired/revoked)`);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Google token revoke request failed:", error);
    return false;
  }
}
