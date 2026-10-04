'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { getBrowserStorage } from '@/lib/browser-storage';
import { COWORK_OWNER_EMAIL } from '@/lib/cowork/access';

export type NavAccess = { cowork: boolean; opportunities: boolean };

const NO_ACCESS: NavAccess = { cowork: false, opportunities: false };
const STORAGE_PREFIX = 'anton.nav-access.v1:';

export function readCachedNavAccess(scope: string, storage: Storage | null = getBrowserStorage()): NavAccess {
  if (!scope || !storage) return NO_ACCESS;
  try {
    const saved = JSON.parse(storage.getItem(`${STORAGE_PREFIX}${scope}`) || 'null');
    return { cowork: saved?.cowork === true, opportunities: saved?.opportunities === true };
  } catch {
    return NO_ACCESS;
  }
}

export function writeCachedNavAccess(scope: string, access: NavAccess, storage: Storage | null = getBrowserStorage()) {
  if (!scope || !storage) return;
  try {
    storage.setItem(`${STORAGE_PREFIX}${scope}`, JSON.stringify(access));
  } catch {
    // Storage full or blocked: the menu waits for the server, as before.
  }
}

/** A clear «no» from the server; a 5xx or a dropped connection keeps what was known. */
const isRefusal = (status: number) => status === 401 || status === 403 || status === 404;

/**
 * Which menu entries behind a server check this person sees (Cowork, Oportunidades). The menu opens with the last answer
 * kept for this person and organization, so it does not grow under the cursor, and follows the server once it replies.
 * The server checks access again on every page and API; this only decides what the menu shows.
 */
export function useNavAccess({ userId, email, organizationId }: {
  userId?: string | null;
  email?: string | null;
  organizationId?: string | null;
}): NavAccess {
  const scope = userId ? `${userId}:${organizationId || ''}` : '';
  // Read while rendering: the user is unknown on the server and on the first render, so this never differs at hydration.
  const cached = useMemo(() => readCachedNavAccess(scope), [scope]);
  const [answers, setAnswers] = useState<{ scope: string; access: Partial<NavAccess> }>({ scope: '', access: {} });
  const isCoworkOwner = email?.trim().toLowerCase() === COWORK_OWNER_EMAIL;

  useEffect(() => {
    if (!scope) return;
    const controller = new AbortController();
    const known: Partial<NavAccess> = isCoworkOwner ? {} : { cowork: false };
    const answer = (key: keyof NavAccess, value: boolean) => {
      if (controller.signal.aborted) return;
      known[key] = value;
      writeCachedNavAccess(scope, { ...readCachedNavAccess(scope), ...known });
      setAnswers({ scope, access: { ...known } });
    };
    const ask = (url: string, key: keyof NavAccess, granted: (response: Response) => Promise<boolean>) => {
      fetch(url, { cache: 'no-store', signal: controller.signal })
        .then(async (response) => {
          if (response.ok) answer(key, await granted(response));
          else if (isRefusal(response.status)) answer(key, false);
        })
        .catch(() => {});
    };

    if (isCoworkOwner) ask('/api/cowork/access', 'cowork', async () => true);
    // «Oportunidades» is for the accounts in OPPORTUNITIES_ALLOWED_EMAILS: the server answers, the menu only follows it.
    ask('/api/commercial-opportunities/access', 'opportunities', async (response) => {
      const data = await response.json().catch(() => null);
      return data?.available === true;
    });
    return () => controller.abort();
  }, [scope, isCoworkOwner]);

  if (!scope) return NO_ACCESS;
  const answered = answers.scope === scope ? answers.access : {};
  return {
    cowork: isCoworkOwner && (answered.cowork ?? cached.cowork),
    opportunities: answered.opportunities ?? cached.opportunities,
  };
}

const NavAccessContext = createContext<NavAccess>(NO_ACCESS);

/** The app shell shares its answer, so a page that shows the same parts of the app as the menu (the help) asks nothing. */
export const NavAccessProvider = NavAccessContext.Provider;

export function useSharedNavAccess(): NavAccess {
  return useContext(NavAccessContext);
}
