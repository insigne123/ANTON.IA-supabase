'use client';

import { useCallback, useEffect, useState } from 'react';

import type { ContactabilityResult } from '@/lib/commercial-intelligence';

export function useContactability(email?: string | null) {
  const [result, setResult] = useState<ContactabilityResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedEmail = String(email || '').trim().toLowerCase();

  const refresh = useCallback(async () => {
    if (!normalizedEmail) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/privacy/contactability?email=${encodeURIComponent(normalizedEmail)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('No se pudo verificar si el contacto esta habilitado.');
      const data = await res.json();
      setResult(data as ContactabilityResult);
    } catch (err) {
      console.error('[useContactability] fetch error:', err);
      setResult(null);
      setError('No pudimos verificar el estado de contacto ahora. Puedes intentarlo de nuevo en unos segundos.');
    } finally {
      setLoading(false);
    }
  }, [normalizedEmail]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { result, loading, error, refresh };
}
