/**
 * A seam between "something happened that should cause a sync" and the code
 * that actually syncs.
 *
 * Those two lived in different modules with different implementations: the
 * sync behind the button handled Gmail and Outlook, while the one that fires
 * after onboarding was an older parser whose Outlook branch was an empty stub
 * printing "Outlook sync deferred". Connecting an Outlook mailbox during
 * onboarding therefore did nothing, and the dashboard stayed empty.
 *
 * Importing the route module from the trigger would be a cycle, so the route
 * module publishes its runner here at registration and the trigger picks it
 * up. One implementation, two callers.
 */

export type SyncRunner = (userId: string) => Promise<void>;

let runner: SyncRunner | null = null;

export function setSyncRunner(fn: SyncRunner): void {
  runner = fn;
}

export function getSyncRunner(): SyncRunner | null {
  return runner;
}
