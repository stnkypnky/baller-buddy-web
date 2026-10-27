import { useSyncExternalStore } from "react";

/** True under 640px wide, where the app switches to its phone layout
 *  (Tailwind's `sm` breakpoint). For sizes that are props, not classes. */
const query = typeof window !== "undefined" ? window.matchMedia("(max-width: 639px)") : null;

export function useIsPhone(): boolean {
  return useSyncExternalStore(
    (cb) => {
      query?.addEventListener("change", cb);
      return () => query?.removeEventListener("change", cb);
    },
    () => !!query?.matches,
    () => false,
  );
}
