'use client';

import {
  createContext, forwardRef, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type ReactNode,
} from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Compass } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useSidebar } from '@/components/ui/sidebar';
import { toast } from '@/hooks/use-toast';
import { getBrowserStorage } from '@/lib/browser-storage';
import {
  PRODUCT_TOUR_METADATA_KEY, PRODUCT_TOUR_VERSION, productTourRecord, productTourSteps,
  type ProductTourRecord, type ProductTourStatus, type ProductTourStep,
} from '@/lib/onboarding/product-tour';
import { cn } from '@/lib/utils';

const TOUR_ENDPOINT = '/api/onboarding/tour';
const CARD_WIDTH = 352;
const CARD_GAP = 16;
const EDGE = 16;
const SPOTLIGHT_PADDING = 4;
const SCREEN_INSET = 3;
/** The menu sheet takes this long to close. */
const SETTLE_MS = 320;

type ProductTourContextValue = { start: () => void; active: boolean };

const ProductTourContext = createContext<ProductTourContextValue>({ start: () => {}, active: false });

/** Opens the guided tour. Outside the app shell it does nothing. */
export function useProductTour() {
  return useContext(ProductTourContext);
}

type Phase = 'idle' | 'welcome' | 'touring';

type ProductTourProviderProps = {
  userId?: string | null;
  /** Client-side navigation, used by the last step to open the profile. */
  onNavigate: (href: string) => void;
  children: ReactNode;
};

export function ProductTourProvider({ userId, onNavigate, children }: ProductTourProviderProps) {
  const sidebar = useSidebar();
  const [phase, setPhase] = useState<Phase>('idle');
  const [steps, setSteps] = useState<ProductTourStep[]>([]);
  const [index, setIndex] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const collapseSidebarAfter = useRef(false);
  const scrolledAreas = useRef(new Map<HTMLElement, number>());
  const startTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(startTimer.current), []);

  // Opens on its own once, for new accounts that have not finished or skipped this version.
  useEffect(() => {
    if (!userId) return;
    const stored = readStoredRecord(userId);
    if (stored && stored.version >= PRODUCT_TOUR_VERSION) return;
    const controller = new AbortController();
    fetch(TOUR_ENDPOINT, { cache: 'no-store', signal: controller.signal })
      .then(response => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data || controller.signal.aborted) return;
        const record = productTourRecord({ [PRODUCT_TOUR_METADATA_KEY]: data.record });
        if (record) storeRecord(userId, record);
        if (data.offer === true) setPhase(current => (current === 'idle' ? 'welcome' : current));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [userId]);

  const save = useCallback((status: ProductTourStatus) => {
    if (!userId) return;
    const stored = readStoredRecord(userId);
    storeRecord(userId, { version: PRODUCT_TOUR_VERSION, status, updatedAt: new Date().toISOString() });
    // Replays leave the account as it is.
    if (stored && stored.version >= PRODUCT_TOUR_VERSION) return;
    fetch(TOUR_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
      keepalive: true,
    }).catch(() => {});
  }, [userId]);

  const begin = useCallback(() => {
    if (!sidebar.isMobile && !sidebar.open) {
      // Folded on desktop: unfold it for the tour and fold it back afterwards.
      collapseSidebarAfter.current = true;
      sidebar.setOpen(true);
    }
    setSteps(productTourSteps(sidebar.isMobile));
    setIndex(0);
    setAnnouncement('');
    setPhase('touring');
  }, [sidebar]);

  const start = useCallback(() => {
    window.clearTimeout(startTimer.current);
    if (sidebar.isMobile && sidebar.openMobile) {
      // Replayed from the menu sheet: close it first, the tour starts at its button.
      sidebar.setOpenMobile(false);
      startTimer.current = window.setTimeout(begin, SETTLE_MS);
      return;
    }
    begin();
  }, [begin, sidebar]);

  const decline = useCallback(() => {
    setPhase('idle');
    save('skipped');
  }, [save]);

  const close = useCallback((status: ProductTourStatus, navigateTo?: string) => {
    setPhase('idle');
    save(status);
    if (collapseSidebarAfter.current) {
      collapseSidebarAfter.current = false;
      sidebar.setOpen(false);
    }
    // The menu goes back to where the person left it.
    scrolledAreas.current.forEach((top, area) => { area.scrollTop = top; });
    scrolledAreas.current.clear();
    if (status === 'skipped') {
      toast({ title: 'Recorrido omitido', description: 'Puedes verlo cuando quieras desde «Ver tutorial», al final del menú.' });
    }
    if (navigateTo) onNavigate(navigateTo);
  }, [onNavigate, save, sidebar]);

  const goTo = useCallback((next: number) => {
    const step = steps[next];
    if (!step) return;
    setIndex(next);
    setAnnouncement(`Paso ${next + 1} de ${steps.length}: ${step.title}. ${step.body}`);
  }, [steps]);

  const value = useMemo(() => ({ start, active: phase !== 'idle' }), [phase, start]);

  return (
    <ProductTourContext.Provider value={value}>
      {children}
      <WelcomeDialog
        open={phase === 'welcome'}
        stepCount={productTourSteps(sidebar.isMobile).length}
        onStart={begin}
        onDecline={decline}
      />
      {phase === 'touring' && steps[index] && (
        <TourStep
          steps={steps}
          index={index}
          isMobile={sidebar.isMobile}
          announcement={announcement}
          scrolledAreas={scrolledAreas.current}
          onBack={() => goTo(index - 1)}
          onNext={() => goTo(index + 1)}
          onClose={close}
        />
      )}
    </ProductTourContext.Provider>
  );
}

