'use client';

import { useState, useEffect } from 'react';
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
    const [body, setBody] = useState('<p>Hola,</p><p>Este es un correo de prueba.</p><p>Haz clic en este enlace para probar el tracking: <a href="https://example.com">Ejemplo.com</a></p>');

    const [useGmail, setUseGmail] = useState(true);
    const [logs, setLogs] = useState<ContactedLead[]>([]);
    const [refreshing, setRefreshing] = useState(false);
    const [debugResult, setDebugResult] = useState<any>(null);

    useEffect(() => {
        if (user?.email) setFrom(user.email);
    }, [user]);

    useEffect(() => {
        refreshLogs();
    }, [to]); // Auto-refresh when target email changes

    async function refreshLogs() {
        setRefreshing(true);
        try {
            const all = await contactedLeadsStorage.get();
            // Filter by the email we are testing with or a generic fallback for unrelated tests
            const relevant = all.filter(x => to ? (x.email === to) : true).sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
            setLogs(relevant.slice(0, 50)); // Limit to 50
        } catch (e) {
            console.error(e);
        } finally {
            setRefreshing(false);
        }
    }

    // Simulación de lo que pasará con los links
    const previewInjection = () => {
        let html = body;
        const pixel = `<img src="https://.../api/tracking/pixel.png?id=TEST_ID" alt="" width="1" height="1" style="display:none;" />`;
        if (/<\/body>/i.test(html)) {
            html = html.replace(/<\/body>/i, `${pixel}</body>`);
        } else {
            html += pixel;
        }

        html = html.replace(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"([^>]*)>/gim, (match, url, extras) => {
            return `<a href="https://.../api/tracking/click?url=${encodeURIComponent(url)}&id=TEST_ID" ${extras}>`;
        });

        return html;
    };

    async function handleSend() {
        if (!to) return toast({ variant: 'destructive', title: 'Falta destinatario' });
        if (!from) return toast({ variant: 'destructive', title: 'Falta remitente', description: 'No se pudo detectar tu email.' });

        setLoading(true);
        setDebugResult(null);

        try {
            const endpoint = useGmail ? '/api/gmail/send' : '/api/providers/send';

            const payload: any = {
                to: useGmail ? to : [to], // Normalize for different endpoints if needed
                from, // IMPORTANT: Added 'from' to fix the error
                subject,
                html: body,
                // For providers endpoint
                provider: useGmail ? 'google' : 'outlook',
                htmlBody: body,
                organizationId: undefined
            };

            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const data = await res.json();

            if (!res.ok) throw new Error(data.error || 'Error enviando correo');

            toast({ title: 'Correo enviado', description: 'Revisa tu bandeja.' });

            setDebugResult({
                success: true,
                provider: useGmail ? 'Gmail API' : 'Outlook/Provider',
                sentTo: to,
                simulation: previewInjection(),
            });

            // Manually add to storage for tracking because the API endpoints don't do it automatically
            // (The main app does it in Client.tsx)
            await contactedLeadsStorage.add({
                id: undefined,
                leadId: 'test-' + Date.now(), // Fake ID
                name: 'Usuario Test',
                email: to,
                company: 'Test Corp',
                subject,
                sentAt: new Date().toISOString(),
                status: 'sent',
                provider: useGmail ? 'gmail' : 'outlook',
                messageId: data.id,
                threadId: data.threadId,
                clickCount: 0,
                role: 'Tester',
                industry: 'Test',
                city: 'Test City',
                country: 'Test Country'
            } as any);

            refreshLogs();

        } catch (e: any) {
            toast({ variant: 'destructive', title: 'Error', description: e.message });
            setDebugResult({ success: false, error: e.message });
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="space-y-6 pb-20">
            <PageHeader
                title="Email Tester & Tracking Inspector"
                description="Envía correos reales y monitorea en vivo si el pixel y los links funcionan."
            />

            <div className="grid gap-6 lg:grid-cols-2">
                {/* SENDER */}
                <Card className="h-fit">
                    <CardHeader>
                        <CardTitle>Componer Prueba</CardTitle>
                        <CardDescription>Envía un correo real.</CardDescription>
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
                            <Label>Cuerpo (HTML)</Label>
                            <Textarea
                                value={body}
                                onChange={e => setBody(e.target.value)}
                                className="font-mono text-xs h-32"
                            />
                            <p className="text-[10px] text-muted-foreground">
                                Tip: Usa <code>&lt;a href="..."&gt;Link&lt;/a&gt;</code> para probar clicks.
                            </p>
                        </div>

                        <div className="flex items-center space-x-2 pt-2">
                            <Switch checked={useGmail} onCheckedChange={setUseGmail} id="use-gmail" />
                            <Label htmlFor="use-gmail">Enviar vía Gmail API</Label>
                        </div>

                        <Button onClick={handleSend} disabled={loading} className="w-full">
                            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                            Enviar Prueba y Registrar
                        </Button>

                        {/* Debug Result Mini View */}
                        {debugResult && (
                            <div className={`mt-4 p-3 rounded-md text-sm border ${debugResult.success ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                                {debugResult.success ? (
                                    <div className="flex items-center gap-2">
                                        <CheckCircle2 className="h-4 w-4" />
                                        <span>Enviado correctamente. Revisa la tabla de la derecha.</span>
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
