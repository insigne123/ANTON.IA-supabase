'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Send, Eye, CheckCircle2, XCircle } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

export default function EmailTestPage() {
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [to, setTo] = useState('');
    const [subject, setSubject] = useState('Prueba de Tracking - Email Studio');
    const [body, setBody] = useState('<p>Hola,</p><p>Este es un correo de prueba.</p><p>Haz clic en este enlace para probar el tracking: <a href="https://example.com">Ejemplo.com</a></p>');
    const [debugResult, setDebugResult] = useState<any>(null);

    const [useGmail, setUseGmail] = useState(true);

    // Simulación de lo que pasará con los links
    const previewInjection = () => {
        let html = body;
        // Simular inyección de pixel
        const pixel = `<img src="https://.../api/tracking/pixel.png?id=TEST_ID" alt="" width="1" height="1" style="display:none;" />`;
        if (/<\/body>/i.test(html)) {
            html = html.replace(/<\/body>/i, `${pixel}</body>`);
        } else {
            html += pixel;
        }

        // Simular conversión de links
        html = html.replace(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"([^>]*)>/gim, (match, url, extras) => {
            return `<a href="https://.../api/tracking/click?url=${encodeURIComponent(url)}&id=TEST_ID" ${extras}>`;
        });

        return html;
    };

    async function handleSend() {
        if (!to) return toast({ variant: 'destructive', title: 'Falta destinatario' });

        setLoading(true);
        setDebugResult(null);

        try {
            // Usamos el endpoint oficial de envío (Gmail) que ya tiene la lógica de inyección
            const endpoint = useGmail ? '/api/gmail/send' : '/api/providers/send'; // O Outlook si existiera endpoint dedicado

            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: [to],
                    subject,
                    html: body,
                    // Pasamos un flag para que el backend sepa que es prueba, si fuera necesario, 
                    // pero por ahora el backend trata todo igual, lo cual es BUENO para testing real.
                }),
            });

            const data = await res.json();

            if (!res.ok) throw new Error(data.error || 'Error enviando correo');

            toast({ title: 'Correo enviado', description: 'Revisa tu bandeja de entrada.' });
            setDebugResult({
                success: true,
                provider: useGmail ? 'Gmail API' : 'Outlook/Provider',
                sentTo: to,
                timestamp: new Date().toISOString(),
                // Nota: no podemos ver el HTML "final" real que salió del servidor a menos que el API lo devuelva.
                // Pero podemos mostrar la simulación.
                simulation: previewInjection(),
            });

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
                title="Email Tester"
                description="Prueba el envío, la conversión de enlaces y el pixel de seguimiento."
            />

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Componer Prueba</CardTitle>
                        <CardDescription>Envía un correo real para verificar la entrega.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label>Destinatario</Label>
                            <Input value={to} onChange={e => setTo(e.target.value)} placeholder="tu@email.com" />
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
                                className="font-mono text-xs h-40"
                            />
                            <p className="text-xs text-muted-foreground">Incluye al menos un &lt;a href="..."&gt; para probar clicks.</p>
                        </div>

                        <div className="flex items-center space-x-2 pt-2">
                            <Switch checked={useGmail} onCheckedChange={setUseGmail} id="use-gmail" />
                            <Label htmlFor="use-gmail">Usar API de Gmail (Desactivado = Outlook/Default)</Label>
                        </div>

                        <Button onClick={handleSend} disabled={loading} className="w-full">
                            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                            Enviar Prueba
                        </Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Resultado / Debug</CardTitle>
                        <CardDescription>Análisis de lo enviado.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {!debugResult ? (
                            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
                                <Eye className="h-8 w-8 mb-2 opacity-50" />
                                <p>Envía un correo para ver los detalles.</p>
                            </div>
                        ) : (
                            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                                <div className={`flex items-center gap-2 p-3 rounded-md ${debugResult.success ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                                    {debugResult.success ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
                                    <span className="font-medium">{debugResult.success ? 'Envío Exitoso' : 'Error en Envío'}</span>
                                </div>

                                {debugResult.success && (
                                    <>
                                        <div className="text-sm space-y-1">
                                            <div className="flex justify-between border-b pb-1">
                                                <span className="text-muted-foreground">Proveedor:</span>
                                                <span>{debugResult.provider}</span>
                                            </div>
                                            <div className="flex justify-between border-b pb-1 pt-1">
                                                <span className="text-muted-foreground">Destino:</span>
                                                <span>{debugResult.sentTo}</span>
                                            </div>
                                        </div>

                                        <div className="pt-2">
                                            <Label className="text-xs uppercase text-muted-foreground mb-1 block">Simulación de Inyección (Lo que el usuario recibe)</Label>
                                            <div className="bg-slate-950 text-slate-50 p-3 rounded-md text-xs font-mono overflow-auto max-h-60 break-all whitespace-pre-wrap">
                                                {debugResult.simulation}
                                            </div>
                                            <p className="text-[10px] text-muted-foreground mt-1">
                                                * Esta es una simulación basada en tu input. El backend realiza un proceso idéntico.
                                                Verifica en tu bandeja que los enlaces apunten a <code>/api/tracking/click</code>.
                                            </p>
                                        </div>
                                    </>
                                )}

                                {debugResult.error && (
                                    <div className="bg-red-950 text-red-50 p-3 rounded-md text-xs font-mono">
                                        {JSON.stringify(debugResult.error, null, 2)}
                                    </div>
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
