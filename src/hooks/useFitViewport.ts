import { useEffect } from "react";
import type { RefObject } from "react";

interface Options {
  /** Minimum height (px) the container is allowed to shrink to. */
  min?: number;
  /** Max viewport width (px) at which the fitting applies; above it, desktop CSS wins. */
  breakpoint?: number;
}

/**
 * On phones (≤ breakpoint) size the referenced layout container to exactly fill
 * from its top to the bottom of the viewport — measured, not a magic offset — so
 * a fixed board on top can pin and the scrollable panel below is never pushed
 * off-screen on devices with tall status/nav bars. On desktop it clears the
 * inline height and lets the CSS grid/flex layout take over.
 *
 * Intentionally has no dependency array: it re-measures on every render, which
 * picks up content-driven height changes in the board column (e.g. a line
 * preview appearing) without needing to enumerate them.
 */
export function useFitViewport(ref: RefObject<HTMLElement>, opts: Options = {}) {
  const { min = 320, breakpoint = 820 } = opts;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      if (window.innerWidth > breakpoint) {
        el.style.height = "";
        return;
      }
      el.style.height = `${Math.max(min, window.innerHeight - el.getBoundingClientRect().top)}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    const id = window.setTimeout(fit, 100); // after layout settles
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
      window.clearTimeout(id);
    };
  });
}
