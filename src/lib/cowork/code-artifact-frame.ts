/**
 * The app's side of a code artifact (Plan 12, 3a): the frame's address, the messages the
 * `antonia` runtime sends from inside it and the ones the app sends in. No Node imports: the
 * frame component uses it in the browser.
 */

/**
 * The /cowork page allows frames only from itself (plus the Microsoft and Google sign-in pages,
 * which their silent sign-in may frame): an artifact that tries to navigate its own frame out of
 * the app is stopped by the browser. next.config.js serves it; a test keeps both equal.
 */
export const COWORK_ARTIFACT_FRAME_SRC = "frame-src 'self' https://login.microsoftonline.com https://accounts.google.com";

export type CoworkArtifactFrameMessage =
  | { type: 'ready'; errors: number }
  | { type: 'error'; message: string; line: number | null };

/** The address to frame: the theme and the origin the runtime may answer to go after the #. */
export function coworkArtifactFrameUrl(viewUrl: string, theme: 'light' | 'dark', origin: string) {
  return `${viewUrl.split('#')[0]}#theme=${theme}&origin=${encodeURIComponent(origin)}`;
}

/** A message from the runtime inside `frame`, or null for anything else (other frames, other shapes). */
export function coworkArtifactFrameMessage(event: { source: unknown; data: unknown }, frame: unknown): CoworkArtifactFrameMessage | null {
  if (!frame || event.source !== frame) return null;
  const data = event.data as { source?: unknown; type?: unknown; detail?: Record<string, unknown> | null } | null;
  if (!data || data.source !== 'antonia-artifact') return null;
  if (data.type === 'ready') return { type: 'ready', errors: typeof data.detail?.errors === 'number' ? data.detail.errors : 0 };
  if (data.type === 'error') {
    const message = typeof data.detail?.message === 'string' ? data.detail.message.slice(0, 500) : 'Error';
    const line = typeof data.detail?.line === 'number' && Number.isInteger(data.detail.line) && data.detail.line > 0 ? data.detail.line : null;
    return { type: 'error', message, line };
  }
  return null;
}

/** What the app sends into the frame when its theme changes. */
export function coworkArtifactThemeMessage(theme: 'light' | 'dark') {
  return { source: 'antonia-host', type: 'theme', mode: theme } as const;
}
