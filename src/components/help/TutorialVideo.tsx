'use client';

import { useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Play, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { formatVideoLength, tutorialVideoFiles, type TutorialVideo } from '@/lib/help/tutorial-videos';
import { cn } from '@/lib/utils';

/**
 * The video itself: nothing loads until the person asks for it. The music can be muted from the controls, and the
 * subtitles that come burnt into the image are also a captions track for screen readers (off by default, so they are
 * not shown twice).
 */
function VideoPlayer({ video, className }: { video: TutorialVideo; className?: string }) {
  const files = tutorialVideoFiles(video);
  return (
    <video controls autoPlay playsInline preload="metadata" poster={files.poster}
      className={cn('aspect-video w-full rounded-2xl border bg-black', className)} aria-label={`Video: ${video.title}`}>
      <source src={files.mp4} type="video/mp4" />
      <track kind="captions" srcLang="es" label="Español" src={files.captions} />
      Tu navegador no puede mostrar este video. <a href={files.mp4}>Descárgalo</a>.
    </video>
  );
}

function Poster({ video, compact }: { video: TutorialVideo; compact?: boolean }) {
  const files = tutorialVideoFiles(video);
  return (
    <>
      {/* The first frame of the video, decorative: the button says what it opens. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={files.poster} alt="" width={1280} height={720} loading="lazy" decoding="async"
        className="aspect-video w-full rounded-2xl border bg-muted object-cover" />
      <span aria-hidden className="absolute inset-0 flex items-center justify-center rounded-2xl bg-foreground/5 transition-colors group-hover:bg-foreground/15">
        <span className={cn('flex items-center gap-2 rounded-full bg-background/95 font-medium text-foreground shadow-md',
          compact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm')}>
          <Play className={cn('fill-current text-primary', compact ? 'size-3.5' : 'size-4')} />
          Ver video · {formatVideoLength(video.seconds)}
        </span>
      </span>
    </>
  );
}

/** A video in place: its poster with «Ver video», and the player in the same spot once pressed. */
export function TutorialVideoInline({ video, compact, className }: { video: TutorialVideo; compact?: boolean; className?: string }) {
  const [playing, setPlaying] = useState(false);
  if (playing) return <VideoPlayer video={video} className={className} />;
  return (
    <button type="button" onClick={() => setPlaying(true)}
      className={cn('group relative block w-full rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2', className)}
      aria-label={`Ver video: ${video.title} (${formatVideoLength(video.seconds)})`}>
      <Poster video={video} compact={compact} />
    </button>
  );
}

/** A card of the video gallery: poster, title and length; it opens the video large, in a dialog. */
export function TutorialVideoCard({ video }: { video: TutorialVideo }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button"
          className="group flex h-full w-full flex-col gap-2.5 rounded-2xl border bg-card p-2.5 text-left transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Ver video: ${video.title} (${formatVideoLength(video.seconds)})`}>
          <span className="relative block"><Poster video={video} compact /></span>
          <span className="px-1 pb-1">
            <span className="block text-sm font-semibold">{video.title}</span>
            <span className="line-clamp-2 text-xs text-muted-foreground">{video.summary}</span>
          </span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl gap-3 p-4 sm:p-5">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle>{video.title}</DialogTitle>
          <DialogDescription>{video.summary}</DialogDescription>
        </DialogHeader>
        <VideoPlayer video={video} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * «Ver video» from a step of the app tour: the video opens above the tour (its spotlight and card sit on z-60 and z-61),
 * and closing it returns to the same step.
 */
export function TutorialVideoButton({ video }: { video: TutorialVideo }) {
  return (
    <DialogPrimitive.Root>
      <DialogPrimitive.Trigger asChild>
        <Button variant="outline" size="sm" className="w-fit gap-1.5">
          <Play className="size-3.5 fill-current text-primary" aria-hidden />
          Ver video · {formatVideoLength(video.seconds)}
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-black/80 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-[71] grid w-[calc(100%-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 gap-3 rounded-2xl border bg-background p-4 shadow-2xl sm:p-5">
          <div className="pr-8">
            <DialogPrimitive.Title className="text-lg font-semibold tracking-tight">{video.title}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-sm text-muted-foreground">{video.summary}</DialogPrimitive.Description>
          </div>
          <VideoPlayer video={video} />
          <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring">
            <X className="size-4" aria-hidden />
            <span className="sr-only">Cerrar video</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
