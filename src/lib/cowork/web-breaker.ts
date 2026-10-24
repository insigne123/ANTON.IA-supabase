// When Anthropic refuses the web tools (the organization has not turned web search on, a tool version the model does not take), every turn that
// offers them fails the same way and the person sees an error for something that is nobody's doing. The first turn that meets the refusal goes on
// with the coordinator loop, and for a while this process offers no web: the turns after it run on the harness as always, only without the web.
const PAUSE_MS = 10 * 60_000;
let pausedUntil = 0;

export const coworkWebPaused = (now = Date.now()) => now < pausedUntil;

export function pauseCoworkWeb(now = Date.now(), ms = PAUSE_MS) {
  pausedUntil = now + ms;
}

export function resumeCoworkWeb() {
  pausedUntil = 0;
}
