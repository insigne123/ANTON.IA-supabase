'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Check, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CsvUploader, type CsvRawRow } from '@/components/csv-importer/csv-uploader';
import { ColumnMapper } from '@/components/csv-importer/column-mapper';
import { DataReviewGrid } from '@/components/csv-importer/data-review-grid';
import {
    csvImportSummary, csvRowToEnrichedLead, csvRowToLead, planCsvImport, rowsFromMapping, type ColumnMapping, type CsvImportResult,
    type CsvLeadInput,
} from '@/lib/csv-import-utils';
import { contactedKeys } from '@/lib/search/lead-ui';
import { contactedLeadsStorage } from '@/lib/services/contacted-leads-service';
import { enrichedLeadsStorage } from '@/lib/services/enriched-leads-service';
import { supabaseService } from '@/lib/supabase-service';
import { cn } from '@/lib/utils';

type Step = 'upload' | 'map' | 'review' | 'done';

const STEPS: Array<{ id: Exclude<Step, 'done'>; label: string }> = [
    { id: 'upload', label: 'Archivo' },
    { id: 'map', label: 'Columnas' },
    { id: 'review', label: 'Revisión' },
];
const ORDER: Step[] = ['upload', 'map', 'review', 'done'];

/**
 * «Importar contactos» (Plan 9): a CSV in three steps. Rows with an email or a phone go to «Por escribir» and the rest to
 * «Por completar», like contacts saved from Búsqueda; people already contacted are left out, and the end says what
 * happened with real counts.
 */
