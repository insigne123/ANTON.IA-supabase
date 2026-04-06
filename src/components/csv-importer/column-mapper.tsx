'use client';

import { useEffect, useState } from 'react';
import { ColumnMapping, AVAILABLE_FIELDS, guessMapping } from '@/lib/csv-import-utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, ArrowRightLeft } from 'lucide-react';

interface ColumnMapperProps {
    csvHeaders: string[];
    onConfirm: (mapping: ColumnMapping[]) => void;
    onCancel: () => void;
}

export function ColumnMapper({ csvHeaders, onConfirm, onCancel }: ColumnMapperProps) {
    const [mapping, setMapping] = useState<ColumnMapping[]>([]);

    useEffect(() => {
        setMapping(guessMapping(csvHeaders));
    }, [csvHeaders]);

    const updateMapping = (header: string, field: string) => {
        setMapping(prev => prev.map(m =>
            m.csvHeader === header ? { ...m, leadField: field as any } : m
        ));
    };

    const requiredFields = ['email']; // Podríamos hacer email obligatorio, o no, depende de la lógica de upsert.
    // Pero generalmente necesitamos email para unicidad.

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-2 mb-4">
                <ArrowRightLeft className="w-5 h-5 text-primary" />
                <h3 className="font-semibold text-lg">Mapea tus columnas</h3>
            </div>

            <p className="text-sm text-muted-foreground">
                Conecta las columnas de tu archivo (izquierda) con los campos de nuestra base de datos (derecha).
                Los campos marcados con * son recomendados.
            </p>

            <div className="grid gap-3">
                {mapping.map((m, i) => (
                    <Card key={i} className="border-l-4 border-l-primary/20">
                        <CardContent className="p-4 flex items-center gap-4 justify-between">
                            <div className="flex-1 min-w-0">
                                <Label className="text-xs text-muted-foreground uppercase">Columna CSV</Label>
                                <div className="font-medium truncate" title={m.csvHeader}>{m.csvHeader}</div>
                            </div>

                            <ArrowRight className="w-4 h-4 text-muted-foreground" />

                            <div className="flex-1 min-w-0">
                                <Label className="text-xs text-muted-foreground uppercase">Campo Destino</Label>
                                <Select
                                    value={m.leadField}
                                    onValueChange={(val) => updateMapping(m.csvHeader, val)}
                                >
                                    <SelectTrigger className={m.leadField === 'email' ? 'border-primary' : ''}>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ignore" className="text-muted-foreground italic">Ignorar esta columna</SelectItem>
                                        {AVAILABLE_FIELDS.map(f => (
                                            <SelectItem key={f.value} value={f.value}>
                                                {f.label} {f.value === 'email' ? '*' : ''}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <div className="flex justify-between pt-4">
                <Button variant="ghost" onClick={onCancel}>Atrás</Button>
                <Button onClick={() => onConfirm(mapping)}>
                    Continuar a Revisión
                </Button>
            </div>
        </div>
    );
}
