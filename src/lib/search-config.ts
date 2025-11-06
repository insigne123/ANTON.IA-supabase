// Config centralizada para búsqueda de leads (frontend)
export const SEARCH_POLL_INTERVAL_MS =
  Number(process.env.NEXT_PUBLIC_SEARCH_POLL_INTERVAL_MS ?? 4000); // 4s

export const SEARCH_MAX_POLL_MINUTES =
  Number(process.env.NEXT_PUBLIC_SEARCH_MAX_POLL_MINUTES ?? 20); // 20 min

export const PAGE_SIZE_DEFAULT =
  Number(process.env.NEXT_PUBLIC_SEARCH_PAGE_SIZE ?? 50); // 50 por página

export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
