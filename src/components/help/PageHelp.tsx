'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, CircleHelp, Compass, PlayCircle } from 'lucide-react';

import { AskHelp } from '@/components/help/AskHelp';
import { HelpSectionContent } from '@/components/help/HelpSectionContent';
import { TutorialVideoInline } from '@/components/help/TutorialVideo';
import { useProductTour } from '@/components/onboarding/ProductTour';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { helpSectionFor, helpSectionHref, visibleHelpSections, type HelpVisibility } from '@/lib/help/manual';
import { videoForPath, visibleTutorialVideos } from '@/lib/help/tutorial-videos';
import { cn } from '@/lib/utils';

/** The help panel closes before a guide or the tour opens, so their focus is not trapped inside it. */
const PANEL_CLOSE_MS = 260;

/**
 * «?» in the top bar: the help of the screen on view. What it is for, its guide, how to use it, FAQs, «Pregúntale a la IA»
 * and the way to the full manual. Nothing on screens without help.
 */
export function PageHelpButton({ visibility, className }: { visibility: HelpVisibility; className?: string }) {
  const pathname = usePathname();
  const { guide, startGuide, start } = useProductTour();
  const [open, setOpen] = useState(false);
  const sections = useMemo(
    () => visibleHelpSections({ opportunities: visibility.opportunities, admin: visibility.admin }),
    [visibility.opportunities, visibility.admin],
  );
  const visibleIds = useMemo(() => new Set(sections.map((section) => section.id)), [sections]);
  const section = useMemo(() => helpSectionFor(pathname, sections), [pathname, sections]);
  const video = useMemo(
    () => videoForPath(pathname, sections, visibleTutorialVideos({ opportunities: visibility.opportunities })),
    [pathname, sections, visibility.opportunities],
  );

  useEffect(() => { setOpen(false); }, [pathname]);

  if (!section && !guide && !video) return null;
  const title = section?.title || guide?.title || video?.title || 'Ayuda';
  const afterClosing = (action: () => void) => {
    setOpen(false);
    window.setTimeout(action, PANEL_CLOSE_MS);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className={cn('h-8 gap-1.5 px-2 text-muted-foreground', className)}
          aria-label={`Ayuda sobre ${title}`} data-tour="page-help">
          <CircleHelp className="size-4" aria-hidden />
          <span className="hidden sm:inline">Ayuda</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
        <SheetHeader className="space-y-1.5 border-b px-5 py-4 pr-12 text-left">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Ayuda</p>
          <SheetTitle className="text-lg tracking-tight">{title}</SheetTitle>
          <SheetDescription className="leading-relaxed">
            {section?.summary || 'Te mostramos cómo usar esta pantalla.'}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-5 py-5">
          {guide && (
            <Button variant="outline" className="h-auto w-full justify-start gap-3 rounded-xl px-3 py-3 text-left"
              onClick={() => afterClosing(() => startGuide(guide.id))}>
              <Compass className="size-4 text-primary" aria-hidden />
              <span className="flex flex-col">
                <span className="font-medium">Ver guía de esta pantalla</span>
                <span className="text-xs font-normal text-muted-foreground">
                  Señala {guide.steps.length === 1 ? 'el control principal' : `los ${guide.steps.length} controles principales`} sobre la pantalla.
                </span>
              </span>
            </Button>
          )}

          {video && (
            <section aria-labelledby="page-help-video-title" className="space-y-2">
              <h3 id="page-help-video-title" className="text-sm font-semibold">En video</h3>
              <TutorialVideoInline video={video} compact />
            </section>
          )}

          {section && <HelpSectionContent section={section} visibleIds={visibleIds} onNavigate={() => setOpen(false)} />}

          <AskHelp sectionId={section?.id} onNavigate={() => setOpen(false)} className="rounded-2xl border p-4" />

          <div className="grid gap-1 border-t pt-4">
            <Button asChild variant="ghost" className="justify-start gap-2 px-2">
              <Link href={section ? helpSectionHref(section.id) : '/ayuda'} onClick={() => setOpen(false)}>
                <BookOpen className="size-4" aria-hidden />
                Abrir el Centro de ayuda
              </Link>
            </Button>
            <Button variant="ghost" className="justify-start gap-2 px-2" onClick={() => afterClosing(start)}>
              <PlayCircle className="size-4" aria-hidden />
              Ver el recorrido por toda la app
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
