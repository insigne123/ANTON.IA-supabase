'use client';

import { useState, useMemo } from 'react';
import { CsvLeadInput, CsvLeadSchema, ColumnMapping } from '@/lib/csv-import-utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { AlertCircle, CheckCircle, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { z } from 'zod';

interface DataReviewGridProps {
    initialData: any[];
    mapping: ColumnMapping[];
    onBack: () => void;
    onSubmit: (cleanedData: CsvLeadInput[]) => void;
    isSubmitting: boolean;
}

export function DataReviewGrid({ initialData, mapping, onBack, onSubmit, isSubmitting }: DataReviewGridProps) {
    // 1. Convertir raw data a CsvLeadInput[] basado en el mapping
    const [rows, setRows] = useState<CsvLeadInput[]>(() => {
        return initialData.map(rawRow => {
            const lead: any = {};
            mapping.forEach(m => {
                if (m.leadField !== 'ignore') {
                    lead[m.leadField] = rawRow[m.csvHeader] || '';
                }
            });
            return lead as CsvLeadInput;
        });
    });

    const [editCell, setEditCell] = useState<{ rowIdx: number; field: keyof CsvLeadInput } | null>(null);

    // Validación fila por fila
    const validationResults = useMemo(() => {
        return rows.map(r => CsvLeadSchema.safeParse(r));
    }, [rows]);

    const validCount = validationResults.filter(r => r.success).length;
    const invalidCount = rows.length - validCount;

    const updateCell = (rowIdx: number, field: keyof CsvLeadInput, val: string) => {
        setRows(prev => {
            const next = [...prev];
            next[rowIdx] = { ...next[rowIdx], [field]: val };
            return next;
        });
    };

    const removeRow = (idx: number) => {
        setRows(prev => prev.filter((_, i) => i !== idx));
    };

    const handleFinish = () => {
        // Filtrar solo las filas válidas o enviar todo y dejar que el server decida? 
        // Mejor enviar solo válidas para evitar basura.
        const validRows = rows.filter(r => CsvLeadSchema.safeParse(r).success);
        if (validRows.length === 0) return;
        onSubmit(validRows);
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="font-semibold text-lg">Revisar Datos ({rows.length})</h3>
                    <div className="flex gap-3 text-sm">
                        <span className="text-green-600 flex items-center gap-1"><CheckCircle className="w-4 h-4" /> {validCount} Válidos</span>
                        {invalidCount > 0 && <span className="text-red-500 flex items-center gap-1"><AlertCircle className="w-4 h-4" /> {invalidCount} Con Errores</span>}
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={onBack} disabled={isSubmitting}>Atrás</Button>
                    <Button onClick={handleFinish} disabled={validCount === 0 || isSubmitting}>
                        {isSubmitting ? 'Importando...' : `Importar ${validCount} Leads`}
                    </Button>
                </div>
            </div>

            <div className="border rounded-md max-h-[60vh] overflow-auto relative">
                <Table>
                    <TableHeader className="sticky top-0 bg-background z-10">
                        <TableRow>
                            <TableHead className="w-[50px]">Estado</TableHead>
                            <TableHead>Nombre</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Empresa</TableHead>
                            <TableHead>Cargo</TableHead>
                            <TableHead>LinkedIn</TableHead>
                            <TableHead className="w-[50px]"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map((row, i) => {
                            const validation = validationResults[i];
                            const errors = !validation.success ? validation.error.flatten().fieldErrors : {};
                            const hasErr = !validation.success;

                            return (
                                <TableRow key={i} className={cn(hasErr ? "bg-red-50/50" : "")}>
                                    <TableCell>
                                        {hasErr ? (
                                            <div className="text-red-500" title={JSON.stringify(errors)}>
                                                <AlertCircle className="w-5 h-5" />
                                            </div>
                                        ) : (
                                            <CheckCircle className="w-5 h-5 text-green-500/50" />
                                        )}
                                    </TableCell>

                                    {/* Nombre */}
                                    <EditableCell
                                        value={row.name}
                                        onChange={v => updateCell(i, 'name', v)}
                                        error={!!errors.name}
                                    />

                                    {/* Email */}
                                    <EditableCell
                                        value={row.email}
                                        onChange={v => updateCell(i, 'email', v)}
                                        error={!!errors.email}
                                    />

                                    {/* Empresa */}
                                    <EditableCell value={row.company} onChange={v => updateCell(i, 'company', v)} />

                                    {/* Cargo */}
                                    <EditableCell value={row.title} onChange={v => updateCell(i, 'title', v)} />

                                    {/* LinkedIn */}
                                    <EditableCell
                                        value={row.linkedinUrl}
                                        onChange={v => updateCell(i, 'linkedinUrl', v)}
                                        error={!!errors.linkedinUrl}
                                        placeholder="https://"
                                    />

                                    <TableCell>
                                        <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-red-500" onClick={() => removeRow(i)}>
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}

function EditableCell({ value, onChange, error, placeholder }: { value?: string, onChange: (v: string) => void, error?: boolean, placeholder?: string }) {
    return (
        <TableCell className="p-1">
            <Input
                className={cn(
                    "h-8 border-transparent focus-visible:bg-background focus-visible:border-input px-2 shadow-none",
                    error && "bg-red-100 text-red-900 border-red-200 focus-visible:border-red-500",
                    !value && "text-muted-foreground italic"
                )}
                value={value || ''}
                onChange={e => onChange(e.target.value)}
                placeholder={placeholder || '-'}
            />
        </TableCell>
    );
}
