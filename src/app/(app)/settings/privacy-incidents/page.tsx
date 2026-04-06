'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { privacyIncidentSeverities, privacyIncidentStatuses, type PrivacyIncidentSeverity, type PrivacyIncidentStatus } from '@/lib/privacy-incident';

type PrivacyIncident = {
  id: string;
  title: string;
  severity: PrivacyIncidentSeverity;
  status: PrivacyIncidentStatus;
  summary: string;
  affected_scope: string | null;
  data_types: string | null;
  incident_at: string;
  detected_at: string;
  contained_at: string | null;
  resolved_at: string | null;
  reported_by_email: string | null;
  resolution_notes: string | null;
};

const defaultSeverity: PrivacyIncidentSeverity = 'medium';
const defaultStatus: PrivacyIncidentStatus = 'detected';

export default function PrivacyIncidentsPage() {
  const [incidents, setIncidents] = useState<PrivacyIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | PrivacyIncidentStatus>('all');
  const [editingId, setEditingId] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<PrivacyIncidentSeverity>(defaultSeverity);
  const [status, setStatus] = useState<PrivacyIncidentStatus>(defaultStatus);
  const [summary, setSummary] = useState('');
  const [affectedScope, setAffectedScope] = useState('');
  const [dataTypes, setDataTypes] = useState('');
  const [resolutionNotes, setResolutionNotes] = useState('');

  async function loadIncidents(nextStatus = statusFilter) {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (nextStatus !== 'all') params.set('status', nextStatus);
      const response = await fetch(`/api/privacy/incidents?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'No se pudieron obtener los incidentes.');
      setIncidents(Array.isArray(data?.incidents) ? data.incidents : []);
    } catch (fetchError: any) {
      setIncidents([]);
      setError(fetchError?.message || 'No se pudieron obtener los incidentes.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadIncidents(statusFilter);
  }, [statusFilter]);

  function resetForm() {
    setEditingId(null);
    setTitle('');
    setSeverity(defaultSeverity);
    setStatus(defaultStatus);
    setSummary('');
    setAffectedScope('');
    setDataTypes('');
    setResolutionNotes('');
  }

  function startEdit(incident: PrivacyIncident) {
    setEditingId(incident.id);
    setTitle(incident.title);
    setSeverity(incident.severity);
    setStatus(incident.status);
    setSummary(incident.summary);
    setAffectedScope(incident.affected_scope || '');
    setDataTypes(incident.data_types || '');
    setResolutionNotes(incident.resolution_notes || '');
  }

  async function submitIncident(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');

    try {
      const payload = { id: editingId, title, severity, status, summary, affectedScope, dataTypes, resolutionNotes };
      const response = await fetch('/api/privacy/incidents', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'No se pudo guardar el incidente.');

      resetForm();
      await loadIncidents(statusFilter);
    } catch (saveError: any) {
      setError(saveError?.message || 'No se pudo guardar el incidente.');
    } finally {
      setSaving(false);
    }
  }

  function badgeVariant(severityValue: PrivacyIncidentSeverity) {
    if (severityValue === 'high') return 'destructive' as const;
    if (severityValue === 'medium') return 'secondary' as const;
    return 'outline' as const;
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Incidentes de privacidad</h1>
          <p className="text-sm text-muted-foreground">Registro operativo para deteccion, contencion y cierre de incidentes de datos personales.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as 'all' | PrivacyIncidentStatus)}>
            <SelectTrigger className="w-[190px]"><SelectValue placeholder="Filtrar por estado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {privacyIncidentStatuses.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => loadIncidents(statusFilter)} disabled={loading}>{loading ? 'Actualizando...' : 'Actualizar'}</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{editingId ? 'Editar incidente' : 'Registrar incidente'}</CardTitle>
          <CardDescription>Usa esta bandeja para documentar deteccion, alcance, contencion y cierre.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submitIncident}>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="incident-title">Titulo</Label>
                <Input id="incident-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="incident-severity">Severidad</Label>
                <Select value={severity} onValueChange={(value) => setSeverity(value as PrivacyIncidentSeverity)}>
                  <SelectTrigger id="incident-severity"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {privacyIncidentSeverities.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="incident-status">Estado</Label>
                <Select value={status} onValueChange={(value) => setStatus(value as PrivacyIncidentStatus)}>
                  <SelectTrigger id="incident-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {privacyIncidentStatuses.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="incident-scope">Alcance afectado</Label>
                <Input id="incident-scope" value={affectedScope} onChange={(e) => setAffectedScope(e.target.value)} placeholder="Ej. 1 organizacion, 45 leads, tokens Outlook" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="incident-data-types">Tipos de datos</Label>
                <Input id="incident-data-types" value={dataTypes} onChange={(e) => setDataTypes(e.target.value)} placeholder="Ej. email, tracking, refresh token" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="incident-summary">Resumen</Label>
              <Textarea id="incident-summary" value={summary} onChange={(e) => setSummary(e.target.value)} required minLength={15} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="incident-resolution">Notas de contencion o cierre</Label>
              <Textarea id="incident-resolution" value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)} />
            </div>

            {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>{saving ? 'Guardando...' : editingId ? 'Actualizar incidente' : 'Registrar incidente'}</Button>
              {editingId ? <Button type="button" variant="outline" onClick={resetForm}>Cancelar</Button> : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historial</CardTitle>
          <CardDescription>Registro reciente de incidentes y su estado operativo.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!loading && incidents.length === 0 ? <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">No hay incidentes registrados.</div> : null}
          {incidents.map((incident) => (
            <div key={incident.id} className="rounded-xl border p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={badgeVariant(incident.severity)}>{incident.severity}</Badge>
                    <Badge variant="outline">{incident.status}</Badge>
                  </div>
                  <div className="font-medium">{incident.title}</div>
                  <div className="text-xs text-muted-foreground">Reportado por: {incident.reported_by_email || 'sin email'} · Detectado: {new Date(incident.detected_at).toLocaleString()}</div>
                </div>
                <Button variant="outline" size="sm" onClick={() => startEdit(incident)}>Editar</Button>
              </div>
              <div className="mt-3 rounded-lg bg-muted/40 p-3 text-sm whitespace-pre-wrap">{incident.summary}</div>
              {incident.resolution_notes ? <div className="mt-3 text-sm text-muted-foreground whitespace-pre-wrap">{incident.resolution_notes}</div> : null}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
