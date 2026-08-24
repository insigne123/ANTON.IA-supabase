'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowDownAZ,
  ArrowUpAZ,
  ChevronDown,
  ChevronUp,
  Columns3,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Filter,
  Import,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  Settings2,
  X,
} from 'lucide-react';

import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { downloadCsv, toCsv } from '@/lib/csv';
import { exportToPdf, exportToXlsx } from '@/lib/sheet-export';
import { buildUnifiedRows } from '@/lib/unified-sheet-data';
import { defaultColumns } from '@/lib/unified-sheet-storage';
import type { CustomData } from '@/lib/services/unified-sheet-service';
import { unifiedSheetService } from '@/lib/services/unified-sheet-service';
import type { ColumnDef, ColumnKey, UnifiedRow, UnifiedStatus } from '@/lib/unified-sheet-types';

type StatusFilter = 'all' | 'saved' | 'enriched' | 'sent' | 'read' | 'replied';
type EditableKey = Exclude<keyof CustomData, 'updated_at'>;
type ExportFormat = 'xlsx' | 'csv' | 'pdf';

const STATUS_LABELS: Record<UnifiedStatus, string> = {
  saved: 'Guardado',
  enriched: 'Enriquecido',
  sent: 'Enviado',
  read: 'Abierto',
  replied: 'Respondido',
  opened: 'Abierto',
  clicked: 'Click',
  archived: 'Archivado',
};

function StatusBadge({ status }: { status: UnifiedStatus }) {
  const variant = status === 'replied' || status === 'clicked'
    ? 'default'
    : status === 'sent' || status === 'enriched' || status === 'opened' || status === 'read'
      ? 'secondary'
      : 'outline';
  return <Badge variant={variant}>{STATUS_LABELS[status]}</Badge>;
}

function kindLabel(kind: UnifiedRow['kind']) {
  return ({
    lead_saved: 'Lead guardado',
    lead_enriched: 'Lead enriquecido',
    opportunity: 'Oportunidad',
    contacted: 'Contactado',
  } as const)[kind];
}

function formatCellValue(key: ColumnKey, row: UnifiedRow) {
  const value = row[key as keyof UnifiedRow];
  if (value == null || value === '') return '—';
  if (key === 'createdAt' || key === 'updatedAt' || key === 'nextActionDueAt') {
    const date = new Date(value as string | number);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  return String(value);
}

function EditableCell({
  column,
  row,
  saving,
  onCommit,
}: {
  column: ColumnDef;
  row: UnifiedRow;
  saving: boolean;
  onCommit: (row: UnifiedRow, key: EditableKey, value: string) => Promise<void>;
}) {
  const currentValue = String(row[column.key as keyof UnifiedRow] ?? '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentValue);

  useEffect(() => setDraft(currentValue), [currentValue]);

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        aria-label={`Editar ${column.label} de ${row.name || 'fila'}`}
        className="h-8 min-w-[140px] bg-background"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft !== currentValue) void onCommit(row, column.key as EditableKey, draft);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(currentValue);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      disabled={saving}
      onClick={() => setEditing(true)}
      className="group flex min-h-8 w-full min-w-[120px] items-center rounded-md px-2 py-1 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
      aria-label={`Editar ${column.label} de ${row.name || 'fila'}`}
    >
      <span className="line-clamp-2 flex-1 break-words">{currentValue || '—'}</span>
      {saving ? <Loader2 className="ml-2 h-3.5 w-3.5 animate-spin" /> : <Pencil className="ml-2 h-3.5 w-3.5 opacity-0 group-hover:opacity-60 group-focus-visible:opacity-60" />}
    </button>
  );
}

