'use client';

import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type PrivacyRequestRow = {
  id: string;
  request_type: string;
  status: string;
  requester_name: string | null;
  requester_email: string;
  requester_company: string | null;
  relation_to_data: string | null;
  target_email: string | null;
  details: string;
  submitted_at: string;
  resolved_at: string | null;
  reviewed_by_email: string | null;
  last_action_type?: string | null;
  last_action_at?: string | null;
  last_action_summary?: Record<string, unknown> | null;
  metadata?: {
    userAgent?: string | null;
    ipAddress?: string | null;
    referer?: string | null;
  } | null;
};

type SubjectLookupResponse = {
  email: string;
  summary: {
    profiles: number;
    leads: number;
    enrichedLeads: number;
    contactedLeads: number;
    unsubscribedEntries: number;
    researchReports: number;
    emailEvents?: number;
    leadResponses?: number;
  };
  records: {
    profiles: Array<{ id: string; email: string; full_name: string | null; updated_at: string | null }>;
    leads: Array<{ id: string; name: string | null; title: string | null; company: string | null; email: string; status: string | null; created_at: string | null }>;
    enrichedLeads: Array<{ id: string; full_name: string | null; title: string | null; company_name: string | null; email: string; created_at: string | null; updated_at: string | null }>;
    contactedLeads: Array<{ id: string; name: string | null; role: string | null; company: string | null; email: string; status: string | null; sent_at: string | null; replied_at: string | null }>;
    unsubscribedEntries: Array<{ id: string; email: string; reason: string | null; created_at: string | null }>;
    researchReports: Array<{ id: string; email: string | null; company_name: string | null; company_domain: string | null; generated_at: string | null; updated_at: string | null }>;
    emailEvents?: Array<{ id: string; contacted_id: string | null; event_type: string; provider: string | null; event_at: string; meta: any }>;
    leadResponses?: Array<{ id: string; lead_id: string | null; contacted_id?: string | null; type: string; content: string | null; created_at: string }>;
  };
  warnings?: string[];
};

const statusOptions = [
  { value: 'all', label: 'Todas' },
  { value: 'submitted', label: 'Ingresadas' },
  { value: 'in_review', label: 'En revision' },
  { value: 'resolved', label: 'Resueltas' },
  { value: 'rejected', label: 'Rechazadas' },
] as const;

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'resolved':
      return 'default';
    case 'in_review':
      return 'secondary';
    case 'rejected':
      return 'destructive';
    default:
      return 'outline';
  }
}

function requestTypeLabel(value: string) {
  switch (value) {
    case 'access':
      return 'Acceso';
    case 'rectification':
      return 'Rectificacion';
    case 'deletion':
      return 'Supresion';
    case 'opposition':
      return 'Oposicion';
    case 'portability':
      return 'Portabilidad';
    case 'blocking':
      return 'Bloqueo';
    default:
      return 'Otra';
  }
}

