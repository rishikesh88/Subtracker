import { useQuery } from "@tanstack/react-query";

/**
 * Whether a feature switch is on for the signed-in user.
 *
 * Switches are managed in the admin console (Features); the server decides,
 * and this only asks. False while loading and on any error, so a gated
 * feature never flashes on for someone who should not have it.
 *
 * One request serves every useFeature() on the page. The answer is kept for
 * five minutes rather than forever (the app's default), so a screen opened
 * after a switch changes asks again instead of needing a full reload.
 */
export function useFeature(key: string): boolean {
  const { data } = useQuery<{ enabled: string[] }>({
    queryKey: ["/api/features"],
    staleTime: 5 * 60 * 1000,
  });
  return data?.enabled?.includes(key) ?? false;
}
