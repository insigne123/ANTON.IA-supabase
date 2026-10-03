/**
 * A contact's photo only when it is a real photo over https. Services that draw initials from a name (ui-avatars.com)
 * are dropped, so no prospect's name leaves the app to render an avatar; InitialsAvatar draws those here.
 */
export function safeAvatarUrl(url: string | null | undefined): string | undefined {
  const value = String(url || '').trim();
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || host === 'ui-avatars.com' || host.endsWith('.ui-avatars.com')) return undefined;
    return value;
  } catch {
    return undefined;
  }
}
