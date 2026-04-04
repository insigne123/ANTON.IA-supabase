'use client';

import React from 'react';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { ChevronDown, ChevronUp, Columns3, Download, RotateCw, Settings2, ExternalLink, FileSpreadsheet, FileText } from 'lucide-react';

import { buildUnifiedRows } from '@/lib/unified-sheet-data';
import type { ColumnDef, ColumnKey, UnifiedRow, UnifiedStatus } from '@/lib/unified-sheet-types';
import { defaultColumns } from '@/lib/unified-sheet-storage';
import { unifiedSheetService } from '@/lib/services/unified-sheet-service';
import { useToast } from '@/hooks/use-toast';
import { toCsv, downloadCsv } from '@/lib/csv';
import Link from 'next/link';
import { exportToXlsx, exportToPdf } from '@/lib/sheet-export';

function pill(status: UnifiedStatus) {
  switch (status) {
    case 'replied': return <Badge>Respondido</Badge>;
    case 'read': return <Badge>Abierto</Badge>;
    case 'sent': return <Badge variant="secondary">Enviado</Badge>;
    case 'enriched': return <Badge variant="secondary">Enriquecido</Badge>;
    default: return <Badge variant="outline">Guardado</Badge>;
  }
}

function kindLabel(k: UnifiedRow['kind']) {
  return ({
    lead_saved: 'Lead (guardado)',
    lead_enriched: 'Lead (enriquecido)',
    opportunity: 'Oportunidad',
    contacted: 'Contactado',
  } as const)[k];
}

function hasReplyInRow(row: UnifiedRow) {
  return row.status === 'replied';
}

