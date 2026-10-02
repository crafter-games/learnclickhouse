"use client";

import { useEffect, useState, type RefObject } from "react";

export type Insets = { top: number; right: number; bottom: number; left: number };

/**
 * Measures floating UI (header, side/bottom card, dock) so the 3D stage can frame its content
 * in the free area instead of hiding it under cards or leaving empty bands.
 */
export function useInsets(
  refs: { header?: RefObject<HTMLElement | null>; side?: RefObject<HTMLElement | null>; dock?: RefObject<HTMLElement | null>; objective?: RefObject<HTMLElement | null> },
  deps: unknown[] = [],
): Insets {
  const [insets, setInsets] = useState<Insets>({ top: 72, right: 0, bottom: 0, left: 0 });

  useEffect(() => {
    const measure = () => {
      const h = window.innerHeight;
      const wide = window.matchMedia("(min-width: 1024px)").matches;
      const w = window.innerWidth;
      const header = refs.header?.current?.getBoundingClientRect();
      const side = refs.side?.current?.getBoundingClientRect();
      const dock = refs.dock?.current?.getBoundingClientRect();
      const objective = refs.objective?.current?.getBoundingClientRect();
      const top = Math.max(header ? header.bottom + 4 : 0, objective && objective.height ? objective.bottom + 6 : 0);
      const bottom = dock && dock.height ? h - dock.top + 6 : 12;
      if (wide) {
        // Side panel: on the left it pushes from the left, on the right from the right
        const onLeft = side && side.width && side.left < w / 2;
        setInsets({
          top,
          left: onLeft ? side!.right + 8 : 12,
          right: side && side.width && !onLeft ? w - side.left + 8 : 12,
          bottom,
        });
      } else {
        // Phones: panels sit under the header
        setInsets({ top: Math.max(top, side && side.height ? side.bottom + 6 : 0), right: 0, left: 0, bottom });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    for (const r of [refs.header, refs.side, refs.dock, refs.objective]) if (r?.current) ro.observe(r.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return insets;
}