export default function PrivacyRequestsSettingsPage() {
  const [status, setStatus] = useState<(typeof statusOptions)[number]['value']>('all');
  const [requests, setRequests] = useState<PrivacyRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [lookupEmail, setLookupEmail] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [lookupResult, setLookupResult] = useState<SubjectLookupResponse | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState('');

  async function loadRequests(nextStatus = status) {
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams();
      if (nextStatus !== 'all') params.set('status', nextStatus);
      params.set('limit', '100');

      const response = await fetch(`/api/privacy/requests?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error || 'No se pudieron obtener las solicitudes.');
      }

      setRequests(Array.isArray(data?.requests) ? data.requests : []);
    } catch (fetchError: any) {
      setRequests([]);
      setError(fetchError?.message || 'No se pudieron obtener las solicitudes.');
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(id: string, nextStatus: 'submitted' | 'in_review' | 'resolved' | 'rejected') {
    setUpdatingId(id);
    setError('');

    try {
      const response = await fetch('/api/privacy/requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: nextStatus }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error || 'No se pudo actualizar la solicitud.');
      }

      setRequests((current) => current.map((request) => {
        if (request.id !== id) return request;
        return {
          ...request,
          status: data?.request?.status || nextStatus,
          resolved_at: data?.request?.resolved_at || (nextStatus === 'resolved' ? new Date().toISOString() : request.resolved_at),
          reviewed_by_email: data?.request?.reviewed_by_email || request.reviewed_by_email,
        };
      }));
    } catch (updateError: any) {
      setError(updateError?.message || 'No se pudo actualizar la solicitud.');
    } finally {
      setUpdatingId(null);
    }
  }

  async function runLookup(email: string) {
    const normalized = String(email || '').trim().toLowerCase();
    setLookupEmail(normalized);
    setLookupLoading(true);
    setLookupError('');

    try {
      const response = await fetch(`/api/privacy/subject-lookup?email=${encodeURIComponent(normalized)}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'No se pudo consultar la informacion del titular.');
      }

      setLookupResult(data as SubjectLookupResponse);
    } catch (lookupFetchError: any) {
      setLookupResult(null);
      setLookupError(lookupFetchError?.message || 'No se pudo consultar la informacion del titular.');
    } finally {
      setLookupLoading(false);
    }
  }

  async function runSubjectAction(request: PrivacyRequestRow, action: 'export' | 'block' | 'delete' | 'suspend_account') {
    const targetEmail = String(request.target_email || request.requester_email || '').trim().toLowerCase();
    if (!targetEmail) return;

      if (action === 'delete') {
        const confirmed = window.confirm(`Esto eliminara datos comerciales asociados a ${targetEmail} y mantendra una supresion minima para no volver a contactarlo. ¿Continuar?`);
        if (!confirmed) return;
      } else if (action === 'suspend_account') {
        const confirmed = window.confirm(`Esto bloqueara el acceso al SaaS para ${targetEmail}. ¿Continuar?`);
        if (!confirmed) return;
      }

    setActionLoadingId(request.id);
    setActionNotice('');
    setError('');

    try {
      const response = await fetch('/api/privacy/subject-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, email: targetEmail, requestId: request.id }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error || 'No se pudo ejecutar la accion.');
      }

      if (action === 'export') {
        const exportPayload = data?.data || {};
        const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `privacy-export-${targetEmail.replace(/[^a-z0-9@._-]+/gi, '_')}.json`;
        link.click();
        window.URL.revokeObjectURL(url);
        setActionNotice(`Se exportaron los datos encontrados para ${targetEmail}.`);
      } else if (action === 'block') {
        setActionNotice(`Se bloqueó el contacto para ${targetEmail} en el servicio.`);
      } else if (action === 'suspend_account') {
        const warnings = Array.isArray(data?.result?.warnings) ? data.result.warnings : [];
        const warningText = warnings.length > 0 ? ` Aviso: ${warnings[0]}` : '';
        setActionNotice(`Se suspendió el acceso al SaaS para ${targetEmail}.${warningText}`);
      } else {
        const warnings = Array.isArray(data?.result?.warnings) ? data.result.warnings : [];
        const warningText = warnings.length > 0 ? ` Aviso: ${warnings[0]}` : '';
        setActionNotice(`Se eliminaron los datos comerciales para ${targetEmail} y se mantuvo una supresion minima.${warningText}`);
      }

      await loadRequests(status);
      if (lookupEmail === targetEmail || lookupResult?.email === targetEmail) {
        await runLookup(targetEmail);
      }
    } catch (actionError: any) {
      setError(actionError?.message || 'No se pudo ejecutar la accion.');
    } finally {
      setActionLoadingId(null);
    }
  }

  useEffect(() => {
    loadRequests(status);
  }, [status]);

  const summary = useMemo(() => {
    return requests.reduce(
      (acc, request) => {
        acc.total += 1;
        if (request.status === 'submitted') acc.submitted += 1;
        if (request.status === 'in_review') acc.inReview += 1;
        if (request.status === 'resolved') acc.resolved += 1;
        return acc;
      },
      { total: 0, submitted: 0, inReview: 0, resolved: 0 }
    );
  }, [requests]);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Solicitudes de privacidad</h1>
          <p className="text-sm text-muted-foreground">
            Revisa las solicitudes registradas desde el formulario publico de derechos sobre datos personales.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={status} onValueChange={(value) => setStatus(value as (typeof statusOptions)[number]['value'])}>
            <SelectTrigger className="w-[190px]">
              <SelectValue placeholder="Filtrar por estado" />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => loadRequests(status)} disabled={loading}>
            {loading ? 'Actualizando...' : 'Actualizar'}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total</CardDescription>
            <CardTitle className="text-2xl">{summary.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Ingresadas</CardDescription>
            <CardTitle className="text-2xl">{summary.submitted}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>En revision</CardDescription>
            <CardTitle className="text-2xl">{summary.inReview}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Resueltas</CardDescription>
            <CardTitle className="text-2xl">{summary.resolved}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bandeja</CardTitle>
          <CardDescription>
            Vista operativa basica. Esta pantalla no resuelve la solicitud por si sola; sirve para revisar ingreso, contexto y seguimiento interno.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {actionNotice ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {actionNotice}
            </div>
          ) : null}

          {!loading && requests.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              No hay solicitudes para el filtro actual.
            </div>
          ) : null}

          {requests.map((request) => (
            <div key={request.id} className="rounded-xl border p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={statusBadgeVariant(request.status)}>{request.status}</Badge>
                    <Badge variant="outline">{requestTypeLabel(request.request_type)}</Badge>
                  </div>
                  <div className="text-sm font-medium">
                    {request.requester_name || 'Sin nombre'} · {request.requester_email}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {request.requester_company || 'Sin empresa'}
                    {request.target_email ? ` · dato consultado: ${request.target_email}` : ''}
                    {request.relation_to_data ? ` · relacion: ${request.relation_to_data}` : ''}
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <div>{format(new Date(request.submitted_at), 'dd/MM/yyyy HH:mm')}</div>
                  <div className="font-mono">{request.id}</div>
                </div>
              </div>

              <div className="mt-3 rounded-lg bg-muted/40 p-3 text-sm whitespace-pre-wrap">
                {request.details}
              </div>

              {(request.metadata?.ipAddress || request.metadata?.referer) ? (
                <div className="mt-3 text-xs text-muted-foreground">
                  {request.metadata?.ipAddress ? `IP: ${request.metadata.ipAddress}` : null}
                  {request.metadata?.ipAddress && request.metadata?.referer ? ' · ' : null}
                  {request.metadata?.referer ? `Referer: ${request.metadata.referer}` : null}
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground">
                  <div>{request.reviewed_by_email ? `Ultima revision por: ${request.reviewed_by_email}` : 'Sin revision interna registrada'}</div>
                  {request.last_action_type ? (
                    <div>
                      Ultima accion: {request.last_action_type}
                      {request.last_action_at ? ` · ${format(new Date(request.last_action_at), 'dd/MM/yyyy HH:mm')}` : ''}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={actionLoadingId === request.id}
                    onClick={() => runSubjectAction(request, 'export')}
                  >
                    {actionLoadingId === request.id ? 'Procesando...' : 'Exportar JSON'}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={lookupLoading || actionLoadingId === request.id}
                    onClick={() => runLookup(request.target_email || request.requester_email)}
                  >
                    Buscar email
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={actionLoadingId === request.id}
                    onClick={() => runSubjectAction(request, 'block')}
                  >
                    Bloquear contacto
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={actionLoadingId === request.id}
                    onClick={() => runSubjectAction(request, 'suspend_account')}
                  >
                    Suspender acceso SaaS
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={actionLoadingId === request.id}
                    onClick={() => runSubjectAction(request, 'delete')}
                  >
                    Eliminar datos
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={updatingId === request.id || actionLoadingId === request.id || request.status === 'submitted'}
                    onClick={() => updateStatus(request.id, 'submitted')}
                  >
                    Marcar ingresada
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={updatingId === request.id || actionLoadingId === request.id || request.status === 'in_review'}
                    onClick={() => updateStatus(request.id, 'in_review')}
                  >
                    En revision
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={updatingId === request.id || actionLoadingId === request.id || request.status === 'resolved'}
                    onClick={() => updateStatus(request.id, 'resolved')}
                  >
                    Resolver
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={updatingId === request.id || actionLoadingId === request.id || request.status === 'rejected'}
                    onClick={() => updateStatus(request.id, 'rejected')}
                  >
                    Rechazar
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Busqueda por email</CardTitle>
          <CardDescription>
            Usa esta herramienta para revisar rapidamente que registros existen para un correo antes de responder una solicitud de acceso, supresion u oposicion.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row">
            <Input
              type="email"
              placeholder="persona@empresa.com"
              value={lookupEmail}
              onChange={(event) => setLookupEmail(event.target.value)}
            />
            <Button onClick={() => runLookup(lookupEmail)} disabled={lookupLoading}>
              {lookupLoading ? 'Buscando...' : 'Buscar'}
            </Button>
          </div>

          {lookupError ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {lookupError}
            </div>
          ) : null}

          {lookupResult?.warnings?.length ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {lookupResult.warnings.map((warning) => (
                <div key={warning}>{warning}</div>
              ))}
            </div>
          ) : null}

          {lookupResult ? (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
                <Card><CardHeader className="pb-2"><CardDescription>Perfiles</CardDescription><CardTitle className="text-xl">{lookupResult.summary.profiles}</CardTitle></CardHeader></Card>
                <Card><CardHeader className="pb-2"><CardDescription>Leads</CardDescription><CardTitle className="text-xl">{lookupResult.summary.leads}</CardTitle></CardHeader></Card>
                <Card><CardHeader className="pb-2"><CardDescription>Enriquecidos</CardDescription><CardTitle className="text-xl">{lookupResult.summary.enrichedLeads}</CardTitle></CardHeader></Card>
                <Card><CardHeader className="pb-2"><CardDescription>Contactados</CardDescription><CardTitle className="text-xl">{lookupResult.summary.contactedLeads}</CardTitle></CardHeader></Card>
                <Card><CardHeader className="pb-2"><CardDescription>Bajas</CardDescription><CardTitle className="text-xl">{lookupResult.summary.unsubscribedEntries}</CardTitle></CardHeader></Card>
                <Card><CardHeader className="pb-2"><CardDescription>Reportes</CardDescription><CardTitle className="text-xl">{lookupResult.summary.researchReports}</CardTitle></CardHeader></Card>
              </div>

              <div className="space-y-3 text-sm">
                <div>
                  <div className="font-medium">Leads contactados</div>
                  <div className="mt-2 space-y-2">
                    {lookupResult.records.contactedLeads.length === 0 ? <div className="text-muted-foreground">Sin coincidencias.</div> : lookupResult.records.contactedLeads.map((row) => (
                      <div key={row.id} className="rounded-lg border p-3">
                        <div>{row.name || 'Sin nombre'} · {row.company || 'Sin empresa'}</div>
                        <div className="text-muted-foreground">Estado: {row.status || 'sin estado'} · Ultimo envio: {row.sent_at ? format(new Date(row.sent_at), 'dd/MM/yyyy HH:mm') : 'sin fecha'}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="font-medium">Leads enriquecidos</div>
                  <div className="mt-2 space-y-2">
                    {lookupResult.records.enrichedLeads.length === 0 ? <div className="text-muted-foreground">Sin coincidencias.</div> : lookupResult.records.enrichedLeads.map((row) => (
                      <div key={row.id} className="rounded-lg border p-3">
                        <div>{row.full_name || 'Sin nombre'} · {row.company_name || 'Sin empresa'}</div>
                        <div className="text-muted-foreground">Cargo: {row.title || 'sin cargo'} · Actualizado: {row.updated_at ? format(new Date(row.updated_at), 'dd/MM/yyyy HH:mm') : 'sin fecha'}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="font-medium">Bajas registradas</div>
                  <div className="mt-2 space-y-2">
                    {lookupResult.records.unsubscribedEntries.length === 0 ? <div className="text-muted-foreground">Sin coincidencias.</div> : lookupResult.records.unsubscribedEntries.map((row) => (
                      <div key={row.id} className="rounded-lg border p-3">
                        <div>{row.email}</div>
                        <div className="text-muted-foreground">Motivo: {row.reason || 'sin motivo'} · Fecha: {row.created_at ? format(new Date(row.created_at), 'dd/MM/yyyy HH:mm') : 'sin fecha'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
