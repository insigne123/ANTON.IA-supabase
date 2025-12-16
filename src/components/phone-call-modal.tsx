
'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Phone, CheckCircle2, UserX, Voicemail, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { EnrichedLead, LeadResearchReport } from '@/lib/types';
import { getCompanyProfile } from '@/lib/data';

type PhoneCallModalProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    lead: EnrichedLead | null;
    report: LeadResearchReport | null; // Reporte de investigación
    onLogCall: (result: 'connected' | 'voicemail' | 'wrong_number' | 'no_answer', notes: string) => void;
};

export function PhoneCallModal({ open, onOpenChange, lead, report, onLogCall }: PhoneCallModalProps) {
    const { toast } = useToast();
    const [loadingScript, setLoadingScript] = useState(false);
    const [script, setScript] = useState<{ opening: string; pitch: string; objections: string; closing: string } | null>(null);
    const [callResult, setCallResult] = useState<'connected' | 'voicemail' | 'wrong_number' | 'no_answer'>('connected');
    const [notes, setNotes] = useState('');

    useEffect(() => {
        if (open && lead) {
            // Reset state
            setScript(null);
            setNotes('');
            setCallResult('connected');

            // Auto-generate script if report exists
            if (report) {
                generateScript();
            }
        }
    }, [open, lead, report]);

    async function generateScript() {
        if (!lead || !report) return;
        setLoadingScript(true);
        try {
            const companyProfile = getCompanyProfile();
            const res = await fetch('/api/ai/generate-phone-script', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lead, report, companyProfile }),
            });
            if (!res.ok) throw new Error('Error generando guion');
            const data = await res.json();
            setScript(data);
        } catch (error) {
            console.error(error);
            toast({ variant: 'destructive', title: 'Error', description: 'No se pudo generar el guion IA.' });
        } finally {
            setLoadingScript(false);
        }
    }

    const handleSave = () => {
        onLogCall(callResult, notes);
        onOpenChange(false);
    };

    if (!lead) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0 gap-0">
                <DialogHeader className="px-6 py-4 border-b">
                    <div className="flex items-center gap-3">
                        <div className="bg-primary/10 p-2 rounded-full">
                            <Phone className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                            <DialogTitle>Llamada con {lead.fullName}</DialogTitle>
                            <DialogDescription>{lead.title} @ {lead.companyName}</DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                <div className="flex-1 flex overflow-hidden">
                    {/* Panel Izquierdo: Contexto rápido */}
                    <div className="w-1/3 border-r bg-muted/20 p-4 space-y-4 overflow-y-auto">
                        <div>
                            <h4 className="text-xs font-bold uppercase text-muted-foreground mb-1">Teléfonos</h4>
                            <div className="text-xl font-mono tracking-tight text-primary">
                                {lead.primaryPhone || 'Sin teléfono'}
                            </div>
                            {lead.phoneNumbers && lead.phoneNumbers.length > 1 && (
                                <div className="mt-1 text-xs text-muted-foreground space-y-1">
                                    {lead.phoneNumbers.slice(1).map((p, i) => (
                                        <div key={i}>{p.sanitized_number} ({p.type})</div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {report && (
                            <>
                                {report.cross?.pains?.length > 0 && (
                                    <div className="p-3 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-md">
                                        <h4 className="text-xs font-bold uppercase text-red-600 dark:text-red-400 mb-2">Pains Detectados</h4>
                                        <ul className="list-disc pl-4 text-xs space-y-1">
                                            {report.cross.pains.slice(0, 3).map((p: string, i: number) => <li key={i}>{p}</li>)}
                                        </ul>
                                    </div>
                                )}

                                <div className="space-y-2">
                                    <h4 className="text-xs font-bold uppercase text-muted-foreground">Datos Clave</h4>
                                    <div className="text-xs grid grid-cols-2 gap-2">
                                        <div className="border rounded p-2">
                                            <span className="block text-[10px] text-muted-foreground">Industria</span>
                                            {lead.industry || report.cross?.company?.industry || report.company?.industry || '-'}
                                        </div>
                                        <div className="border rounded p-2">
                                            <span className="block text-[10px] text-muted-foreground">Ubicación</span>
                                            {lead.city || lead.country || '-'}
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Panel Central/Derecho: Script y Log */}
                    <div className="w-2/3 flex flex-col">
                        <div className="flex-1 p-6 overflow-y-auto">
                            {!report ? (
                                <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
                                    <FileText className="h-10 w-10 mb-2 opacity-20" />
                                    <p>No hay reporte de investigación para generar guion.</p>
                                    <p className="text-xs mt-1">Investiga el lead primero para usar la IA.</p>
                                </div>
                            ) : loadingScript ? (
                                <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-3">
                                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                    <p className="text-sm">La IA está escribiendo tu guion personalizado...</p>
                                </div>
                            ) : script ? (
                                <Tabs defaultValue="opening" className="w-full">
                                    <TabsList className="grid w-full grid-cols-4 mb-4">
                                        <TabsTrigger value="opening">1. Apertura</TabsTrigger>
                                        <TabsTrigger value="pitch">2. Pitch</TabsTrigger>
                                        <TabsTrigger value="objections">3. Objeciones</TabsTrigger>
                                        <TabsTrigger value="closing">4. Cierre</TabsTrigger>
                                    </TabsList>

                                    <TabsContent value="opening" className="space-y-4 animate-in fade-in slide-in-from-left-2">
                                        <div className="prose dark:prose-invert">
                                            <p className="text-lg font-medium text-primary">"Hola {lead.fullName.split(' ')[0]}..."</p>
                                            <div className="bg-muted p-4 rounded-md italic border-l-4 border-primary">
                                                {script.opening}
                                            </div>
                                        </div>
                                    </TabsContent>
                                    <TabsContent value="pitch" className="space-y-4 animate-in fade-in slide-in-from-left-2">
                                        <div className="p-4 bg-blue-50 dark:bg-blue-900/10 rounded-lg">
                                            <h3 className="text-sm font-bold text-blue-700 dark:text-blue-300 mb-2 uppercase">Propuesta de Valor</h3>
                                            <p className="text-base leading-relaxed">{script.pitch}</p>
                                        </div>
                                    </TabsContent>
                                    <TabsContent value="objections" className="space-y-4 animate-in fade-in slide-in-from-left-2">
                                        <div className="prose dark:prose-invert text-sm">
                                            <ReactMarkdown>{script.objections}</ReactMarkdown>
                                        </div>
                                    </TabsContent>
                                    <TabsContent value="closing" className="space-y-4 animate-in fade-in slide-in-from-left-2">
                                        <div className="p-6 border-2 border-dashed rounded-xl text-center">
                                            <p className="text-xl font-semibold mb-2">Objetivo: Agendar Reunión</p>
                                            <p className="text-muted-foreground">{script.closing}</p>
                                        </div>
                                    </TabsContent>
                                </Tabs>
                            ) : (
                                <div className="text-center">
                                    <Button onClick={generateScript} variant="outline">Reintentar Generar Guion</Button>
                                </div>
                            )}
                        </div>

                        {/* Footer de Registro */}
                        <div className="border-t p-4 bg-muted/10 space-y-3">
                            <Textarea
                                placeholder="Notas de la llamada... (ej: 'Me pidió llamar el martes')"
                                value={notes}
                                onChange={e => setNotes(e.target.value)}
                                className="h-20 resize-none text-sm"
                            />
                            <div className="flex justify-between gap-4">
                                <Select value={callResult} onValueChange={(v: any) => setCallResult(v)}>
                                    <SelectTrigger className="w-[180px]">
                                        <SelectValue placeholder="Resultado" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="connected"><div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-500" /> Contestó</div></SelectItem>
                                        <SelectItem value="voicemail"><div className="flex items-center gap-2"><Voicemail className="h-4 w-4 text-orange-500" /> Buzón de voz</div></SelectItem>
                                        <SelectItem value="no_answer"><div className="flex items-center gap-2"><Phone className="h-4 w-4 text-red-500" /> No contestó</div></SelectItem>
                                        <SelectItem value="wrong_number"><div className="flex items-center gap-2"><UserX className="h-4 w-4 text-gray-500" /> Número equivocado</div></SelectItem>
                                    </SelectContent>
                                </Select>

                                <div className="flex gap-2">
                                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
                                    <Button onClick={handleSave}>Registrar Llamada</Button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function ReactMarkdown({ children }: { children: string }) {
    // Simple wrapper or use a library. For now simple rendering to avoid heavy deps if not present.
    // Assuming simple text, but if markdown is needed we can split by lines.
    return <div className="whitespace-pre-wrap">{children}</div>;
}

