import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useState } from 'react';
import { AlertCircle, Mail, Phone } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

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

    const hasSelection = revealEmail || revealPhone;

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
                        Elige los datos laborales que quieres obtener para los contactos seleccionados.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card p-4 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
                        <Checkbox id="email" className="mt-0.5" checked={revealEmail} onCheckedChange={(c) => setRevealEmail(!!c)} />
                        <Label htmlFor="email" className="min-w-0 flex-1 cursor-pointer">
                            <span className="flex items-center gap-2 text-sm font-medium">
                                <Mail className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                Obtener correo laboral
                            </span>
                            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                                Busca un correo laboral y su estado de verificación.
                            </span>
                        </Label>
                        <Badge variant="secondary" className="shrink-0 tabular-nums">
                            Correo
                        </Badge>
                    </div>

                    <div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card p-4 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
                        <Checkbox id="phone" className="mt-0.5" checked={revealPhone} onCheckedChange={(c) => setRevealPhone(!!c)} />
                        <Label htmlFor="phone" className="min-w-0 flex-1 cursor-pointer">
                            <span className="flex items-center gap-2 text-sm font-medium">
                                <Phone className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                Obtener teléfono móvil
                            </span>
                            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                                El resultado puede completarse en segundo plano.
                            </span>
                        </Label>
                        <Badge variant="secondary" className="shrink-0 tabular-nums">
                            Asíncrono
                        </Badge>
                    </div>

                    {hasSelection ? (
                        <div className="rounded-2xl border border-border/60 bg-muted/30 p-3 text-sm" role="status" aria-live="polite">
                            <div className="font-medium">{leadCount === 1 ? '1 contacto seleccionado' : `${leadCount} contactos seleccionados`}</div>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                La app cuenta una operación diaria por contacto enviado. El consumo del proveedor se registra por separado según los datos solicitados.
                            </p>
                        </div>
                    ) : (
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>Debes seleccionar al menos una opción.</AlertDescription>
                        </Alert>
                    )}

                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={handleConfirm} disabled={loading || !hasSelection}>
                        {loading ? 'Enviando...' : 'Completar datos'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
