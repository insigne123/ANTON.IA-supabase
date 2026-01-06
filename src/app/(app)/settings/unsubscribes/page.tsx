'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { unsubscribeService, type UnsubscribedEmail } from '@/lib/services/unsubscribe-service';
import { domainService, type ExcludedDomain } from '@/lib/services/domain-service';
import { Trash2, Loader2, RefreshCw, Plus, ShieldBan } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function UnsubscribesPage() {
    const { toast } = useToast();
    const [loading, setLoading] = useState(true);

    // Email List State
    const [emailList, setEmailList] = useState<UnsubscribedEmail[]>([]);
    const [removingEmailId, setRemovingEmailId] = useState<string | null>(null);

    // Domain List State
    const [domainList, setDomainList] = useState<ExcludedDomain[]>([]);
    const [removingDomainId, setRemovingDomainId] = useState<string | null>(null);

    // Add Domain State
    const [isAddDomainOpen, setIsAddDomainOpen] = useState(false);
    const [newDomain, setNewDomain] = useState('');
    const [addingDomain, setAddingDomain] = useState(false);

    async function loadData() {
        setLoading(true);
        try {
            const [emails, domains] = await Promise.all([
                unsubscribeService.getBlacklist(),
                domainService.getExcludedDomains()
            ]);
            setEmailList(emails);
            setDomainList(domains);
        } catch (e) {
            console.error(e);
            toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar las listas.' });
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadData();
    }, []);

    // --- Actions: Emails ---
    async function removeEmail(id: string) {
        if (!confirm('¿Estás seguro de desbloquear este correo?')) return;
        setRemovingEmailId(id);
        try {
            await unsubscribeService.removeFromBlacklist(id);
            setEmailList(prev => prev.filter(x => x.id !== id));
            toast({ title: 'Correo desbloqueado' });
        } catch (err) {
            toast({ variant: 'destructive', title: 'Error', description: 'No se pudo eliminar.' });
        } finally {
            setRemovingEmailId(null);
        }
    }

    // --- Actions: Domains ---
    async function handleAddDomain() {
        if (!newDomain.trim()) return;
        setAddingDomain(true);
        try {
            await domainService.addDomain(newDomain);
            toast({ title: 'Dominio Bloqueado', description: `${newDomain} ha sido añadido a la lista negra.` });
            setIsAddDomainOpen(false);
            setNewDomain('');
            // Reload list
            const domains = await domainService.getExcludedDomains();
            setDomainList(domains);
        } catch (e) {
            toast({ variant: 'destructive', title: 'Error', description: 'No se pudo agregar el dominio.' });
        } finally {
            setAddingDomain(false);
        }
    }

    async function removeDomain(id: string) {
        if (!confirm('¿Estás seguro de desbloquear este dominio? Se podrán volver a contactar correos de este dominio.')) return;
        setRemovingDomainId(id);
        try {
            await domainService.removeDomain(id);
            setDomainList(prev => prev.filter(x => x.id !== id));
            toast({ title: 'Dominio desbloqueado' });
        } catch (err) {
            toast({ variant: 'destructive', title: 'Error', description: 'No se pudo eliminar.' });
        } finally {
            setRemovingDomainId(null);
        }
    }

    // --- Actions: Test Block ---
    const [isTestOpen, setIsTestOpen] = useState(false);
    const [testEmail, setTestEmail] = useState('');
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ status: 'success' | 'blocked' | 'error', message: string } | null>(null);

    async function handleTestEmail() {
        if (!testEmail.trim()) return;
        setTesting(true);
        setTestResult(null);
        try {
            // We use providers/send to test. We assume Google as default provider or just check the blocking logic.
            // The blocking logic runs BEFORE provider check.
            const res = await fetch('/api/providers/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider: 'google', // Dummy provider, we just want to hit the block check
                    to: testEmail,
                    subject: 'Test de Bloqueo Antonia',
                    htmlBody: '<p>Este es un correo de prueba para verificar bloqueos.</p>'
                })
            });

            const data = await res.json();

            if (res.status === 403) {
                setTestResult({ status: 'blocked', message: '¡Correcto! El correo fue bloqueado: ' + data.error });
            } else if (res.ok) {
                setTestResult({ status: 'success', message: 'El correo NO fue bloqueado y se intentó enviar.' });
            } else {
                // Determine if it was a block fail or just a system error (like no token)
                // If "Not connected", it means it passed the block check!
                if (data.error && (data.error.includes('Not connected') || data.error.includes('Unauthorized'))) {
                    setTestResult({ status: 'success', message: 'No bloqueado (falló envío por falta de conexión, pero pasó el filtro).' });
                } else {
                    setTestResult({ status: 'error', message: 'Error inesperado: ' + (data.error || res.statusText) });
                }
            }
        } catch (e: any) {
            setTestResult({ status: 'error', message: 'Error de red: ' + e.message });
        } finally {
            setTesting(false);
        }
    }

    return (
        <div className="container mx-auto space-y-6">
            <PageHeader
                title="Bajas y Bloqueos"
                description="Gestiona quien no debe recibir correos de Antonia, ya sea por dirección individual o dominio completo."
            >
                <Dialog open={isTestOpen} onOpenChange={(open) => { setIsTestOpen(open); if (!open) setTestResult(null); }}>
                    <DialogTrigger asChild>
                        <Button variant="secondary">
                            <ShieldBan className="h-4 w-4 mr-2" />
                            Probar Bloqueo
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Probar Bloqueo de Correos</DialogTitle>
                            <DialogDescription>
                                Ingresa un correo para verificar si el sistema lo bloquearía.
                                Intenta con un correo de un dominio bloqueado.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="space-y-2">
                                <Label htmlFor="test-email">Correo de prueba</Label>
                                <Input
                                    id="test-email"
                                    placeholder="ej: prueba@dominio-bloqueado.com"
                                    value={testEmail}
                                    onChange={(e) => setTestEmail(e.target.value)}
                                />
                            </div>

                            {testResult && (
                                <div className={`p-3 rounded-md text-sm font-medium ${testResult.status === 'blocked' ? 'bg-green-100 text-green-800 border border-green-200' :
                                        testResult.status === 'success' ? 'bg-red-100 text-red-800 border border-red-200' :
                                            'bg-yellow-100 text-yellow-800 border border-yellow-200'
                                    }`}>
                                    {testResult.status === 'blocked' && "✅ "}
                                    {testResult.status === 'success' && "⚠️ "}
                                    {testResult.message}
                                </div>
                            )}
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsTestOpen(false)}>Cerrar</Button>
                            <Button onClick={handleTestEmail} disabled={testing || !testEmail}>
                                {testing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                Verificar
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </PageHeader>

            <Tabs defaultValue="emails" className="w-full">
                <div className="flex justify-between items-center mb-4">
                    <TabsList>
                        <TabsTrigger value="emails">Correos Individuales</TabsTrigger>
                        <TabsTrigger value="domains">Dominios Bloqueados</TabsTrigger>
                    </TabsList>

                    <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
                        <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                        Actualizar
                    </Button>
                </div>

                {/* --- TAB: EMAILS --- */}
                <TabsContent value="emails">
                    <Card>
                        <CardHeader>
                            <CardTitle>Correos Bloqueados</CardTitle>
                            <CardDescription>
                                Correos específicos que se han dado de baja o han sido bloqueados manualmente.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="border rounded-md">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Email</TableHead>
                                            <TableHead>Razón</TableHead>
                                            <TableHead>Fecha</TableHead>
                                            <TableHead className="text-right">Acciones</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {loading && emailList.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                                                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                                                    Cargando...
                                                </TableCell>
                                            </TableRow>
                                        ) : emailList.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                                                    No hay correos bloqueados.
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            emailList.map(item => (
                                                <TableRow key={item.id}>
                                                    <TableCell className="font-medium">{item.email}</TableCell>
                                                    <TableCell className="text-muted-foreground text-sm">
                                                        {item.reason || 'Suscripción cancelada'}
                                                    </TableCell>
                                                    <TableCell className="text-muted-foreground text-sm">
                                                        {new Date(item.created_at).toLocaleDateString()}
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <Button
                                                            size="sm" variant="ghost" className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                                            onClick={() => removeEmail(item.id)}
                                                            disabled={removingEmailId === item.id}
                                                        >
                                                            {removingEmailId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* --- TAB: DOMAINS --- */}
                <TabsContent value="domains">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle>Dominios Excluidos</CardTitle>
                                <CardDescription>
                                    Si bloqueas un dominio (ej: @thesheriff.cl), ningún correo perteneciente a ese dominio será contactado.
                                </CardDescription>
                            </div>
                            <Dialog open={isAddDomainOpen} onOpenChange={setIsAddDomainOpen}>
                                <DialogTrigger asChild>
                                    <Button size="sm">
                                        <ShieldBan className="h-4 w-4 mr-2" />
                                        Bloquear Dominio
                                    </Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle>Bloquear Nuevo Dominio</DialogTitle>
                                        <DialogDescription>
                                            Ingresa el dominio a bloquear (ej: gmail.com, thesheriff.cl). No incluyas @.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <div className="grid gap-4 py-4">
                                        <div className="grid grid-cols-4 items-center gap-4">
                                            <Label htmlFor="domain" className="text-right">
                                                Dominio
                                            </Label>
                                            <Input
                                                id="domain"
                                                placeholder="ej: competitors.com"
                                                className="col-span-3"
                                                value={newDomain}
                                                onChange={(e) => setNewDomain(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                    <DialogFooter>
                                        <Button variant="outline" onClick={() => setIsAddDomainOpen(false)}>Cancelar</Button>
                                        <Button onClick={handleAddDomain} disabled={addingDomain || !newDomain}>
                                            {addingDomain && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                            Bloquear
                                        </Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        </CardHeader>
                        <CardContent>
                            <div className="border rounded-md">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Dominio</TableHead>
                                            <TableHead>Fecha</TableHead>
                                            <TableHead className="text-right">Acciones</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {loading && domainList.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                                                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                                                    Cargando...
                                                </TableCell>
                                            </TableRow>
                                        ) : domainList.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                                                    No hay dominios bloqueados.
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            domainList.map(item => (
                                                <TableRow key={item.id}>
                                                    <TableCell className="font-medium">@{item.domain}</TableCell>
                                                    <TableCell className="text-muted-foreground text-sm">
                                                        {new Date(item.created_at).toLocaleDateString()}
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <Button
                                                            size="sm" variant="ghost" className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                                            onClick={() => removeDomain(item.id)}
                                                            disabled={removingDomainId === item.id}
                                                        >
                                                            {removingDomainId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
