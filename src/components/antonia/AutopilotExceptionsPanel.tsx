'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCheck, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type ExceptionRow = {
  id: string;
  mission_id?: string | null;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'approved' | 'resolved' | 'dismissed';
  title: string;
  description?: string | null;
  payload?: any;
  created_at: string;
  resolution_note?: string | null;
};

function severityVariant(severity: ExceptionRow['severity']): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (severity === 'critical') return 'destructive';
  if (severity === 'high') return 'secondary';
  return 'outline';
}

function categoryLabel(value: string) {
  switch (value) {
    case 'approval_required':
      return 'Aprobacion';
    case 'positive_reply':
      return 'Lead caliente';
    case 'manual_action_required':
      return 'Revision reply';
    case 'reply_guardrail':
      return 'Lead ya respondio';
    case 'send_failed':
      return 'Fallo de envio';
    case 'compliance_block':
      return 'Bloqueo';
    case 'missing_email':
      return 'Sin email';
    case 'low_score_skip':
      return 'Score bajo';
    default:
      return value;
  }
}

export function AutopilotExceptionsPanel() {
  const [items, setItems] = useState<ExceptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'open' | 'resolved' | 'dismissed' | 'approved'>('open');
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchItems = useCallback(async (status = filter) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/antonia/exceptions?status=${encodeURIComponent(status)}&limit=100`, { cache: 'no-store' });
      if (!res.ok) throw new Error('No se pudo cargar la cola de excepciones');
      const data = await res.json();
      setItems((data.items || []) as ExceptionRow[]);
    } catch (error) {
      console.error('[AutopilotExceptionsPanel] fetch error:', error);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchItems(filter);
  }, [fetchItems, filter]);

  const counts = useMemo(() => ({
    approvals: items.filter((item) => item.category === 'approval_required').length,
    hot: items.filter((item) => item.category === 'positive_reply').length,
    manual: items.filter((item) => item.category === 'manual_action_required').length,
    critical: items.filter((item) => item.severity === 'critical').length,
  }), [items]);

  const mutateException = async (id: string, action: 'approve_contact' | 'resolve' | 'dismiss') => {
    setBusyId(id);
    try {
      const res = await fetch('/api/antonia/exceptions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudo actualizar la excepcion');
      }

      await fetchItems(filter);
    } catch (error) {
      console.error('[AutopilotExceptionsPanel] mutate error:', error);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4 text-primary" />
              Exception Queue
            </CardTitle>
            <CardDescription>
              Todo lo que impide dejar ANTONIA corriendo sin supervision permanente.
            </CardDescription>
          </div>
          <Button variant="outline" size="icon" onClick={() => fetchItems(filter)}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          {(['open', 'approved', 'resolved', 'dismissed'] as const).map((status) => (
            <Button
              key={status}
              size="sm"
              variant={filter === status ? 'default' : 'outline'}
              onClick={() => setFilter(status)}
            >
              {status}
            </Button>
          ))}
        </div>

        {filter === 'open' && (
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border p-4">
              <p className="text-sm text-muted-foreground">Aprobaciones</p>
              <p className="text-2xl font-semibold">{counts.approvals}</p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-sm text-muted-foreground">Leads calientes</p>
              <p className="text-2xl font-semibold">{counts.hot}</p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-sm text-muted-foreground">Revision reply</p>
              <p className="text-2xl font-semibold">{counts.manual}</p>
            </div>
            <div className="rounded-xl border p-4">
              <p className="text-sm text-muted-foreground">Criticas</p>
              <p className="text-2xl font-semibold">{counts.critical}</p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            No hay excepciones en este estado.
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => {
              const lead = item.payload?.lead || {};
              const canApprove = item.status === 'open' && item.category === 'approval_required';
              return (
                <div key={item.id} className="rounded-xl border p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={severityVariant(item.severity)}>{item.severity}</Badge>
                        <Badge variant="outline">{categoryLabel(item.category)}</Badge>
                        {lead?.scoreTier && <Badge variant="secondary">{String(lead.scoreTier).toUpperCase()} {lead?.score ?? '-'}</Badge>}
                      </div>
                      <div>
                        <p className="font-medium">{item.title}</p>
                        <p className="text-sm text-muted-foreground">{item.description || 'Sin descripcion adicional.'}</p>
                      </div>
                      {(lead?.fullName || lead?.name || lead?.companyName || lead?.company) && (
                        <p className="text-xs text-muted-foreground">
                          {lead?.fullName || lead?.name || 'Lead'}
                          {(lead?.companyName || lead?.company) ? ` · ${lead.companyName || lead.company}` : ''}
                          {lead?.email ? ` · ${lead.email}` : ''}
                        </p>
                      )}
                      {item.payload?.suggestedReply && (
                        <div className="rounded-lg bg-secondary/40 p-3 text-xs whitespace-pre-wrap text-muted-foreground">
                          {item.payload.suggestedReply}
                        </div>
                      )}
                      {item.resolution_note && (
                        <p className="text-xs text-muted-foreground">Resolucion: {item.resolution_note}</p>
                      )}
                    </div>

                    {item.status === 'open' && (
                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        {canApprove && (
                          <Button size="sm" onClick={() => mutateException(item.id, 'approve_contact')} disabled={busyId === item.id}>
                            {busyId === item.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCheck className="mr-2 h-4 w-4" />}
                            Aprobar contacto
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => mutateException(item.id, 'resolve')} disabled={busyId === item.id}>
                          Resolver
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => mutateException(item.id, 'dismiss')} disabled={busyId === item.id}>
                          <AlertTriangle className="mr-2 h-4 w-4" /> Descartar
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
