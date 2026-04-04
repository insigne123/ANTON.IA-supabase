'use client';

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

export default function UnifiedSheetPage() {
  const { toast } = useToast();
  const [cols, setCols] = useState<ColumnDef[]>(defaultColumns());
  const [rows, setRows] = useState<UnifiedRow[]>([]);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'saved' | 'enriched' | 'sent' | 'read' | 'replied'>('all');
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

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = rows.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!term) return true;
      const hay = [
        r.name, r.email, r.company, r.title,
        r.linkedinUrl, kindLabel(r.kind)
      ].map(x => (x || '').toString().toLowerCase());
      return hay.some(s => s.includes(term));
    });

    const get = (r: UnifiedRow, key: ColumnKey): any => {
      if (key === 'stage') return r.stage;
      if (key === 'owner') return r.owner;
      if (key === 'notes') return r.notes;
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
  }, [rows, q, statusFilter, sortKey, sortDir]);

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
        title="Sheet (CRM unificado)"
        description="Vista tipo Excel/Sheets para leads y oportunidades. Personaliza columnas, edita campos propios, exporta CSV/XLSX/PDF."
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input placeholder="Filtrar (nombre, email, empresa, dominio…)" value={q} onChange={e => setQ(e.target.value)} className="w-[360px]" />
        <select className="h-10 border rounded-md px-3 py-2 text-sm bg-background" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
          <option value="all">Todos los estados</option>
          <option value="saved">Guardado</option>
          <option value="enriched">Enriquecido</option>
          <option value="sent">Enviado</option>
          <option value="read">Abierto</option>
          <option value="replied">Respondido</option>
        </select>
        <Button variant="secondary" onClick={() => setOpenCols(true)}>
          <Columns3 className="mr-2 h-4 w-4" /> Columnas
        </Button>
        <Button variant="outline" onClick={refresh} disabled={loading}>
          <RotateCw className="mr-2 h-4 w-4" /> Refrescar
        </Button>
        <Button onClick={exportCsv}>
          <Download className="mr-2 h-4 w-4" /> Exportar CSV
        </Button>
        <Button onClick={exportXlsx} variant="outline">
          <FileSpreadsheet className="mr-2 h-4 w-4" /> XLSX
        </Button>
        <Button onClick={exportPdf} variant="outline">
          <FileText className="mr-2 h-4 w-4" /> PDF
        </Button>
        <Link href="/leads/import">
          <Button variant="default" className="bg-green-600 hover:bg-green-700">
            <Download className="mr-2 h-4 w-4 rotate-180" /> Importar Leads
          </Button>
        </Link>
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
                          {c.key === 'email'
                            ? (r.email ?? '—')
                            : ((r as any)[c.key] ?? '—')}
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
