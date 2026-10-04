'use client';

import { useState } from 'react';
import { AlertCircle, ArrowRight, Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
    AVAILABLE_FIELDS, assignField, guessMapping, mappingHasEmail, mappingHasName, type ColumnMapping, type CsvLeadField,
} from '@/lib/csv-import-utils';
import type { CsvRawRow } from './csv-uploader';

interface ColumnMapperProps {
    csvHeaders: string[];
    sampleRows: CsvRawRow[];
    onConfirm: (mapping: ColumnMapping[]) => void;
    onCancel: () => void;
}

const sampleOf = (rows: CsvRawRow[], header: string) => {
    for (const row of rows.slice(0, 5)) {
        const value = String(row[header] ?? '').trim();
        if (value) return value;
    }
    return '';
};

/**
 * Step 2: what each column holds. Each column comes with a guess and an example from the file; a field goes to one column
 * only, and the import needs at least the name.
 */
export function ColumnMapper({ csvHeaders, sampleRows, onConfirm, onCancel }: ColumnMapperProps) {
    const [mapping, setMapping] = useState<ColumnMapping[]>(() => guessMapping(csvHeaders));
    const hasName = mappingHasName(mapping);
    const hasEmail = mappingHasEmail(mapping);

    return (
        <div className="space-y-5">
            <div>
                <h2 className="text-lg font-semibold">¿Qué tiene cada columna?</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Propusimos un campo para cada columna según su nombre. Corrige lo que no calce; lo que no necesites queda en «No importar».
                </p>
            </div>

            <ul className="divide-y divide-border rounded-2xl border border-border" aria-label="Columnas del archivo">
                {mapping.map((item, index) => {
                    const sample = sampleOf(sampleRows, item.csvHeader);
                    return (
                        <li key={`${index}-${item.csvHeader}`} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,240px)] sm:items-center sm:gap-4 sm:p-4">
                            <div className="min-w-0">
                                <p className="truncate font-medium" title={item.csvHeader}>{item.csvHeader}</p>
                                <p className="truncate text-xs text-muted-foreground" title={sample || undefined}>
                                    {sample ? `Ej.: ${sample}` : 'Vacía en las primeras filas'}
                                </p>
                            </div>
                            <ArrowRight className="hidden size-4 text-muted-foreground sm:block" aria-hidden="true" />
                            <Select
                                value={item.leadField}
                                onValueChange={(value) => setMapping((current) => assignField(current, item.csvHeader, value as CsvLeadField | 'ignore'))}
                            >
                                <SelectTrigger aria-label={`Campo para la columna ${item.csvHeader}`} className={item.leadField === 'ignore' ? 'text-muted-foreground' : undefined}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ignore">No importar</SelectItem>
                                    {AVAILABLE_FIELDS.map((field) => <SelectItem key={field.value} value={field.value}>{field.label}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </li>
                    );
                })}
            </ul>

            {!hasName ? (
                <Alert variant="warning">
                    <AlertCircle className="size-4" aria-hidden="true" />
                    <AlertDescription>Elige la columna del nombre, o la del nombre y la del apellido, para continuar.</AlertDescription>
                </Alert>
            ) : !hasEmail ? (
                <Alert variant="info">
                    <Info className="size-4" aria-hidden="true" />
                    <AlertDescription>Sin columna de correo, quienes tengan teléfono van a «Por escribir» y el resto a «Por completar», donde puedes buscar su correo.</AlertDescription>
                </Alert>
            ) : null}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <Button type="button" variant="ghost" onClick={onCancel}>Elegir otro archivo</Button>
                <Button type="button" onClick={() => onConfirm(mapping)} disabled={!hasName}>
                    Revisar contactos<ArrowRight className="size-4" aria-hidden="true" />
                </Button>
            </div>
        </div>
    );
}
