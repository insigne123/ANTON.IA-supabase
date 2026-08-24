import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useState } from 'react';
import { AlertCircle, Calculator, Mail, Phone } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { APOLLO_EMAIL_ENRICHMENT_CREDITS, APOLLO_PHONE_ENRICHMENT_CREDITS, apolloEnrichmentCreditCost } from '@/lib/apollo-credit-costs';

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

    const costPerLead = apolloEnrichmentCreditCost({ revealEmail, revealPhone });
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
                        Elige qué datos deseas obtener del proveedor de datos. Cada dato tiene un costo de créditos.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="flex items-center space-x-2 border p-4 rounded-md">
                        <Checkbox id="email" checked={revealEmail} onCheckedChange={(c) => setRevealEmail(!!c)} />
                        <Label htmlFor="email" className="flex-1 flex items-center gap-2 cursor-pointer">
                            <Mail className="w-4 h-4 text-muted-foreground" />
                            Obtener Email Personal
                        </Label>
                        <Badge variant="secondary" className="tabular-nums">{APOLLO_EMAIL_ENRICHMENT_CREDITS} crédito</Badge>
                    </div>

                    <div className="flex items-center space-x-2 border p-4 rounded-md">
                        <Checkbox id="phone" checked={revealPhone} onCheckedChange={(c) => setRevealPhone(!!c)} />
                        <Label htmlFor="phone" className="flex-1 flex items-center gap-2 cursor-pointer">
                            <Phone className="w-4 h-4 text-muted-foreground" />
                            Obtener Teléfono Móvil/Directo
                        </Label>
                        <Badge variant="secondary" className="tabular-nums">{APOLLO_PHONE_ENRICHMENT_CREDITS} créditos</Badge>
                    </div>

                    {totalCost > 0 && (
                        <div className="flex gap-3 rounded-xl border border-border/60 bg-muted/30 p-3" role="status" aria-live="polite">
                            <Calculator className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <div className="text-sm">
                                <div className="font-medium">Créditos Apollo estimados</div>
                                <p className="mt-0.5 text-muted-foreground">
                                    Enriquecer <strong>{leadCount}</strong> {leadCount === 1 ? 'lead' : 'leads'} usará aproximadamente <strong>{totalCost}</strong> {totalCost === 1 ? 'crédito' : 'créditos'}.
                                </p>
                            </div>
                        </div>
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