function WelcomeDialog({ open, stepCount, onStart, onDecline }: {
  open: boolean;
  stepCount: number;
  onStart: () => void;
  onDecline: () => void;
}) {
  const startRef = useRef<HTMLButtonElement>(null);
  const starting = useRef(false);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onDecline(); }}>
      <DialogContent
        className="w-[calc(100%-2rem)] max-w-md gap-6 rounded-2xl p-6 sm:rounded-2xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          startRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          // The tour takes the focus from here.
          if (starting.current) event.preventDefault();
          starting.current = false;
        }}
      >
        <DialogHeader className="items-center gap-3 space-y-0 text-center sm:items-start sm:text-left">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Compass className="size-5" aria-hidden />
          </span>
          <DialogTitle className="text-xl tracking-tight">Te damos la bienvenida a ANTON.IA</DialogTitle>
          <DialogDescription className="leading-relaxed">
            En {stepCount} pasos cortos te mostramos dónde está cada cosa para que empieces a prospectar.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button variant="ghost" onClick={onDecline}>Ahora no</Button>
          <Button
            ref={startRef}
            onClick={() => {
              starting.current = true;
              onStart();
            }}
          >
            Empezar recorrido
          </Button>
        </DialogFooter>
        <p className="-mt-2 text-center text-xs text-muted-foreground sm:text-left">
          Si lo omites, puedes verlo cuando quieras desde «Ver tutorial», al final del menú.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function TourStep({ steps, index, isMobile, announcement, scrolledAreas, onBack, onNext, onClose }: {
  steps: ProductTourStep[];
  index: number;
  isMobile: boolean;
  announcement: string;
  /** Scroll areas moved to reveal an entry, with their position before the tour. */
  scrolledAreas: Map<HTMLElement, number>;
  onBack: () => void;
  onNext: () => void;
  onClose: (status: ProductTourStatus, navigateTo?: string) => void;
}) {
  const step = steps[index];
  const last = index === steps.length - 1;
  const layout = useTargetLayout(step.target, isMobile, scrolledAreas);
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  // «Atrás» disappears on the first step: keep the focus on a button of the card.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!cardRef.current?.contains(active) || active === cardRef.current) primaryRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [index]);

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => { if (!open) onClose(last ? 'completed' : 'skipped'); }}>
      <DialogPrimitive.Portal>
        <Spotlight layout={layout} />
        <DialogPrimitive.Content
          ref={cardRef}
          data-product-tour=""
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            primaryRef.current?.focus();
          }}
          onPointerDownOutside={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight' && !last) {
              event.preventDefault();
              onNext();
            } else if (event.key === 'ArrowLeft' && index > 0) {
              event.preventDefault();
              onBack();
            }
          }}
          className={cn(
            'fixed z-[61] grid gap-4 rounded-2xl border bg-background p-5 text-foreground shadow-2xl outline-none',
            'duration-300 animate-in fade-in-0 motion-reduce:animate-none',
            isMobile
              ? 'mx-auto max-w-md'
              : 'w-[22rem] transition-[top,bottom,left] ease-out motion-reduce:transition-none',
          )}
          style={cardPosition(layout, isMobile)}
        >
          <div className="flex min-h-8 items-center justify-between gap-3">
            <p className="text-xs font-medium tabular-nums text-muted-foreground">
              Paso {index + 1} de {steps.length}
            </p>
            {!last && (
              <Button
                variant="ghost"
                size="sm"
                className="-mr-2 h-8 px-2.5 text-muted-foreground"
                onClick={() => onClose('skipped')}
              >
                Omitir
              </Button>
            )}
          </div>
          <div className="grid gap-1.5">
            <DialogPrimitive.Title className="text-base font-semibold leading-snug tracking-tight">
              {step.title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-sm leading-relaxed text-muted-foreground">
              {step.body}
            </DialogPrimitive.Description>
          </div>
          {step.menuLabel && (
            // Where to find it when the entry itself is not on screen (the folded menu on phones).
            <p className={layout.onTarget ? 'sr-only' : 'w-fit rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground'}>
              En el menú: <span className="font-medium text-foreground">{step.menuLabel}</span>
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            {index > 0 ? <Button variant="ghost" size="sm" onClick={onBack}>Atrás</Button> : <span />}
            <div className="flex items-center gap-2">
              {last && <Button variant="outline" size="sm" onClick={() => onClose('completed')}>Terminar</Button>}
              <Button
                ref={primaryRef}
                size="sm"
                onClick={last ? () => onClose('completed', '/profile') : onNext}
              >
                {last ? 'Ir a mi perfil' : 'Siguiente'}
              </Button>
            </div>
          </div>
          <p className="sr-only" aria-live="polite">{announcement}</p>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Dims the screen around the highlighted entry. Radix portals hand their children a ref. */
const Spotlight = forwardRef<HTMLDivElement, { layout: Layout }>(({ layout }, ref) => {
  const { box, viewportWidth, viewportHeight } = layout;
  if (!box) {
    return <div ref={ref} aria-hidden className="fixed inset-0 z-[60] bg-black/50 duration-300 animate-in fade-in-0 motion-reduce:animate-none" />;
  }
  // Kept a few pixels inside the screen so the outline is never cut at the edge.
  const top = Math.max(SCREEN_INSET, box.top - SPOTLIGHT_PADDING);
  const left = Math.max(SCREEN_INSET, box.left - SPOTLIGHT_PADDING);
  const bottom = Math.min(viewportHeight - SCREEN_INSET, box.top + box.height + SPOTLIGHT_PADDING);
  const right = Math.min(viewportWidth - SCREEN_INSET, box.left + box.width + SPOTLIGHT_PADDING);
  return (
    <div
      ref={ref}
      aria-hidden
      data-tour-spotlight=""
      // The outline is the ring; the shadow is the dim, so neither replaces the other.
      className="pointer-events-none fixed z-[60] rounded-[20px] outline outline-2 outline-primary transition-[top,left,width,height] duration-300 ease-out motion-reduce:transition-none"
      style={{ top, left, width: right - left, height: bottom - top, boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.5)' }}
    />
  );
});
Spotlight.displayName = 'Spotlight';

type Box = { top: number; left: number; width: number; height: number };
type Layout = { box: Box | null; onTarget: boolean; viewportWidth: number; viewportHeight: number };

/** Where the highlighted element is. On phones the entries live in the folded menu, so its button stands in. */
function useTargetLayout(target: string, isMobile: boolean, scrolledAreas: Map<HTMLElement, number>): Layout {
  const [layout, setLayout] = useState<Layout>(() => ({
    box: null, onTarget: false, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
  }));

  useLayoutEffect(() => {
    let frame = 0;
    // Followed on every frame while the step is open: the menu keeps moving after it
    // renders (the workspace switcher loads, the sidebar slides in, the window resizes).
    const track = () => {
      const element = visibleElement(target);
      if (element) revealInScrollArea(element, scrolledAreas);
      const rect = (element || (isMobile ? visibleElement('menu') : null))?.getBoundingClientRect();
      const next: Layout = {
        box: rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null,
        onTarget: Boolean(element),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
      setLayout(current => (sameLayout(current, next) ? current : next));
      frame = window.requestAnimationFrame(track);
    };
    track();
    return () => window.cancelAnimationFrame(frame);
  }, [target, isMobile, scrolledAreas]);

  return layout;
}

function visibleElement(target: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < window.innerWidth) return element;
  }
  return null;
}

/** Scrolls only the menu's own scroll area, so the page underneath stays where it was. */
function revealInScrollArea(element: HTMLElement, scrolledAreas: Map<HTMLElement, number>) {
  const area = scrollArea(element);
  if (!area) return;
  const rect = element.getBoundingClientRect();
  const view = area.getBoundingClientRect();
  const shift = rect.top < view.top ? rect.top - view.top - 8 : rect.bottom > view.bottom ? rect.bottom - view.bottom + 8 : 0;
  if (!shift) return;
  if (!scrolledAreas.has(area)) scrolledAreas.set(area, area.scrollTop);
  area.scrollTop += shift;
}

function scrollArea(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  while (node && node !== document.body) {
    const { overflowY } = window.getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null;
}

function sameLayout(a: Layout, b: Layout) {
  const round = (value: number | undefined) => Math.round(value ?? -1);
  return a.onTarget === b.onTarget
    && a.viewportWidth === b.viewportWidth
    && a.viewportHeight === b.viewportHeight
    && Boolean(a.box) === Boolean(b.box)
    && round(a.box?.top) === round(b.box?.top)
    && round(a.box?.left) === round(b.box?.left)
    && round(a.box?.width) === round(b.box?.width)
    && round(a.box?.height) === round(b.box?.height);
}

function cardPosition(layout: Layout, isMobile: boolean): CSSProperties {
  if (isMobile) return { left: 12, right: 12, bottom: 'max(12px, env(safe-area-inset-bottom))' };
  const { box, viewportWidth, viewportHeight } = layout;
  if (!box) return { inset: 0, margin: 'auto', height: 'fit-content' };
  const left = Math.max(EDGE, Math.min(box.left + box.width + CARD_GAP, viewportWidth - CARD_WIDTH - EDGE));
  // Grows down from entries in the upper half and up from the rest, so it always fits on screen.
  return box.top + box.height / 2 <= viewportHeight / 2
    ? { left, top: Math.max(EDGE, box.top - 8) }
    : { left, bottom: Math.max(EDGE, viewportHeight - box.top - box.height - 8) };
}

const storageKey = (userId: string) => `antonia:tour:${userId}`;

function readStoredRecord(userId: string): ProductTourRecord | null {
  try {
    const raw = getBrowserStorage()?.getItem(storageKey(userId));
    return raw ? productTourRecord({ [PRODUCT_TOUR_METADATA_KEY]: JSON.parse(raw) }) : null;
  } catch {
    return null;
  }
}

function storeRecord(userId: string, record: ProductTourRecord) {
  try {
    getBrowserStorage()?.setItem(storageKey(userId), JSON.stringify(record));
  } catch {
    // Storage full or blocked: the account keeps its own copy.
  }
}