export default function ImportLeadsPage() {
    const [step, setStep] = useState<Step>('upload');
    const [fileName, setFileName] = useState('');
    const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
    const [rawRows, setRawRows] = useState<CsvRawRow[]>([]);
    const [reviewRows, setReviewRows] = useState<CsvLeadInput[]>([]);
    const [contactedEmails, setContactedEmails] = useState<Set<string> | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState('');
    const [result, setResult] = useState<CsvImportResult | null>(null);

    const restart = () => {
        setStep('upload');
        setFileName('');
        setCsvHeaders([]);
        setRawRows([]);
        setReviewRows([]);
        setContactedEmails(null);
        setSubmitError('');
        setResult(null);
    };

    const handleSubmit = async (rows: CsvLeadInput[]) => {
        setIsSubmitting(true);
        setSubmitError('');
        try {
            // Nobody is written twice: whoever was already contacted stays out of the lists.
            const contacted = await contactedLeadsStorage.get();
            const plan = planCsvImport(rows, contactedKeys(contacted));
            const now = new Date().toISOString();
            const enriched = plan.porEscribir.length
                ? await enrichedLeadsStorage.addDedup(plan.porEscribir.map((row) => csvRowToEnrichedLead(row, crypto.randomUUID(), now)))
                : { addedCount: 0, duplicateCount: 0 };
            const saved = plan.porCompletar.length
                ? await supabaseService.addLeadsDedup(plan.porCompletar.map((row) => csvRowToLead(row, crypto.randomUUID())))
                : { addedCount: 0, duplicateCount: 0 };
            setResult({
                porEscribir: enriched.addedCount,
                porCompletar: saved.addedCount,
                duplicates: enriched.duplicateCount + saved.duplicateCount,
                alreadyContacted: plan.alreadyContacted.length,
            });
            setStep('done');
        } catch (error) {
            console.error('[import] failed', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
            setSubmitError('Revisa tu conexión e inténtalo de nuevo. Los contactos que alcanzaron a guardarse no se van a duplicar.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const current = ORDER.indexOf(step);
    const summary = result ? csvImportSummary(result) : null;

    return (
        <div className="mx-auto max-w-5xl space-y-6 pb-20">
            <PageHeader
                title="Importar contactos"
                description="Sube un CSV: quienes traen correo o teléfono quedan en «Por escribir» y el resto en «Por completar», donde puedes buscar su correo."
                back={{ href: '/sheet', label: 'Tabla de datos' }}
            />

            <ol className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm" aria-label="Pasos de la importación">
                {STEPS.map((item, index) => {
                    const done = current > index;
                    const active = current === index;
                    return (
                        <li key={item.id} className="flex items-center gap-2" aria-current={active ? 'step' : undefined}>
                            {index > 0 ? <span className="h-px w-6 bg-border" aria-hidden="true" /> : null}
                            <span className={cn(
                                'flex size-6 items-center justify-center rounded-full border text-xs font-medium',
                                done || active ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground/70',
                            )}>
                                {done ? <Check className="size-3.5" aria-hidden="true" /> : index + 1}
                            </span>
                            <span className={active ? 'font-semibold text-foreground' : 'text-foreground/70'}>
                                {item.label}{done ? <span className="sr-only"> (listo)</span> : null}
                            </span>
                        </li>
                    );
                })}
                {fileName && step !== 'upload' ? <li className="w-full truncate text-xs text-muted-foreground sm:ml-auto sm:w-auto">{fileName}</li> : null}
            </ol>

            {submitError ? (
                <Alert variant="destructive">
                    <AlertCircle className="size-4" aria-hidden="true" />
                    <AlertTitle>No pudimos terminar la importación</AlertTitle>
                    <AlertDescription>{submitError}</AlertDescription>
                </Alert>
            ) : null}

            <Card>
                <CardContent className="p-4 sm:p-6">
                    {step === 'upload' && (
                        <CsvUploader onDataParsed={(headers, rows, name) => {
                            setCsvHeaders(headers);
                            setRawRows(rows);
                            setFileName(name);
                            setStep('map');
                        }} />
                    )}

                    {step === 'map' && (
                        <ColumnMapper
                            csvHeaders={csvHeaders}
                            sampleRows={rawRows}
                            onCancel={restart}
                            onConfirm={(mapping: ColumnMapping[]) => {
                                setReviewRows(rowsFromMapping(rawRows, mapping));
                                setStep('review');
                                // The review marks who was already contacted; the import checks again before saving.
                                contactedLeadsStorage.get()
                                    .then((contacted) => setContactedEmails(contactedKeys(contacted)))
                                    .catch(() => setContactedEmails(null));
                            }}
                        />
                    )}

                    {step === 'review' && (
                        <DataReviewGrid initialRows={reviewRows} contactedEmails={contactedEmails} onBack={() => setStep('map')} onSubmit={(rows) => void handleSubmit(rows)} isSubmitting={isSubmitting} />
                    )}

                    {step === 'done' && result && summary && (
                        <section aria-labelledby="import-done-title" className="space-y-4">
                            <div className="flex items-start gap-3">
                                <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-cw-success" aria-hidden="true" />
                                <div>
                                    <h2 id="import-done-title" className="text-lg font-semibold">{summary.title}</h2>
                                    <ul className="mt-2 space-y-1 text-sm leading-6 text-foreground/80">
                                        {result.porEscribir > 0 ? <li><strong>{result.porEscribir}</strong> en «Por escribir»: tienen correo o teléfono, listos para investigar y escribirles.</li> : null}
                                        {result.porCompletar > 0 ? <li><strong>{result.porCompletar}</strong> en «Por completar»: busca su correo desde ahí.</li> : null}
                                        {summary.notes.map((note) => <li key={note}>{note}</li>)}
                                    </ul>
                                </div>
                            </div>
                            <div className="flex flex-col gap-2 sm:flex-row">
                                {result.porEscribir > 0 ? <Button asChild><Link href="/saved/leads/enriched">Ir a Por escribir</Link></Button> : null}
                                {result.porCompletar > 0 ? (
                                    <Button asChild variant={result.porEscribir > 0 ? 'outline' : 'default'}><Link href="/saved/leads">Ir a Por completar</Link></Button>
                                ) : null}
                                <Button type="button" variant="ghost" onClick={restart}>Importar otro archivo</Button>
                            </div>
                        </section>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
