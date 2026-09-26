import { router, type Href } from 'expo-router';

/**
 * Back, or somewhere sensible when there is nothing to go back to. A screen opened from a
 * notification or a kagi:// link is the only one on the stack, and router.back() then does
 * nothing, which leaves Close and Back dead.
 */
export function goBack(fallback: Href = '/home') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
