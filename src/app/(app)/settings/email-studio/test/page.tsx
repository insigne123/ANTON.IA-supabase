'use client';

import { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Send, RefreshCw, Eye, CheckCircle2, XCircle, MailOpen, MousePointerClick } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/context/AuthContext';
import { contactedLeadsStorage } from '@/lib/services/contacted-leads-service';
import type { ContactedLead } from '@/lib/types';

export default function EmailTestPage() {
    const { toast } = useToast();
    const { user } = useAuth();

    const [loading, setLoading] = useState(false);
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [subject, setSubject] = useState('Prueba de Tracking - Email Studio');
    const [body, setBody] = useState('Hola,\n\nEste es un correo de prueba.\nHaz clic en este enlace para probar el tracking: https://example.com');

    const [useGmail, setUseGmail] = useState(true);
    // Tracking Options
    const [usePixel, setUsePixel] = useState(true);
    const [useLinkTracking, setUseLinkTracking] = useState(true);
    const [useReadReceipt, setUseReadReceipt] = useState(false);

    const [logs, setLogs] = useState<ContactedLead[]>([]);
    const [refreshing, setRefreshing] = useState(false);
    const [debugResult, setDebugResult] = useState<any>(null);

    useEffect(() => {
        if (user?.email) setFrom(user.email);
    }, [user]);

    const refreshLogs = useCallback(async () => {
        setRefreshing(true);
        try {
            const all = await contactedLeadsStorage.get();
            const relevant = all.filter(x => to ? (x.email === to) : true).sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
            setLogs(relevant.slice(0, 50));
        } catch (e) {
            console.error(e);
        } finally {
            setRefreshing(false);
        }
    }, [to]);

    useEffect(() => {
        refreshLogs();
    }, [refreshLogs]);

    // Helper to inject link tracking
    function rewriteLinksForTracking(html: string, trackingId: string): string {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        // Capture quote in group 1, URL in group 2
        return html.replace(/href=(["'])(http[^"']+)\1/gi, (match, quote, url) => {
            // Avoid rewriting tracking links themselves if already present
            if (url.includes('/api/tracking/click')) return match;
            const trackingUrl = `${origin}/api/tracking/click?id=${trackingId}&url=${encodeURIComponent(url)}`;
            return `href=${quote}${trackingUrl}${quote}`;
        });
    }

    async function handleSend() {
        const message = 'Los envíos de prueba sin un borrador aprobado ya no están disponibles. Usa Investigación y Revisar correo para realizar un envío manual.';
        toast({ title: 'Revisión requerida', description: message });
        setDebugResult({ success: false, error: message });
    }

    return (
        <div className="space-y-6 pb-20">
            <PageHeader
                title="Email Tester & Tracking Inspector"
                description="Consulta eventos recientes. Los envíos se realizan solo desde un borrador aprobado."
            />

            <div className="grid gap-6 lg:grid-cols-2">
                {/* SENDER */}
                <Card className="h-fit">
                    <CardHeader>
                        <CardTitle>Componer Prueba</CardTitle>
                            <CardDescription>Prepara una referencia de prueba sin enviar contenido directamente.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>De (Remitente)</Label>
                                <Input value={from} disabled placeholder="Detectando..." className="bg-muted" />
                            </div>
                            <div className="space-y-2">
                                <Label>Para</Label>
                                <Input value={to} onChange={e => setTo(e.target.value)} placeholder="tu@email.com" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Asunto</Label>
                            <Input value={subject} onChange={e => setSubject(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>Cuerpo (Texto)</Label>
                            <Textarea
                                value={body}
                                onChange={e => setBody(e.target.value)}
                                className="h-32"
                                placeholder="Escribe tu mensaje aquí..."
                            />
                        </div>

                        {/* Tracking Options */}
                        <div className="flex flex-col gap-2 p-3 bg-muted/20 border rounded-md">
                            <div className="text-xs font-semibold text-muted-foreground mb-1">Opciones de Rastreo</div>
                            <div className="flex items-center space-x-2">
                                <Switch checked={usePixel} onCheckedChange={setUsePixel} id="use-pixel" />
                                <Label htmlFor="use-pixel" className="text-sm font-normal cursor-pointer">Pixel de Apertura</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <Switch checked={useLinkTracking} onCheckedChange={setUseLinkTracking} id="use-links" />
                                <Label htmlFor="use-links" className="text-sm font-normal cursor-pointer">Rastreo de Clicks</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <Switch checked={useReadReceipt} onCheckedChange={setUseReadReceipt} id="use-receipts" />
                                <Label htmlFor="use-receipts" className="text-sm font-normal cursor-pointer">Confirmación de Lectura</Label>
                            </div>
                        </div>

                        <div className="flex items-center space-x-2 pt-2">
                            <Switch checked={useGmail} onCheckedChange={setUseGmail} id="use-gmail" />
                            <Label htmlFor="use-gmail">Enviar vía Gmail API</Label>
                        </div>

                        <Button onClick={handleSend} disabled={loading} variant="outline" className="w-full">
                            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                            Revisión requerida para enviar
                        </Button>

                        {/* Debug Result Mini View */}
                        {debugResult && (
                            <div className={`mt-4 p-3 rounded-md text-sm border ${debugResult.success ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                                {debugResult.success ? (
                                    <div className="flex flex-col gap-2">
                                        <div className="flex items-center gap-2">
                                            <CheckCircle2 className="h-4 w-4" />
                                            <span>Enviado. Tracking ID: <span className="font-mono text-xs">{debugResult.trackingId?.slice(0, 8)}...</span></span>
                                        </div>
                                        <div className="text-xs mt-1 border-t border-green-200 pt-1">
                                            <p className="font-semibold mb-1">Diagnóstico:</p>
                                            <a
                                                href={`/api/tracking/open?id=${debugResult.trackingId}`}
                                                target="_blank"
                                                className="underline text-blue-600 hover:text-blue-800 block"
                                            >
                                                1. Click para Simular Apertura (Browser Directo)
                                            </a>
                                            <span className="text-muted-foreground block mt-1">
                                                Si este funciona pero Gmail no, es culpa de Gmail/Cache.
                                            </span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <XCircle className="h-4 w-4" />
                                        <span>Error: {debugResult?.error?.toString()}</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* LOGS */}
                <Card className="h-full flex flex-col min-h-[500px]">
                    <CardHeader className="flex flex-row items-center justify-between pb-2 bg-muted/20">
                        <div>
                            <CardTitle>Historial de Eventos</CardTitle>
                            <CardDescription>Monitoreo en tiempo real {to ? `para: ${to}` : '(Todos)'}</CardDescription>
                        </div>
                        <Button variant="ghost" size="sm" onClick={refreshLogs} disabled={refreshing}>
                            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                        </Button>
                    </CardHeader>
                    <CardContent className="flex-1 overflow-auto p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[100px]">Estado</TableHead>
                                    <TableHead>Eventos / Info</TableHead>
                                    <TableHead className="text-right">Hora</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {logs.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={3} className="text-center h-32 text-muted-foreground">
                                            No hay registros recientes.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    logs.map((log) => (
                                        <TableRow key={log.id}>
                                            <TableCell className="align-top py-3">
                                                <Badge variant={log.status === 'replied' ? 'default' : 'outline'} className="capitalize">
                                                    {log.status === 'sent' ? 'Enviado' : log.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="align-top py-3">
                                                <div className="flex flex-col gap-2">
                                                    <div className="font-medium text-xs leading-tight">{log.subject}</div>
                                                    <div className="text-[10px] text-muted-foreground">{log.email}</div>
                                                    <div className="flex flex-wrap gap-2 mt-1">
                                                        {log.openedAt ? (
                                                            <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-800 hover:bg-green-200 border-none px-1.5 py-0.5 h-auot">
                                                                <MailOpen className="h-3 w-3 mr-1" /> Abierto
                                                            </Badge>
                                                        ) : null}

                                                        {(log.clickCount || 0) > 0 ? (
                                                            <Badge variant="secondary" className="text-[10px] bg-blue-100 text-blue-800 hover:bg-blue-200 border-none px-1.5 py-0.5 h-auto">
                                                                <MousePointerClick className="h-3 w-3 mr-1" /> Click ({log.clickCount})
                                                            </Badge>
                                                        ) : null}
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right text-[10px] text-muted-foreground align-top py-3 whitespace-nowrap">
                                                {new Date(log.sentAt).toLocaleTimeString()}
                                                <div className="text-[9px]">{new Date(log.sentAt).toLocaleDateString()}</div>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
