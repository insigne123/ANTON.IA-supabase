export function addMessageTracking(input: { html: string; baseUrl: string; trackingKey?: string | null }) {
  const html = String(input.html || '');
  const key = String(input.trackingKey || '').trim();
  if (!key) return { html, trackedLinks: 0, pixelEnabled: false };
  let trackedLinks = 0;
  const origin = String(input.baseUrl || '').replace(/\/$/, '');
  const tracked = html.replace(/(<a\b[^>]*\bhref\s*=\s*)(["'])(https?:\/\/[^"']+)\2/gi, (whole, prefix: string, quote: string, destination: string) => {
    try {
      const url = new URL(destination);
      if (url.pathname.toLowerCase().includes('unsubscribe') || url.pathname.startsWith('/api/tracking/')) return whole;
      const redirect = `${origin}/api/tracking/click?dispatch=${encodeURIComponent(key)}&amp;url=${encodeURIComponent(url.toString())}`;
      trackedLinks++;
      return `${prefix}${quote}${redirect}${quote}`;
    } catch { return whole; }
  });
  const pixel = `<img src="${origin}/api/tracking/open?dispatch=${encodeURIComponent(key)}" width="1" height="1" alt="" aria-hidden="true" style="display:none!important;width:1px;height:1px;border:0;" />`;
  const withPixel = /<\/body>/i.test(tracked) ? tracked.replace(/<\/body>/i, `${pixel}</body>`) : `${tracked}${pixel}`;
  return { html: withPixel, trackedLinks, pixelEnabled: true };
}
