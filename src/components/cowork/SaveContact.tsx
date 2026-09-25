'use client';
import { useState, useRef, useEffect } from 'react';
import { Check, UserPlus } from 'lucide-react';
import { CwButton } from './ui';

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
  return <div className="flex flex-wrap items-center gap-2">
    {savedId
      ? <>
        <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-cw-success"><Check className="h-3.5 w-3.5" aria-hidden="true" />Guardado</span>
        <CwButton size="xs" variant="ghost" onClick={() => onUseContact(savedId)}>Consultar contacto guardado en el chat</CwButton>
      </>
      : <CwButton size="xs" variant="secondary" disabled={busy} onClick={() => void save()}><UserPlus aria-hidden="true" />{busy ? 'Guardando…' : 'Guardar contacto'}</CwButton>}
    {error && <p role="alert" className="w-full text-[12px] text-cw-danger">{error}</p>}
  </div>;
}
