'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

type Log = {
  ts: string; side: 'server'|'client'; name: string; durationMs?: number;
  request: { method: string; url: string; headers?: any; body?: any };
  response?: { status: number; headers?: any; bodySnippet?: string };
  error?: string;
};

export default function DebugPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [auto, setAuto] = useState(true);

  async function load() {
    const r = await fetch('/api/debug/logs', { cache: 'no-store' });
    const j = await r.json();
    setLogs(j.logs || []);
  }
  async function clear() {
    await fetch('/api/debug/logs', { method: 'DELETE' });
    await load();
  }

  useEffect(() => {
    load();
    if (!auto) return;
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, [auto]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-2">
        <Button onClick={load}>Refrescar</Button>
        <Button variant="outline" onClick={() => setAuto(a => !a)}>{auto ? 'Auto: ON' : 'Auto: OFF'}</Button>
        <Button variant="destructive" onClick={clear}>Limpiar</Button>
      </div>
      <div className="text-sm text-muted-foreground">Últimos {logs.length} logs</div>
      <div className="grid gap-3">
        {logs.slice().reverse().map((l, i) => (
          <div key={i} className="border rounded p-3">
            <div className="text-xs mb-2">
              <b>{l.name}</b> · {l.side} · {new Date(l.ts).toLocaleTimeString()} · {l.durationMs ?? '-'}ms · {l.response?.status ?? ''}
              {l.error ? <span className="text-red-600"> · {l.error}</span> : null}
            </div>
            <pre className="text-xs overflow-auto bg-muted/30 p-2 rounded"><code>{JSON.stringify(l.request, null, 2)}</code></pre>
            {l.response && (
              <pre className="text-xs overflow-auto bg-muted/30 p-2 rounded mt-2"><code>{JSON.stringify(l.response, null, 2)}</code></pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
