import { queryClient } from "@/lib/queryClient";

/**
 * Sign out and land on the sign-in page.
 *
 * Both sign-out buttons used to send the browser to /api/logout, which only
 * exists when the app runs on Replit. On Railway it answered
 * {"message":"Not found"} and the person was left on that page. This ends
 * the session through the endpoint every login type uses, then clears what
 * this browser remembers about the account.
 */
export async function signOut(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  } catch {
    /* Offline or already signed out: still leave the app below. */
  }
  queryClient.clear();
  try {
    for (const key of ["syncInProgress", "justOnboarded", "onboardedAt", "reviewBannerDismissedAt"]) {
      localStorage.removeItem(key);
    }
  } catch {
    /* Storage blocked: nothing was stored. */
  }
  window.location.replace("/login");
}
