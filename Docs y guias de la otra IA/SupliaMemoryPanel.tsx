'use client';
/* =====================================================================
   SupliaMemoryPanel.tsx  —  Fase 2: memoria controlable por el usuario
   Lista las memorias de SUPL.IA y permite aprobar / olvidar sin un turno de chat.
   Va en: src/components/suplia/SupliaMemoryPanel.tsx
   Necesita la ruta: src/app/api/suplia/memory/route.ts (ver FASE-2-SUPLIA-GLM.md)
   Solo Tailwind, sin dependencias extra.
   ===================================================================== */
import { useCallback, useEffect, useState } from 'react';

type SupliaMemory = {
  id: string;
  memory_type: string;
  key: string;
  value: unknown;
  status: 'proposed' | 'approved' | 'archived' | string;
  confidence: number;
  updated_at: string;
};

const FILTERS: Array<{ value: 'approved' | 'proposed' | 'archived'; label: string }> = [
  { value: 'approved', label: 'Activas' },
  { value: 'proposed', label: 'Propuestas' },
  { value: 'archived', label: 'Olvidadas' },
];

function memoryText(value: unknown): string {
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    return String(v.text ?? JSON.stringify(v));
  }
  return String(value ?? '');
}

export function SupliaMemoryPanel() {
  const [items, setItems] = useState<SupliaMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'approved' | 'proposed' | 'archived'>('approved');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/suplia/memory?status=${filter}`);
      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function act(memoryId: string, action: 'approve' | 'forget') {
    setBusyId(memoryId);
    try {
      await fetch('/api/suplia/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, memoryId }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">Memoria de SUPL.IA</h3>
        <div className="ml-auto flex gap-1 text-xs">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-2 py-1 rounded-md transition ${filter === f.value ? 'bg-neutral-200 text-neutral-900' : 'text-neutral-500 hover:text-neutral-800'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-neutral-500">
        SUPL.IA recuerda criterios para decidir mejor. Tú controlas qué recuerda: aprueba lo útil y olvida lo que no.
      </p>

      {loading ? (
        <p className="text-xs text-neutral-500">Cargando memorias…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-neutral-500">Sin memorias en esta vista.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((m) => (
            <li key={m.id} className="border border-neutral-200 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600">{m.memory_type}</span>
                <span className="text-sm font-medium text-neutral-900">{m.key}</span>
                <span className="ml-auto text-[11px] text-neutral-400">{Math.round((m.confidence || 0) * 100)}%</span>
              </div>
              <p className="text-sm text-neutral-600 mt-1">{memoryText(m.value)}</p>
              <div className="flex gap-3 mt-2">
                {m.status !== 'approved' && (
                  <button disabled={busyId === m.id} onClick={() => act(m.id, 'approve')} className="text-xs font-medium text-emerald-600 disabled:opacity-50">
                    Aprobar
                  </button>
                )}
                {m.status !== 'archived' && (
                  <button disabled={busyId === m.id} onClick={() => act(m.id, 'forget')} className="text-xs font-medium text-red-500 disabled:opacity-50">
                    Olvidar
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
