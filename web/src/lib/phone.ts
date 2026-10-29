import { useSyncExternalStore } from "react";

const queries = new Map<string, { query: MediaQueryList | null; subscribe: (cb: () => void) => () => void }>();

function watch(media: string) {
  let w = queries.get(media);
  if (!w) {
    const query = typeof window !== "undefined" ? window.matchMedia(media) : null;
    w = {
      query,
      subscribe: (cb) => {
        query?.addEventListener("change", cb);
        return () => query?.removeEventListener("change", cb);
      },
    };
    queries.set(media, w);
  }
  return w;
}

/** Whether a media query matches, kept up to date (rotation, resizing). */
export function useMedia(media: string): boolean {
  const { query, subscribe } = watch(media);
  return useSyncExternalStore(subscribe, () => !!query?.matches, () => false);
}

/** True under 640px wide, where the app switches to its phone layout
 *  (Tailwind's `sm` breakpoint). For sizes that are props, not classes. */
export const useIsPhone = () => useMedia("(max-width: 639px)");

/** True on a short screen, mostly a phone turned sideways: the app keeps its
 *  side rail but trims the bars above and below the page (the `short:` variant). */
export const useIsShort = () => useMedia("(max-height: 520px)");
