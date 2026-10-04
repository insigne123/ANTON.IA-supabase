'use client';

import { useCallback, useRef, useState } from 'react';
import Papa from 'papaparse';
import { AlertCircle, Download, FileText, Loader2, Upload } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CSV_IMPORT_MAX_ROWS, CSV_TEMPLATE } from '@/lib/csv-import-utils';
import { cn } from '@/lib/utils';

export type CsvRawRow = Record<string, unknown>;

interface CsvUploaderProps {
    onDataParsed: (headers: string[], rows: CsvRawRow[], fileName: string) => void;
}

const MAX_ROWS_LABEL = CSV_IMPORT_MAX_ROWS.toLocaleString('es-CL');

/**
 * Step 1 of «Importar contactos»: drop a CSV or pick it with «Elegir archivo» (a real button, so it works with the
 * keyboard), with a template to start from.
 */
export function CsvUploader({ onDataParsed }: CsvUploaderProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isParsing, setIsParsing] = useState(false);

    const handleFile = useCallback((file: File) => {
        setError(null);
        if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
            setError('Ese archivo no es un CSV. En Excel o Google Sheets, guárdalo o descárgalo como CSV.');
            return;
        }
        setIsParsing(true);
        Papa.parse<CsvRawRow>(file, {
            header: true,
            skipEmptyLines: 'greedy',
            transformHeader: (header) => header.trim(),
            complete: (results) => {
                setIsParsing(false);
                const headers = (results.meta.fields || []).filter(Boolean);
                if (results.data.length === 0 || headers.length === 0) {
                    setError('El archivo no tiene filas con datos.');
                    return;
                }
                if (results.data.length > CSV_IMPORT_MAX_ROWS) {
                    setError(`El archivo tiene ${results.data.length.toLocaleString('es-CL')} filas. Importa hasta ${MAX_ROWS_LABEL} por vez: divídelo en partes.`);
                    return;
                }
                onDataParsed(headers, results.data, file.name);
            },
            error: () => {
                setIsParsing(false);
                setError('No pudimos leer el archivo. Revisa que sea un CSV con los nombres de las columnas en la primera fila.');
            },
        });
    }, [onDataParsed]);

    const downloadTemplate = () => {
        const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'plantilla-contactos.csv';
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    return (
        <div className="space-y-4">
            <div
                className={cn(
                    'flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-5 py-8 text-center transition-colors sm:p-10',
                    isDragOver ? 'border-primary bg-cw-accent-soft' : 'border-border',
                )}
                onDrop={(event) => {
                    event.preventDefault();
                    setIsDragOver(false);
                    const file = event.dataTransfer.files[0];
                    if (file) handleFile(file);
                }}
                onDragOver={(event) => { event.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
            >
                <input
                    ref={inputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    tabIndex={-1}
                    aria-hidden="true"
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (file) handleFile(file);
                    }}
                />
                <span className="mb-4 flex size-14 items-center justify-center rounded-full bg-cw-accent-soft text-primary">
                    <Upload className="size-7" aria-hidden="true" />
                </span>
                <h2 className="text-lg font-semibold">Sube tu archivo CSV</h2>
                <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                    Arrástralo aquí o elígelo desde tu equipo. La primera fila debe tener los nombres de las columnas: nombre, correo, empresa…
                </p>
                <div className="mt-5 flex w-full flex-col justify-center gap-2 sm:w-auto sm:flex-row">
                    <Button type="button" onClick={() => inputRef.current?.click()} disabled={isParsing} aria-busy={isParsing}>
                        {isParsing ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <FileText className="size-4" aria-hidden="true" />}
                        {isParsing ? 'Leyendo el archivo…' : 'Elegir archivo'}
                    </Button>
                    <Button type="button" variant="outline" onClick={downloadTemplate}>
                        <Download className="size-4" aria-hidden="true" />Descargar plantilla
                    </Button>
                </div>
                <p className="mt-4 text-xs leading-5 text-muted-foreground">
                    ¿Tienes un Excel? Guárdalo como «CSV UTF-8». Hasta {MAX_ROWS_LABEL} contactos por archivo.
                </p>
            </div>

            {error && (
                <Alert variant="destructive">
                    <AlertCircle className="size-4" aria-hidden="true" />
                    <AlertTitle>No pudimos usar ese archivo</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}
        </div>
    );
}
