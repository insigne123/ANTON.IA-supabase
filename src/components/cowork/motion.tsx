'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, LazyMotion, MotionConfig, m, useReducedMotion, type Transition, type Variants } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * Motion for Cowork (docs/ui-ux/motion.md): every transition answers a question
 * the person has (what appeared, what changed, where it came from, did it finish).
 * CSS keeps the mount-only effects (cowork.css); this module covers what CSS
 * cannot: exits and state swaps. LazyMotion with `strict` keeps the bundle
 * small: use `m.*`, never `motion.*`. The animation features load after the page
 * is interactive; until then elements show at rest, which is also what history needs.
 */

export const CW_EASE = [0.2, 0.7, 0.2, 1] as const;
export const CW_EASE_IN = [0.4, 0, 1, 1] as const;

/** Seconds. State changes are quick; things that enter take a little longer. */
export const CW_DURATION = { state: 0.16, enter: 0.28, exit: 0.18, panel: 0.3 } as const;

export const cwEnter: Transition = { duration: CW_DURATION.enter, ease: CW_EASE };
export const cwExit: Transition = { duration: CW_DURATION.exit, ease: CW_EASE_IN };

/** Appears from slightly below; leaves upward, faster. */
export const cwFadeRise: Variants = {
  hidden: { opacity: 0, y: 6 },
  shown: { opacity: 1, y: 0, transition: cwEnter },
  gone: { opacity: 0, y: -4, transition: cwExit },
};

/** Something in the flow of the page: it opens its space and closes it on the way out, so
 * nothing jumps. It clips only while it moves, so focus rings and shadows show at rest. */
export const cwCollapse: Variants = {
  hidden: { opacity: 0, height: 0, overflow: 'hidden' },
  shown: {
    opacity: 1, height: 'auto', transitionEnd: { overflow: 'visible' },
    transition: { height: cwEnter, opacity: { duration: CW_DURATION.enter, delay: 0.04 } },
  },
  gone: { opacity: 0, height: 0, overflow: 'hidden', transition: { height: cwExit, opacity: { duration: 0.1 } } },
};

/** A small control that pops in and out (the jump-to-end button, a chip). */
export const cwPop: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  shown: { opacity: 1, scale: 1, transition: { duration: CW_DURATION.state, ease: CW_EASE } },
  gone: { opacity: 0, scale: 0.92, transition: { duration: 0.12, ease: CW_EASE_IN } },
};

/** A panel that slides in from its edge. `custom` is the direction: 1 from the right, -1 from the left. */
export const cwPanel: Variants = {
  hidden: (from: number = 1) => ({ opacity: 0, x: 16 * from }),
  shown: { opacity: 1, x: 0, transition: { duration: CW_DURATION.panel, ease: CW_EASE } },
  gone: (from: number = 1) => ({ opacity: 0, x: 12 * from, transition: cwExit }),
};

/** One content replacing another in the same place: a quick cross-fade. */
export const cwSwap: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: { duration: CW_DURATION.state, ease: CW_EASE } },
  gone: { opacity: 0, transition: { duration: 0.12, ease: CW_EASE_IN } },
};

/** Props for an element that enters with `variants`; `animateIn` false shows it at rest (old turns loaded from history). */
export function cwVariants(variants: Variants, animateIn = true) {
  return { variants, initial: animateIn ? 'hidden' : false, animate: 'shown', exit: 'gone' } as const;
}

/**
 * Opens and closes its space in the page. With reduced motion it only fades:
 * the space changes at once instead of sliding. Keep its spacing inside
 * (padding), not as margins, so the space it leaves is exact.
 */
export function CwCollapse({ show, children, className, animateIn = true }: {
  show: boolean; children: ReactNode; className?: string; animateIn?: boolean;
}) {
  const reduce = useReducedMotion();
  return <AnimatePresence initial={false}>
    {show && <m.div key="collapse" className={cn(className)} {...cwVariants(reduce ? cwSwap : cwCollapse, animateIn)}>{children}</m.div>}
  </AnimatePresence>;
}

/**
 * A number that counts up to its value when it appears live, so a result reads
 * as just found. At rest (history, reduced motion) and for numbers up to 9 it
 * shows the value at once.
 * Screen readers get only the final value; `announce` false leaves even that to
 * the surrounding text (a chip already hidden from them).
 */
export function CwCount({ value, animateIn = true, duration = 0.5, announce = true }: { value: number; animateIn?: boolean; duration?: number; announce?: boolean }) {
  const reduce = useReducedMotion();
  // Small numbers read at a glance (and «1 contactos» would flash by): only larger ones count, from half.
  const still = !animateIn || Boolean(reduce) || value <= 9;
  const [shown, setShown] = useState(still ? value : Math.floor(value / 2));
  const from = useRef(shown);
  useEffect(() => {
    if (still) { setShown(value); from.current = value; return; }
    const origin = from.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / (duration * 1000));
      const next = Math.round(origin + (value - origin) * (1 - (1 - progress) ** 3));
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(tick); else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, still, duration]);
  return <><span aria-hidden="true" className="tabular-nums">{shown}</span>{announce && <span className="sr-only">{value}</span>}</>;
}

/**
 * The motion context of the workspace. `reducedMotion="user"` turns movement
 * into plain fades when the system asks for less motion; cowork.css does the
 * same for the CSS effects.
 */
const loadFeatures = () => import('./motion-features').then(mod => mod.default);

export function CoworkMotion({ children }: { children: ReactNode }) {
  return <LazyMotion features={loadFeatures} strict>
    <MotionConfig reducedMotion="user" transition={cwEnter}>{children}</MotionConfig>
  </LazyMotion>;
}

export { AnimatePresence, m, useReducedMotion };
