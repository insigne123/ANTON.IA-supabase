'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { unsubscribeService, type UnsubscribedEmail } from '@/lib/services/unsubscribe-service';
import { Trash2, Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export default function UnsubscribesPage() {
    const { toast } = useToast();
    const [loading, setLoading] = useState(true);
    const [list, setList] = useState<UnsubscribedEmail[]>([]);
    const [removingId, setRemovingId] = useState<string | null>(null);

    async function load() {
        setLoading(true);
        try {
            const data = await unsubscribeService.getBlacklist();
            setList(data);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
    }, []);

    async function remove(id: string) {
        if (!confirm('¿Estás seguro de desbloquear este correo? Volverás a poder enviarle mensajes.')) return;

        setRemovingId(id);
        try {
            await unsubscribeService.removeFromBlacklist(id);
            setList(prev => prev.filter(x => x.id !== id));
            toast({ title: 'Desbloqueado', description: 'El correo ha sido eliminado de la lista negra.' });
        } catch (err) {
            toast({ variant: 'destructive', title: 'Error', description: 'No se pudo eliminar.' });
        } finally {
            setRemovingId(null);
        }
    }

    return (
        <div className="container mx-auto space-y-6">
            <PageHeader
                title="Bajas y Bloqueos"
                description="Gestión de correos que han solicitado no recibir más comunicaciones."
            />

            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>Correos Bloqueados</CardTitle>
                        <CardDescription>
                            Estos destinatarios se han dado de baja o han sido bloqueados manualmente.
                            El sistema impedirá enviar correos a estas direcciones.
                        </CardDescription>
                    </div>
                    <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                        <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                        Actualizar
                    </Button>
                </CardHeader>
                <CardContent>
                    <div className="border rounded-md">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Email</TableHead>
                                    <TableHead>Razón</TableHead>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead>Alcance</TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading && list.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                                            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                                            Cargando lista...
                                        </TableCell>
                                    </TableRow>
                                ) : list.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                                            No hay correos bloqueados.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    list.map(item => (
                                        <TableRow key={item.id}>
                                            <TableCell className="font-medium">{item.email}</TableCell>
                                            <TableCell className="text-muted-foreground text-sm">
                                                {item.reason || 'Suscripción cancelada'}
                                            </TableCell>
                                            <TableCell className="text-muted-foreground text-sm">
                                                {new Date(item.created_at).toLocaleDateString()}
                                            </TableCell>
                                            <TableCell>
                                                {item.organization_id ? (
                                                    <Badge variant="secondary">Organización</Badge>
                                                ) : (
                                                    <Badge variant="outline">Personal</Badge>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                                    onClick={() => remove(item.id)}
                                                    disabled={removingId === item.id}
                                                >
                                                    {removingId === item.id ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <Trash2 className="h-4 w-4" />
                                                    )}
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
        </div>
    );
}
