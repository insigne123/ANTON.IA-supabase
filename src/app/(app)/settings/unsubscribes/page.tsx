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

    return (
        <div className="container mx-auto space-y-6">
            <PageHeader
                title="Bajas y Bloqueos"
                description="Gestiona quien no debe recibir correos de Antonia, ya sea por dirección individual o dominio completo."
            />

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
