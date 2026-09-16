'use client';
import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';

export function SaveContact({ runId, providerId, onAccessDenied, onUseContact }: {
  runId: string; providerId: string; onAccessDenied: () => void; onUseContact: (id: string) => void;
}) {
  const [savedId, setSavedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function save() {
    if (controller.current) return;
    const request = new AbortController(); controller.current = request; setBusy(true); setError('');
    try {
      const response = await fetch(`/api/cowork/runs/${runId}/contacts`, { method: 'POST', cache: 'no-store',
        signal: request.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId }) });
      if (response.status === 401 || response.status === 403) { onAccessDenied(); return; }
      const data = await response.json();
      if (!response.ok || !data.lead?.id) throw new Error(data.error || 'No se pudo confirmar el guardado.');
      if (!request.signal.aborted) setSavedId(data.lead.id);
    } catch (error) { if (!request.signal.aborted) setError(error instanceof Error ? error.message : 'No se pudo guardar.'); }
    finally { controller.current = null; if (!request.signal.aborted) setBusy(false); }
  }
  return <div className="sm:col-span-2">
    {savedId ? <Button variant="outline" size="sm" onClick={() => onUseContact(savedId)}>Consultar contacto guardado en el chat</Button>
      : <Button variant="outline" size="sm" disabled={busy} onClick={() => void save()}>{busy ? 'Guardando…' : 'Guardar contacto'}</Button>}
    {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
  </div>;
}
