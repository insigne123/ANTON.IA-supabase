'use client';

import { useState, useCallback } from 'react';
import Papa from 'papaparse';
import { Upload, X, FileText, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface CsvUploaderProps {
    onDataParsed: (headers: string[], data: any[]) => void;
}

export function CsvUploader({ onDataParsed }: CsvUploaderProps) {
    const [isDragOver, setIsDragOver] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isParsing, setIsParsing] = useState(false);

    const handleFile = useCallback((file: File) => {
        setError(null);
        if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
            setError('Por favor sube un archivo CSV válido.');
            return;
        }

        setIsParsing(true);
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                setIsParsing(false);
                if (results.errors.length > 0) {
                    console.warn('CSV Errors:', results.errors);
                }
                if (results.data.length === 0) {
                    setError('El archivo parece estar vacío.');
                    return;
                }
                const headers = results.meta.fields || Object.keys(results.data[0] || {});
                onDataParsed(headers, results.data);
            },
            error: (err) => {
                setIsParsing(false);
                setError('Error al leer el archivo: ' + err.message);
            }
        });
    }, [onDataParsed]);

    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    };

    const onDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(true);
    };

    const onDragLeave = () => setIsDragOver(false);

    return (
        <div className="space-y-4">
            <div
                className={`border-2 border-dashed rounded-lg p-10 flex flex-col items-center justify-center transition-colors cursor-pointer ${isDragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'}`}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onClick={() => document.getElementById('csv-upload-input')?.click()}
            >
                <input
                    type="file"
                    id="csv-upload-input"
                    className="hidden"
                    accept=".csv"
                    onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                />
                <div className="bg-primary/10 p-4 rounded-full mb-4">
                    <Upload className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-lg font-semibold">Sube tu archivo CSV</h3>
                <p className="text-sm text-muted-foreground mt-2 text-center max-w-sm">
                    Arrastra y suelta tu archivo aquí, o haz clic para explorar.
                    <br />
                    (Asegúrate de que tenga encabezados claros)
                </p>
            </div>

            {error && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {isParsing && (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground animate-pulse">
                    <FileText className="w-4 h-4" /> Procesando archivo...
                </div>
            )}
        </div>
    );
}
