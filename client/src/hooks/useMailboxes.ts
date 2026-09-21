import { useQuery } from "@tanstack/react-query";

/**
 * Whether this account has any mailbox connected, of any provider.
 *
 * The UI used to ask `user.gmailConnected` for this, which was the same
 * question only while Gmail was the only provider. With an Outlook mailbox
 * connected and no Gmail one, the dashboard offered "Connect Gmail" instead
 * of "Sync now" and the sidebar claimed no mailbox was connected -- both
 * wrong, and both leaving someone with a working mailbox no way to sync it.
 */
export function useMailboxes() {
  const gmail = useQuery<unknown[]>({ queryKey: ["/api/gmail/accounts"] });
  const outlook = useQuery<unknown[]>({ queryKey: ["/api/outlook/accounts"] });

  const gmailCount = gmail.data?.length ?? 0;
  const outlookCount = outlook.data?.length ?? 0;

  return {
    gmailCount,
    outlookCount,
    hasAny: gmailCount + outlookCount > 0,
    /*
     * Until both answers are in, "no mailbox" is not yet known -- and drawing
     * "Connect Gmail" to someone who has one, for the moment it takes to
     * load, is the same wrong answer in miniature.
     */
    isLoading: gmail.isLoading || outlook.isLoading,
  };
}