function formatCellValue(key: ColumnKey, row: UnifiedRow) {
  const value = (row as any)[key];
  if (value == null || value === '') return '—';
  if (key === 'createdAt' || key === 'updatedAt' || key === 'nextActionDueAt') {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  return value;
}

export default function UnifiedSheetPage() {
  const { toast } = useToast();
  const [cols, setCols] = useState<ColumnDef[]>(defaultColumns());
  const [rows, setRows] = useState<UnifiedRow[]>([]);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'saved' | 'enriched' | 'sent' | 'read' | 'replied'>('all');
  const [industryFilter, setIndustryFilter] = useState('all');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [openCols, setOpenCols] = useState(false);
  const [sortKey, setSortKey] = useState<ColumnKey>('updatedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const unifiedRows = await buildUnifiedRows();
      setRows(unifiedRows);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error al cargar datos', description: 'No se pudieron unificar las fuentes.' })
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    setCols(unifiedSheetService.loadColumns());
    refresh();
  }, [refresh]);

  function toggleColVisibility(key: ColumnKey, v: boolean) {
    const next = cols.map(c => c.key === key ? { ...c, visible: v } : c);
    setCols(next);
    unifiedSheetService.saveColumns(next);
  }

  function moveCol(key: ColumnKey, dir: -1 | 1) {
    const idx = cols.findIndex(c => c.key === key);
    if (idx < 0) return;
    const next = [...cols];
    const newIdx = Math.max(0, Math.min(cols.length - 1, idx + dir));
    const [it] = next.splice(idx, 1);
    next.splice(newIdx, 0, it);
    setCols(next);
    unifiedSheetService.saveColumns(next);
  }

  function resetSchema() {
    const d = defaultColumns();
    setCols(d);
    unifiedSheetService.saveColumns(d);
  }

  const visibleCols = cols.filter(c => c.visible);
  const industryOptions = useMemo(() => {
    return Array.from(new Set(rows.map((row) => String(row.industry || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }, [rows]);
  const summary = useMemo(() => ({
    total: rows.length,
    replied: rows.filter((row) => hasReplyInRow(row)).length,
    activeCrm: rows.filter((row) => !!row.stage && !['closed_lost', 'closed_won'].includes(String(row.stage))).length,
    industries: industryOptions.length,
  }), [rows, industryOptions]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = rows.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (industryFilter !== 'all' && String(r.industry || '').trim() !== industryFilter) return false;
      if (createdFrom || createdTo) {
        const dateValue = new Date(r.createdAt || 0);
        if (Number.isNaN(dateValue.getTime())) return false;
        if (createdFrom) {
          const from = new Date(`${createdFrom}T00:00:00`);
          if (dateValue < from) return false;
        }
        if (createdTo) {
          const to = new Date(`${createdTo}T23:59:59`);
          if (dateValue > to) return false;
        }
      }
      if (!term) return true;
      const hay = [
        r.name, r.email, r.company, r.title, r.industry,
        r.linkedinUrl, kindLabel(r.kind)
      ].map(x => (x || '').toString().toLowerCase());
      return hay.some(s => s.includes(term));
    });

    const get = (r: UnifiedRow, key: ColumnKey): any => {
      if (key === 'stage') return r.stage;
      if (key === 'owner') return r.owner;
      if (key === 'notes') return r.notes;
      if (key === 'nextAction') return r.nextAction;
      if (key === 'nextActionType') return r.nextActionType;
      if (key === 'nextActionDueAt') return r.nextActionDueAt;
      if (key === 'autopilotStatus') return r.autopilotStatus;
      if (key === 'lastAutopilotEvent') return r.lastAutopilotEvent;
      if (key === 'meetingLink') return r.meetingLink;
      return (r as any)[key];
    };

    const sorted = [...list].sort((a, b) => {
      const av = get(a, sortKey);
      const bv = get(b, sortKey);
      const an = typeof av === 'string' ? av.toLowerCase() : av;
      const bn = typeof bv === 'string' ? bv.toLowerCase() : bv;
      if (an == null && bn == null) return 0;
      if (an == null) return 1;
      if (bn == null) return -1;
      if (String(sortKey).toLowerCase().includes('at')) {
        const da = new Date(av || 0).getTime();
        const db = new Date(bv || 0).getTime();
        return sortDir === 'asc' ? (da - db) : (db - da);
      }
      if (an < bn) return sortDir === 'asc' ? -1 : 1;
      if (an > bn) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [rows, q, statusFilter, industryFilter, createdFrom, createdTo, sortKey, sortDir]);

  function onEdit(r: UnifiedRow, key: ColumnKey, value: string) {
    const patch: any = {};
    patch[key] = value;

    // Optimistic update
    setRows(prev => prev.map(x => x.gid === r.gid ? { ...x, ...patch } : x));
    // Async save
    unifiedSheetService.setCustom(r.gid, patch);
  }

  // ---- helpers para exportación ----
  function buildHeaderAndData() {
    const headers = visibleCols.map(c => c.label);
    const mapKey = (key: ColumnKey, r: UnifiedRow): string | number => {
      switch (key) {
        case 'status': return r.status;
        case 'kind': return kindLabel(r.kind);
        case 'linkedinUrl': return r.linkedinUrl || '';
        case 'stage': return r.stage || '';
        case 'owner': return r.owner || '';
        case 'notes': return r.notes || '';
        default: return (r as any)[key] ?? '';
      }
    };
    const data = filtered.map(r => visibleCols.map(c => mapKey(c.key, r)));
    return { headers, data };
  }

  function exportCsv() {
    const { headers, data } = buildHeaderAndData();
    const csvData = toCsv(data.map(row => row.map(cell => String(cell))), headers);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadCsv(`leadflow-sheet-${stamp}.csv`, csvData);
    toast({ title: 'Exportado', description: `${filtered.length} filas a CSV.` });
  }

  async function exportXlsx() {
    const { headers, data } = buildHeaderAndData();
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    await exportToXlsx(headers, data, `leadflow-sheet-${stamp}.xlsx`);
  }

  async function exportPdf() {
    const { headers, data } = buildHeaderAndData();
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    await exportToPdf(headers, data, `leadflow-sheet-${stamp}.pdf`);
  }

  function headerSort(key: ColumnKey) {
    if (sortKey !== key) { setSortKey(key); setSortDir('asc'); return; }
    setSortDir(d => d === 'asc' ? 'desc' : 'asc');
  }

  return (
    <div className="container mx-auto py-2">
      <PageHeader
        title="CRM unificado"
        description="Vista tipo hoja para leads, contactados y oportunidades. Elige qué columnas ver, ordena la información y trabaja con más contexto sin salir del CRM."
      />

      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-border/60 bg-card/85 shadow-[0_10px_28px_-24px_rgba(15,23,42,0.16)]"><CardContent className="p-4"><div className="text-xs uppercase text-muted-foreground">Filas totales</div><div className="mt-1 text-2xl font-semibold">{summary.total}</div></CardContent></Card>
        <Card className="border-border/60 bg-card/85 shadow-[0_10px_28px_-24px_rgba(15,23,42,0.16)]"><CardContent className="p-4"><div className="text-xs uppercase text-muted-foreground">Respondidos</div><div className="mt-1 text-2xl font-semibold">{summary.replied}</div></CardContent></Card>
        <Card className="border-border/60 bg-card/85 shadow-[0_10px_28px_-24px_rgba(15,23,42,0.16)]"><CardContent className="p-4"><div className="text-xs uppercase text-muted-foreground">Activos en CRM</div><div className="mt-1 text-2xl font-semibold">{summary.activeCrm}</div></CardContent></Card>
        <Card className="border-border/60 bg-card/85 shadow-[0_10px_28px_-24px_rgba(15,23,42,0.16)]"><CardContent className="p-4"><div className="text-xs uppercase text-muted-foreground">Industrias</div><div className="mt-1 text-2xl font-semibold">{summary.industries}</div></CardContent></Card>
      </div>

      <div className="mb-3 rounded-xl border bg-muted/20 p-4">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,0.7fr))]">
          <Input placeholder="Buscar por nombre, email, empresa, cargo o industria" value={q} onChange={e => setQ(e.target.value)} className="w-full" />
          <select className="h-10 border rounded-md px-3 py-2 text-sm bg-background" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
            <option value="all">Todos los estados</option>
            <option value="saved">Guardado</option>
            <option value="enriched">Enriquecido</option>
            <option value="sent">Enviado</option>
            <option value="read">Abierto</option>
            <option value="replied">Respondido</option>
          </select>
          <select className="h-10 border rounded-md px-3 py-2 text-sm bg-background" value={industryFilter} onChange={(e) => setIndustryFilter(e.target.value)}>
            <option value="all">Todas las industrias</option>
            {industryOptions.map((industry) => <option key={industry} value={industry}>{industry}</option>)}
          </select>
          <Input type="date" value={createdFrom} onChange={(e) => setCreatedFrom(e.target.value)} className="w-full" aria-label="Ingreso CRM desde" />
          <Input type="date" value={createdTo} onChange={(e) => setCreatedTo(e.target.value)} className="w-full" aria-label="Ingreso CRM hasta" />
          <Button variant="ghost" className="shadow-none" onClick={() => { setQ(''); setStatusFilter('all'); setIndustryFilter('all'); setCreatedFrom(''); setCreatedTo(''); }}>
            Limpiar
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" className="shadow-none" onClick={() => setOpenCols(true)}>
            <Columns3 className="mr-2 h-4 w-4" /> Columnas
          </Button>
          <Button variant="outline" className="shadow-none" onClick={refresh} disabled={loading}>
            <RotateCw className="mr-2 h-4 w-4" /> Refrescar
          </Button>
          <Button className="shadow-none" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" /> Exportar CSV
          </Button>
          <Button onClick={exportXlsx} variant="outline" className="shadow-none">
            <FileSpreadsheet className="mr-2 h-4 w-4" /> XLSX
          </Button>
          <Button onClick={exportPdf} variant="outline" className="shadow-none">
            <FileText className="mr-2 h-4 w-4" /> PDF
          </Button>
          <Link href="/leads/import">
            <Button variant="default" className="shadow-none bg-emerald-600 hover:bg-emerald-700">
              <Download className="mr-2 h-4 w-4 rotate-180" /> Importar Leads
            </Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {visibleCols.map(c => (
                    <TableHead
                      key={c.key}
                      style={{ minWidth: c.width ? `${c.width}px` : undefined, cursor: 'pointer' }}
                      onClick={() => headerSort(c.key)}
                      title="Ordenar"
                    >
                      <div className="flex items-center gap-1">
                        <span>{c.label}</span>
                        {sortKey === c.key ? (sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : null}
                      </div>
                    </TableHead>
                  ))}
                  <TableHead className="w-32 text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  [...Array(10)].map((_, i) => (
                    <TableRow key={i}>
                      {visibleCols.map(c => <TableCell key={c.key}><div className="h-4 bg-muted rounded w-full animate-pulse" /></TableCell>)}
                      <TableCell><div className="h-8 bg-muted rounded w-24 ml-auto animate-pulse" /></TableCell>
                    </TableRow>
                  ))
                ) : filtered.map(r => (
                  <TableRow key={r.gid} className="align-top">
                    {visibleCols.map(c => {
                      let val: any = (r as any)[c.key];
                      if (c.key === 'status') val = pill(r.status);
                      if (c.key === 'kind') val = kindLabel(r.kind);
                      if (c.key === 'linkedinUrl' && r.linkedinUrl) {
                        val = <a className="underline" href={r.linkedinUrl} target="_blank" rel="noopener noreferrer">Perfil</a>;
                      }
                      if (c.key === 'meetingLink' && r.meetingLink) {
                        val = <a className="underline" href={r.meetingLink} target="_blank" rel="noopener noreferrer">Abrir</a>;
                      }
                      if (c.editable) {
                        return (
                          <TableCell key={c.key} style={{ minWidth: c.width ? `${c.width}px` : undefined, textAlign: c.align || 'left' }}>
                            <Input
                              defaultValue={val || ''}
                              onBlur={(e) => onEdit(r, c.key as any, e.target.value)}
                              placeholder={c.label}
                              className="h-8"
                            />
                          </TableCell>
                        );
                      }
                      return (
                        <TableCell key={c.key} style={{ minWidth: c.width ? `${c.width}px` : undefined, textAlign: c.align || 'left' }}>
                          {React.isValidElement(val)
                            ? val
                            : c.key === 'email'
                              ? (r.email ?? '—')
                              : formatCellValue(c.key, { ...r, [c.key]: val } as UnifiedRow)}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-right">
                      {r.kind === 'contacted' ? (
                        <Link href="/contacted"><Button size="sm" variant="outline"><ExternalLink className="h-4 w-4 mr-1" />Ver hilo</Button></Link>
                      ) : r.kind === 'lead_enriched' || r.kind === 'opportunity' && r.hasEmail ? (
                        <Link href={`/contact/compose?id=${encodeURIComponent(r.sourceId)}`}>
                          <Button size="sm">Contactar</Button>
                        </Link>
                      ) : r.kind === 'lead_saved' ? (
                        <Link href="/saved/leads"><Button size="sm" variant="outline">Abrir guardados</Button></Link>
                      ) : r.kind === 'opportunity' ? (
                        <Link href="/saved/opportunities"><Button size="sm" variant="outline">Abrir oportunidades</Button></Link>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
                {(!loading && filtered.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={visibleCols.length + 1} className="text-center text-sm text-muted-foreground py-10">
                      Sin resultados. Ajusta filtros o refresca.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Configuración de columnas */}
      <Dialog open={openCols} onOpenChange={setOpenCols}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Columnas visibles y orden</DialogTitle></DialogHeader>
          <div className="space-y-2">
            {cols.map(c => (
              <div key={c.key} className="flex items-center justify-between border rounded p-2">
                <div className="flex items-center gap-2">
                  <Checkbox checked={c.visible} onCheckedChange={(v) => toggleColVisibility(c.key, Boolean(v))} />
                  <span className="text-sm">{c.label}</span>
                  {c.editable && <Badge variant="outline">editable</Badge>}
                </div>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="ghost" onClick={() => moveCol(c.key, -1)} title="Subir"><ChevronUp className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => moveCol(c.key, +1)} title="Bajar"><ChevronDown className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-between">
            <Button variant="outline" onClick={resetSchema}><Settings2 className="h-4 w-4 mr-2" />Restablecer</Button>
            <Button onClick={() => setOpenCols(false)}>Cerrar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
