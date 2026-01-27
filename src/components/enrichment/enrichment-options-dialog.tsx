import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useState } from 'react';
import { AlertCircle, Calculator, Mail, Phone } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface EnrichmentOptionsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (options: { revealEmail: boolean; revealPhone: boolean }) => void;
    loading?: boolean;
    leadCount: number;
}

export function EnrichmentOptionsDialog({ open, onOpenChange, onConfirm, loading, leadCount }: EnrichmentOptionsDialogProps) {
    const [revealEmail, setRevealEmail] = useState(true);
    const [revealPhone, setRevealPhone] = useState(false);

    const costPerLead = (revealEmail ? 1 : 0) + (revealPhone ? 1 : 0);
    const totalCost = costPerLead * leadCount;

    const handleConfirm = () => {
        onConfirm({ revealEmail, revealPhone });
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Opciones de Enriquecimiento</DialogTitle>
                    <DialogDescription>
                        Elige qué datos deseas obtener de Apollo. Cada dato tiene un costo de créditos.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="flex items-center space-x-2 border p-4 rounded-md">
                        <Checkbox id="email" checked={revealEmail} onCheckedChange={(c) => setRevealEmail(!!c)} />
                        <Label htmlFor="email" className="flex-1 flex items-center gap-2 cursor-pointer">
                            <Mail className="w-4 h-4 text-muted-foreground" />
                            Obtener Email Personal
                        </Label>
                        <span className="text-xs font-medium bg-secondary px-2 py-1 rounded">1 crédito</span>
                    </div>

                    <div className="flex items-center space-x-2 border p-4 rounded-md">
                        <Checkbox id="phone" checked={revealPhone} onCheckedChange={(c) => setRevealPhone(!!c)} />
                        <Label htmlFor="phone" className="flex-1 flex items-center gap-2 cursor-pointer">
                            <Phone className="w-4 h-4 text-muted-foreground" />
                            Obtener Teléfono Móvil/Directo
                        </Label>
                        <span className="text-xs font-medium bg-secondary px-2 py-1 rounded">1 crédito</span>
                    </div>

                    {totalCost > 0 && (
                        <Alert>
                            <Calculator className="h-4 w-4" />
                            <AlertTitle>Estimación de Costo</AlertTitle>
                            <AlertDescription>
                                Enriquecer <strong>{leadCount}</strong> leads costará aproximadamente <strong>{totalCost}</strong> créditos.
                            </AlertDescription>
                        </Alert>
                    )}

                    {totalCost === 0 && (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>Debes seleccionar al menos una opción.</AlertDescription>
                        </Alert>
                    )}

                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={handleConfirm} disabled={loading || totalCost === 0}>
                        {loading ? 'Procesando...' : 'Comenzar Enriquecimiento'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
