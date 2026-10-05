'use client';

import { useMemo, useState } from 'react';
import { ArrowLeft, Loader2, Trash2, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { csvRowDestination, csvRowProblem, csvRowRepeats, type CsvLeadInput } from '@/lib/csv-import-utils';
import { cn } from '@/lib/utils';

interface DataReviewGridProps {
    initialRows: CsvLeadInput[];
    /** Emails already contacted: those rows are shown but not imported, so nobody is written twice. */
    contactedEmails?: Set<string> | null;
    onBack: () => void;
    onSubmit: (rows: CsvLeadInput[]) => void;
    isSubmitting: boolean;
}

/** Big files stay quick: the table shows this many rows at a time; the rest import the same when they are ready. */
const ROW_LIMIT = 200;

type EditableField = 'name' | 'email' | 'phone' | 'company' | 'title' | 'linkedinUrl';
const COLUMNS: Array<{ field: EditableField; label: string; placeholder?: string }> = [
    { field: 'name', label: 'Nombre' },
    { field: 'email', label: 'Correo' },
    { field: 'phone', label: 'Teléfono' },
    { field: 'company', label: 'Empresa' },
    { field: 'title', label: 'Cargo' },
    { field: 'linkedinUrl', label: 'LinkedIn', placeholder: 'https://' },
];

const contacts = (count: number) => `${count} ${count === 1 ? 'contacto' : 'contactos'}`;

/**
 * Step 3: every row with where it goes («Por escribir» with an email or a phone, «Por completar» without) or what to fix.
 * Cells can be edited and rows removed; only the ready rows are imported.
 */
export function DataReviewGrid({ initialRows, contactedEmails = null, onBack, onSubmit, isSubmitting }: DataReviewGridProps) {
    const [rows, setRows] = useState<CsvLeadInput[]>(initialRows);
    const [onlyProblems, setOnlyProblems] = useState(false);
    const problems = useMemo(() => rows.map(csvRowProblem), [rows]);
    // The same person twice in the file (email, LinkedIn or name and company) is imported once.
    const repeats = useMemo(() => csvRowRepeats(rows), [rows]);
    const isContacted = (row: CsvLeadInput) => Boolean(row.email && contactedEmails?.has(row.email.toLowerCase()));
    const counts = useMemo(() => {
        const result = { porEscribir: 0, porCompletar: 0, contacted: 0, problems: 0, repeated: 0 };
        rows.forEach((row, index) => {
            if (problems[index]) result.problems += 1;
            else if (repeats[index] !== null) result.repeated += 1;
            else if (row.email && contactedEmails?.has(row.email.toLowerCase())) result.contacted += 1;
            else if (csvRowDestination(row) === 'por-escribir') result.porEscribir += 1;
            else result.porCompletar += 1;
        });
        return result;
    }, [rows, problems, repeats, contactedEmails]);
    const ready = counts.porEscribir + counts.porCompletar;
    const filtered = useMemo(
        () => rows.map((row, index) => ({ row, index })).filter(({ index }) => !onlyProblems || problems[index]),
        [rows, problems, onlyProblems],
    );
    const shown = filtered.slice(0, ROW_LIMIT);

    const updateCell = (index: number, field: EditableField, value: string) => {
        setRows((current) => current.map((row, rowIndex) => {
            if (rowIndex !== index) return row;
            const next = field === 'email' ? value.trim().toLowerCase() : value;
            return { ...row, [field]: next };
        }));
    };
    const removeRow = (index: number) => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h2 className="text-lg font-semibold">Revisa antes de importar</h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">Corrige lo marcado o quita la fila. Solo se importan las filas listas.</p>
                    <div className="mt-3 flex flex-wrap gap-2" role="status" aria-live="polite">
                        <Badge variant="success">{counts.porEscribir} a Por escribir</Badge>
                        <Badge variant="info">{counts.porCompletar} a Por completar</Badge>
                        {counts.repeated > 0 ? <Badge variant="neutral">{counts.repeated} {counts.repeated === 1 ? 'repetido' : 'repetidos'}</Badge> : null}
                        {counts.contacted > 0 ? <Badge variant="neutral">{counts.contacted} ya {counts.contacted === 1 ? 'contactado' : 'contactados'}</Badge> : null}
                        {counts.problems > 0 ? <Badge variant="danger">{counts.problems} por revisar</Badge> : null}
                    </div>
                </div>
                {counts.problems > 0 || onlyProblems ? (
                    <Button type="button" variant="outline" size="sm" aria-pressed={onlyProblems} onClick={() => setOnlyProblems((value) => !value)}>
                        {onlyProblems ? 'Ver todas las filas' : 'Ver solo las que hay que revisar'}
                    </Button>
                ) : null}
            </div>

            <div className="max-h-[60vh] overflow-auto rounded-2xl border border-border">
                <Table>
                    <TableHeader className="sticky top-0 z-10 bg-background">
                        <TableRow>
                            <TableHead className="min-w-40">Destino</TableHead>
                            {COLUMNS.map((column) => <TableHead key={column.field} className="min-w-40">{column.label}</TableHead>)}
                            <TableHead className="w-12"><span className="sr-only">Quitar</span></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {shown.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={COLUMNS.length + 2} className="py-8 text-center text-sm text-muted-foreground">
                                    {onlyProblems ? 'No quedan filas por revisar.' : 'No quedan filas. Vuelve atrás para elegir otro archivo.'}
                                </TableCell>
                            </TableRow>
                        ) : shown.map(({ row, index }) => {
                            const problem = problems[index];
                            const who = row.name || `la fila ${index + 1}`;
                            return (
                                <TableRow key={index}>
                                    <TableCell className="align-top">
                                        {problem ? (
                                            <>
                                                <Badge variant="danger">Revisar</Badge>
                                                <p className="mt-1 max-w-56 text-xs leading-5 text-destructive">{problem}</p>
                                            </>
                                        ) : repeats[index] !== null ? (
                                            <>
                                                <Badge variant="neutral">Repetido</Badge>
                                                <p className="mt-1 max-w-56 text-xs leading-5 text-foreground/70">Es la misma persona de la fila {repeats[index]}: se importa una vez.</p>
                                            </>
                                        ) : isContacted(row) ? (
                                            <>
                                                <Badge variant="neutral">Ya contactado</Badge>
                                                <p className="mt-1 max-w-56 text-xs leading-5 text-foreground/70">No se importa: ya le escribiste.</p>
                                            </>
                                        ) : csvRowDestination(row) === 'por-escribir'
                                            ? <Badge variant="success">Por escribir</Badge>
                                            : <Badge variant="info">Por completar</Badge>}
                                    </TableCell>
                                    {COLUMNS.map((column) => (
                                        <TableCell key={column.field} className="p-1 align-top">
                                            <Input
                                                value={String(row[column.field] || '')}
                                                onChange={(event) => updateCell(index, column.field, event.target.value)}
                                                placeholder={column.placeholder || '—'}
                                                aria-label={`${column.label} de ${who}`}
                                                className={cn('h-8 border-transparent bg-transparent px-2 shadow-none focus-visible:border-input focus-visible:bg-background')}
                                            />
                                        </TableCell>
                                    ))}
                                    <TableCell className="align-top">
                                        <Button type="button" size="icon" variant="ghost" className="size-8 text-muted-foreground hover:text-destructive"
                                            onClick={() => removeRow(index)} aria-label={`Quitar a ${who}`}>
                                            <Trash2 className="size-4" aria-hidden="true" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>
            {filtered.length > ROW_LIMIT ? (
                <p className="text-xs text-muted-foreground">
                    Mostramos las primeras {ROW_LIMIT} de {filtered.length.toLocaleString('es-CL')} filas. Las demás se importan igual si están listas.
                </p>
            ) : null}

            <div className="sticky bottom-3 z-20 flex flex-col-reverse gap-2 rounded-2xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
                <Button type="button" variant="ghost" onClick={onBack} disabled={isSubmitting}>
                    <ArrowLeft className="size-4" aria-hidden="true" />Volver a las columnas
                </Button>
                <Button type="button" onClick={() => onSubmit(rows)} disabled={ready === 0 || isSubmitting} aria-busy={isSubmitting}>
                    {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Upload className="size-4" aria-hidden="true" />}
                    {isSubmitting ? 'Importando…' : `Importar ${contacts(ready)}`}
                </Button>
            </div>
        </div>
    );
}