export default function SheetPage() {
  const { toast } = useToast();
  const [columns, setColumns] = useState<ColumnDef[]>(defaultColumns());
  const [rows, setRows] = useState<UnifiedRow[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [industryFilter, setIndustryFilter] = useState('all');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [sortKey, setSortKey] = useState<ColumnKey>('updatedAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState<ExportFormat | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await buildUnifiedRows();
      setRows(data.filter((row) => row.kind !== 'opportunity'));
    } catch (error) {
      console.error('[sheet] load error', error);
      setLoadError('No pudimos cargar la hoja. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const savedColumns = unifiedSheetService.loadColumns();
    const nextColumns = savedColumns.map((column) => column.key === 'name' ? { ...column, visible: true } : column);
    setColumns(nextColumns);
    if (savedColumns.some((column) => column.key === 'name' && !column.visible)) {
      unifiedSheetService.saveColumns(nextColumns);
    }
    void refresh();
  }, [refresh]);

  const orderedVisibleColumns = useMemo(() => {
    const visible = columns.filter((column) => column.visible);
    const identity = visible.find((column) => column.key === 'name');
    return identity ? [identity, ...visible.filter((column) => column.key !== 'name')] : visible;
  }, [columns]);

  const industryOptions = useMemo(() => Array.from(new Set(
    rows.map((row) => String(row.industry || '').trim()).filter(Boolean),
  )).sort((a, b) => a.localeCompare(b)), [rows]);

  const hasFilters = Boolean(query || statusFilter !== 'all' || industryFilter !== 'all' || createdFrom || createdTo);
  const activeFilterCount = [statusFilter !== 'all', industryFilter !== 'all', Boolean(createdFrom), Boolean(createdTo)].filter(Boolean).length;

  const filteredRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    const list = rows.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (industryFilter !== 'all' && String(row.industry || '').trim() !== industryFilter) return false;
      if (createdFrom || createdTo) {
        const createdAt = new Date(row.createdAt || 0);
        if (Number.isNaN(createdAt.getTime())) return false;
        if (createdFrom && createdAt < new Date(`${createdFrom}T00:00:00`)) return false;
        if (createdTo && createdAt > new Date(`${createdTo}T23:59:59`)) return false;
      }
      if (!term) return true;
      return [row.name, row.email, row.company, row.title, row.industry, row.linkedinUrl, kindLabel(row.kind)]
        .some((value) => String(value || '').toLowerCase().includes(term));
    });

    return [...list].sort((a, b) => {
      const aValue = a[sortKey as keyof UnifiedRow];
      const bValue = b[sortKey as keyof UnifiedRow];
      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;
      const multiplier = sortDirection === 'asc' ? 1 : -1;
      if (sortKey.toLowerCase().includes('at')) {
        return (new Date(aValue as string | number).getTime() - new Date(bValue as string | number).getTime()) * multiplier;
      }
      return String(aValue).localeCompare(String(bValue), 'es', { numeric: true, sensitivity: 'base' }) * multiplier;
    });
  }, [createdFrom, createdTo, industryFilter, query, rows, sortDirection, sortKey, statusFilter]);

  function clearFilters() {
    setQuery('');
    setStatusFilter('all');
    setIndustryFilter('all');
    setCreatedFrom('');
    setCreatedTo('');
  }

  function saveColumns(next: ColumnDef[]) {
    setColumns(next);
    unifiedSheetService.saveColumns(next);
  }

  function toggleColumn(key: ColumnKey, visible: boolean) {
    saveColumns(columns.map((column) => column.key === key ? { ...column, visible } : column));
  }

  function moveColumn(key: ColumnKey, direction: -1 | 1) {
    const index = columns.findIndex((column) => column.key === key);
    const destination = Math.max(0, Math.min(columns.length - 1, index + direction));
    if (index < 0 || index === destination) return;
    const next = [...columns];
    const [column] = next.splice(index, 1);
    next.splice(destination, 0, column);
    saveColumns(next);
  }

  function sortBy(key: ColumnKey) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDirection('asc');
      return;
    }
    setSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc');
  }

  async function editCell(row: UnifiedRow, key: EditableKey, value: string) {
    const cellId = `${row.gid}:${String(key)}`;
    const previousValue = row[key as keyof UnifiedRow];
    setSaveError(null);
    setSavingCells((current) => new Set(current).add(cellId));
    setRows((current) => current.map((item) => item.gid === row.gid ? { ...item, [key]: value } : item));

    try {
      await unifiedSheetService.setCustom(row.gid, { [key]: value });
    } catch (error) {
      console.error('[sheet] save error', error);
      setRows((current) => current.map((item) => item.gid === row.gid ? { ...item, [key]: previousValue } : item));
      setSaveError(`No se guardó “${columns.find((column) => column.key === key)?.label || String(key)}”. Restauramos el valor anterior.`);
    } finally {
      setSavingCells((current) => {
        const next = new Set(current);
        next.delete(cellId);
        return next;
      });
    }
  }

  function exportData() {
    const headers = orderedVisibleColumns.map((column) => column.label);
    const data = filteredRows.map((row) => orderedVisibleColumns.map((column) => {
      if (column.key === 'kind') return kindLabel(row.kind);
      if (column.key === 'status') return STATUS_LABELS[row.status];
      return String(row[column.key as keyof UnifiedRow] ?? '');
    }));
    return { headers, data };
  }

  async function runExport(format: ExportFormat) {
    if (filteredRows.length === 0 || exporting) return;
    setExporting(format);
    const { headers, data } = exportData();
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    try {
      if (format === 'xlsx') await exportToXlsx(headers, data, `datos-${timestamp}.xlsx`);
      if (format === 'pdf') await exportToPdf(headers, data, `datos-${timestamp}.pdf`);
      if (format === 'csv') downloadCsv(`datos-${timestamp}.csv`, toCsv(data, headers));
      toast({ title: 'Archivo listo', description: `${filteredRows.length} filas visibles exportadas a ${format.toUpperCase()}.` });
    } catch (error) {
      console.error('[sheet] export error', error);
      toast({ variant: 'destructive', title: 'No se pudo exportar', description: 'Inténtalo nuevamente o elige otro formato.' });
    } finally {
      setExporting(null);
    }
  }

  function renderCell(row: UnifiedRow, column: ColumnDef) {
    if (column.editable) {
      return (
        <EditableCell
          column={column}
          row={row}
          saving={savingCells.has(`${row.gid}:${column.key}`)}
          onCommit={editCell}
        />
      );
    }
    if (column.key === 'status') return <StatusBadge status={row.status} />;
    if (column.key === 'kind') return kindLabel(row.kind);
    if (column.key === 'linkedinUrl' && row.linkedinUrl) {
      return <a className="inline-flex items-center gap-1 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={row.linkedinUrl} target="_blank" rel="noopener noreferrer">Perfil <ExternalLink className="h-3.5 w-3.5" /></a>;
    }
    if (column.key === 'meetingLink' && row.meetingLink) {
      return <a className="inline-flex items-center gap-1 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={row.meetingLink} target="_blank" rel="noopener noreferrer">Abrir <ExternalLink className="h-3.5 w-3.5" /></a>;
    }
    return formatCellValue(column.key, row);
  }

  return (
    <div className="mx-auto min-w-0 py-3 sm:py-5">
      <PageHeader
        title="Datos"
        description="Tu espacio de trabajo tipo Excel para revisar, ordenar y exportar leads y contactos. Los filtros y las columnas visibles se aplican al archivo."
      />

      <div className="mb-3 rounded-xl border border-border/70 bg-card/80 p-2 shadow-sm">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1 lg:max-w-md">
            <Label htmlFor="sheet-search" className="sr-only">Buscar en la hoja</Label>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="sheet-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar nombre, email o empresa"
              className="h-9 border-0 bg-muted/55 pl-9 shadow-none focus-visible:bg-background"
            />
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9">
                  <Filter className="h-4 w-4" /> Filtros
                  {activeFilterCount > 0 && <span className="rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">{activeFilterCount}</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[min(340px,calc(100vw-2rem))] space-y-4">
                <div>
                  <p className="text-sm font-medium">Filtrar filas</p>
                  <p className="text-xs text-muted-foreground">La exportación incluirá solo estos resultados.</p>
                </div>
                <div className="grid gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="sheet-status">Estado</Label>
                    <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
                      <SelectTrigger id="sheet-status"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos los estados</SelectItem>
                        <SelectItem value="saved">Guardado</SelectItem>
                        <SelectItem value="enriched">Enriquecido</SelectItem>
                        <SelectItem value="sent">Enviado</SelectItem>
                        <SelectItem value="read">Abierto</SelectItem>
                        <SelectItem value="replied">Respondido</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="sheet-industry">Industria</Label>
                    <Select value={industryFilter} onValueChange={setIndustryFilter}>
                      <SelectTrigger id="sheet-industry"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas las industrias</SelectItem>
                        {industryOptions.map((industry) => <SelectItem key={industry} value={industry}>{industry}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="grid gap-1.5"><Label htmlFor="sheet-from">Desde</Label><Input id="sheet-from" type="date" value={createdFrom} onChange={(event) => setCreatedFrom(event.target.value)} /></div>
                    <div className="grid gap-1.5"><Label htmlFor="sheet-to">Hasta</Label><Input id="sheet-to" type="date" value={createdTo} onChange={(event) => setCreatedTo(event.target.value)} /></div>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="w-full" onClick={clearFilters} disabled={!hasFilters}>Limpiar filtros</Button>
              </PopoverContent>
            </Popover>

            <Button variant="outline" size="sm" className="h-9" onClick={() => setColumnsOpen(true)}><Columns3 className="h-4 w-4" /> Columnas</Button>
            <Button asChild variant="outline" size="sm" className="h-9"><Link href="/leads/import"><Import className="h-4 w-4" /> Importar</Link></Button>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => void refresh()} disabled={loading} aria-label="Actualizar datos">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          <div className="ml-auto flex w-full items-center lg:w-auto">
            <Button className="h-9 flex-1 rounded-r-none lg:flex-none" onClick={() => void runExport('xlsx')} disabled={filteredRows.length === 0 || orderedVisibleColumns.length === 0 || Boolean(exporting)}>
              {exporting === 'xlsx' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
              Exportar XLSX
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="h-9 rounded-l-none border-l border-primary-foreground/20 px-2" disabled={filteredRows.length === 0 || orderedVisibleColumns.length === 0 || Boolean(exporting)} aria-label="Más formatos de exportación"><ChevronDown className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Exportar filas visibles</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void runExport('xlsx')}><FileSpreadsheet /> Excel (.xlsx)</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void runExport('csv')}><Download /> CSV (.csv)</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void runExport('pdf')}><FileText /> PDF (.pdf)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <div className="mb-3 flex min-h-6 flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted-foreground" aria-live="polite">
        <span>{loading ? 'Actualizando datos…' : `${filteredRows.length} de ${rows.length} filas`}</span>
        <span>Exportación: filtros actuales · {orderedVisibleColumns.length} columnas visibles</span>
      </div>

      {loadError && (
        <Alert variant="destructive" className="mb-3">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No se pudo cargar la hoja</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3"><span>{loadError}</span><Button variant="outline" size="sm" onClick={() => void refresh()}>Reintentar</Button></AlertDescription>
        </Alert>
      )}
      {saveError && (
        <Alert variant="destructive" className="mb-3">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Cambio no guardado</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3"><span>{saveError}</span><Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSaveError(null)} aria-label="Cerrar aviso"><X className="h-4 w-4" /></Button></AlertDescription>
        </Alert>
      )}

      <Card className="min-w-0 overflow-hidden border-border/70 shadow-sm">
        <CardContent className="p-0 [&>div]:max-h-[70dvh] [&>div]:overscroll-contain sm:[&>div]:max-h-[calc(100dvh-15rem)]">
          <Table className="min-w-max">
            <TableHeader className="sticky top-0 z-20 bg-muted/95 backdrop-blur">
              <TableRow className="hover:bg-transparent">
                {orderedVisibleColumns.map((column, index) => (
                  <TableHead
                    key={column.key}
                    aria-sort={sortKey === column.key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={`h-10 px-3 ${index === 0 ? 'sticky left-0 z-30 border-r bg-muted' : 'bg-muted/95'}`}
                    style={{ minWidth: column.width ? `${column.width}px` : undefined }}
                  >
                    <button type="button" onClick={() => sortBy(column.key)} className="flex w-full items-center gap-1.5 rounded-sm py-1 text-left font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span>{column.label}</span>
                      {sortKey === column.key
                        ? sortDirection === 'asc' ? <ArrowDownAZ className="h-3.5 w-3.5" /> : <ArrowUpAZ className="h-3.5 w-3.5" />
                        : <span className="sr-only">Ordenar por {column.label}</span>}
                    </button>
                  </TableHead>
                ))}
                <TableHead className="sticky right-0 z-20 h-10 w-28 border-l bg-muted px-3 text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && rows.length === 0 && Array.from({ length: 7 }).map((_, rowIndex) => (
                <TableRow key={rowIndex}>
                  {orderedVisibleColumns.map((column, columnIndex) => <TableCell key={column.key} className={`p-3 ${columnIndex === 0 ? 'sticky left-0 z-10 border-r bg-card' : ''}`}><div className="h-4 w-full animate-pulse rounded bg-muted" /></TableCell>)}
                  <TableCell className="sticky right-0 border-l bg-card p-3"><div className="ml-auto h-8 w-20 animate-pulse rounded bg-muted" /></TableCell>
                </TableRow>
              ))}

              {!loading && filteredRows.map((row) => (
                <TableRow key={row.gid} className="group align-top">
                  {orderedVisibleColumns.map((column, index) => (
                    <TableCell
                      key={column.key}
                      className={`max-w-[360px] px-3 py-2.5 ${index === 0 ? 'sticky left-0 z-10 border-r bg-card font-medium group-hover:bg-muted' : ''}`}
                      style={{ minWidth: column.width ? `${column.width}px` : undefined, textAlign: column.align || 'left' }}
                    >
                      {column.editable ? renderCell(row, column) : <div className="line-clamp-2 break-words">{renderCell(row, column)}</div>}
                    </TableCell>
                  ))}
                  <TableCell className="sticky right-0 z-10 border-l bg-card px-3 py-2 text-right group-hover:bg-muted">
                    {row.kind === 'contacted' ? (
                      <Button asChild size="sm" variant="outline"><Link href="/contacted">Ver hilo</Link></Button>
                    ) : (row.kind === 'lead_enriched' || row.kind === 'opportunity') && row.hasEmail ? (
                      <Button asChild size="sm"><Link href={`/contact/compose?id=${encodeURIComponent(row.sourceId)}`}>Contactar</Link></Button>
                    ) : row.kind === 'lead_saved' ? (
                      <Button asChild size="sm" variant="outline"><Link href="/saved/leads">Abrir</Link></Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}

              {!loading && filteredRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={Math.max(1, orderedVisibleColumns.length + 1)} className="h-64 text-center">
                    <div className="mx-auto flex max-w-sm flex-col items-center gap-2 px-4">
                      <FileSpreadsheet className="h-8 w-8 text-muted-foreground/70" />
                      <p className="font-medium text-foreground">{rows.length === 0 ? 'Tu hoja está vacía' : 'No hay filas con estos filtros'}</p>
                      <p className="text-sm text-muted-foreground">{rows.length === 0 ? 'Importa leads para revisarlos y exportarlos desde aquí.' : 'Limpia los filtros o cambia la búsqueda para ver más resultados.'}</p>
                      {rows.length === 0
                        ? <Button asChild size="sm" className="mt-2"><Link href="/leads/import"><Import className="h-4 w-4" /> Importar leads</Link></Button>
                        : <Button size="sm" variant="outline" className="mt-2" onClick={clearFilters}>Limpiar filtros</Button>}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={columnsOpen} onOpenChange={setColumnsOpen}>
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Columnas visibles</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">La selección y el orden también se usan al exportar.</p>
          <div className="space-y-1.5">
            {columns.map((column, index) => (
              <div key={column.key} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 p-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Checkbox id={`column-${column.key}`} checked={column.visible} disabled={column.key === 'name'} onCheckedChange={(checked) => toggleColumn(column.key, Boolean(checked))} />
                  <Label htmlFor={`column-${column.key}`} className="truncate font-normal">{column.label}</Label>
                  {column.key === 'name' && <Badge variant="secondary" className="hidden text-[10px] sm:inline-flex">Fija</Badge>}
                  {column.editable && <Badge variant="outline" className="hidden text-[10px] sm:inline-flex">Editable</Badge>}
                </div>
                <div className="flex items-center">
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => moveColumn(column.key, -1)} disabled={index === 0} aria-label={`Mover ${column.label} hacia arriba`}><ChevronUp className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => moveColumn(column.key, 1)} disabled={index === columns.length - 1} aria-label={`Mover ${column.label} hacia abajo`}><ChevronDown className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 pt-2">
            <Button variant="outline" onClick={() => saveColumns(defaultColumns())}><Settings2 className="h-4 w-4" /> Restablecer</Button>
            <Button onClick={() => setColumnsOpen(false)}>Listo</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
