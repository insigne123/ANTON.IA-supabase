'use client';

import { useCallback, useRef, useState } from 'react';
import Papa from 'papaparse';
import { AlertCircle, Download, FileSpreadsheet, FileText, Loader2, Upload } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CSV_IMPORT_MAX_ROWS, CSV_TEMPLATE } from '@/lib/csv-import-utils';
import type { SpreadsheetSheet } from '@/lib/spreadsheet-import';
import { cn } from '@/lib/utils';

export type CsvRawRow = Record<string, unknown>;

interface CsvUploaderProps {
    onDataParsed: (headers: string[], rows: CsvRawRow[], fileName: string) => void;
}

const MAX_ROWS_LABEL = CSV_IMPORT_MAX_ROWS.toLocaleString('es-CL');

/**
 * Step 1 of «Importar contactos»: drop a CSV or an Excel (.xlsx) file, or pick it with «Elegir archivo» (a real button,
 * so it works with the keyboard), with a template to start from. An Excel with several sheets asks which one to use.
 */
export function CsvUploader({ onDataParsed }: CsvUploaderProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isParsing, setIsParsing] = useState(false);
    const [sheets, setSheets] = useState<{ fileName: string; list: SpreadsheetSheet[] } | null>(null);

    const pickSheet = useCallback((sheet: SpreadsheetSheet, fileName: string) => {
        if (sheet.total > CSV_IMPORT_MAX_ROWS) {
            setError(`La hoja «${sheet.name}» tiene más de ${MAX_ROWS_LABEL} filas. Importa hasta ${MAX_ROWS_LABEL} por vez: divídela en partes.`);
            return;
        }
        setSheets(null);
        onDataParsed(sheet.headers, sheet.rows, fileName);
    }, [onDataParsed]);

    const handleExcel = useCallback(async (file: File) => {
        setIsParsing(true);
        try {
            // Loaded only when an Excel arrives: the CSV path never downloads the spreadsheet reader.
            const { readSpreadsheet } = await import('@/lib/spreadsheet-import');
            const list = readSpreadsheet(await file.arrayBuffer(), { maxRows: CSV_IMPORT_MAX_ROWS });
            if (list.length === 1) pickSheet(list[0], file.name);
            else setSheets({ fileName: file.name, list });
        } catch (failure) {
            setError(failure instanceof Error && failure.name === 'SpreadsheetError' ? failure.message : 'No pudimos leer el Excel. Prueba guardándolo como CSV.');
        } finally {
            setIsParsing(false);
        }
    }, [pickSheet]);

    const handleFile = useCallback((file: File) => {
        setError(null);
        setSheets(null);
        if (file.size > 10 * 1024 * 1024) {
            setError('El archivo pasa de 10 MB. Deja solo las columnas de contacto o divídelo en partes.');
            return;
        }
        if (/\.xlsx$/i.test(file.name)) {
            void handleExcel(file);
            return;
        }
        if (/\.xls$/i.test(file.name)) {
            setError('Ese Excel es del formato antiguo (.xls). Ábrelo y guárdalo como .xlsx o como CSV.');
            return;
        }
        if (!/\.(csv|txt)$/i.test(file.name) && file.type !== 'text/csv') {
            setError('Sube un archivo CSV o Excel (.xlsx). Desde Google Sheets: Archivo → Descargar → .xlsx o .csv.');
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
    }, [onDataParsed, handleExcel]);

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
                    accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
                <h2 className="text-lg font-semibold">Sube tu lista en Excel o CSV</h2>
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
                    Sirve tal cual sale de Excel, Google Sheets o tu CRM (.xlsx o .csv). Hasta {MAX_ROWS_LABEL} contactos por archivo.
                </p>
            </div>

            {sheets ? (
                <section aria-labelledby="sheet-choice-title" className="rounded-2xl border border-border/70 p-4">
                    <h3 id="sheet-choice-title" className="text-sm font-semibold">¿Qué hoja importamos?</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{sheets.fileName} tiene {sheets.list.length} hojas con datos.</p>
                    <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                        {sheets.list.map((sheet) => (
                            <li key={sheet.name}>
                                <Button type="button" variant="outline" className="h-auto w-full justify-start gap-3 py-2 text-left" onClick={() => pickSheet(sheet, sheets.fileName)}>
                                    <FileSpreadsheet className="size-4 shrink-0 text-primary" aria-hidden="true" />
                                    <span className="min-w-0">
                                        <span className="block truncate font-medium">{sheet.name}</span>
                                        <span className="block truncate text-xs font-normal text-muted-foreground">
                                            {sheet.total.toLocaleString('es-CL')} filas · {sheet.headers.slice(0, 3).join(', ')}{sheet.headers.length > 3 ? '…' : ''}
                                        </span>
                                    </span>
                                </Button>
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}

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
