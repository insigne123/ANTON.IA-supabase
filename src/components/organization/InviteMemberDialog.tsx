'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Mail, Plus } from 'lucide-react';
import { organizationService } from '@/lib/services/organization-service';

export function InviteMemberDialog({ onInviteSent }: { onInviteSent?: () => void }) {
    const [open, setOpen] = useState(false);
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<'admin' | 'member'>('member');
    const [loading, setLoading] = useState(false);
    const { toast } = useToast();

    const handleInvite = async () => {
        if (!email) return;
        setLoading(true);
        try {
            const result = await organizationService.createInvite(email, role);
            if (result && result.token) {
                toast({
                    title: 'Invitación Creada',
                    description: `Se ha generado un enlace de invitación para ${email}.`,
                });
                // En un sistema real, aquí enviaríamos el email.
                // Por ahora, simulamos copiando al portapapeles o solo mostrando éxito.
                console.log('Invite Token:', result.token);
                setOpen(false);
                setEmail('');
                if (onInviteSent) onInviteSent();
            } else {
                throw new Error('No se pudo crear la invitación.');
            }
        } catch (error) {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: 'Hubo un problema al crear la invitación.',
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button>
                    <Plus className="w-4 h-4 mr-2" /> Invitar Miembro
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Invitar al Equipo</DialogTitle>
                    <DialogDescription>
                        Envía una invitación a un nuevo miembro para colaborar en esta organización.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="email" className="text-right">
                            Email
                        </Label>
                        <Input
                            id="email"
                            placeholder="colega@empresa.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="col-span-3"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="role" className="text-right">
                            Rol
                        </Label>
                        <Select value={role} onValueChange={(val: 'admin' | 'member') => setRole(val)}>
                            <SelectTrigger className="col-span-3">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="member">Miembro (Estándar)</SelectItem>
                                <SelectItem value="admin">Administrador (Puede invitar)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <DialogFooter>
                    <Button type="submit" onClick={handleInvite} disabled={loading || !email}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Generar Invitación
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
