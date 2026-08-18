'use client';

import { ArrowDown, Clock3, Mail } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CampaignStep } from '@/lib/services/campaigns-service';

interface CampaignFlowProps {
    steps: CampaignStep[];
    onSelectStep?: (stepId: string) => void;
    activeStepId?: string | null;
}

export function CampaignFlow({ steps, onSelectStep, activeStepId }: CampaignFlowProps) {
    return (
        <div className="rounded-2xl border border-border/60 bg-muted/15 px-4 py-6 sm:px-8" aria-label="Vista de la secuencia">
            <div className="mx-auto flex w-full max-w-xl flex-col items-center">
                <div className="rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
                    Inicio de la secuencia
                </div>
                <div className="my-2 h-5 w-px bg-border" aria-hidden="true" />

                {steps.length === 0 ? (
                    <div className="w-full rounded-xl border border-dashed border-border/70 bg-background/70 px-4 py-8 text-center text-sm text-muted-foreground">
                        Agrega un mensaje para comenzar la secuencia.
                    </div>
                ) : (
                    steps.map((step, idx) => (
                        <div key={step.id} className="flex w-full flex-col items-center">
                            {(idx > 0 || step.offsetDays > 0) && (
                                <div className="flex flex-col items-center gap-1.5 py-2 text-xs text-muted-foreground">
                                    <div className="h-4 w-px bg-border" aria-hidden="true" />
                                    <span className="flex items-center gap-1.5 rounded-full border border-border/70 bg-background px-2.5 py-1">
                                        <Clock3 className="size-3.5" aria-hidden="true" />
                                        {step.offsetDays === 0 ? 'Sin espera' : `${step.offsetDays} ${step.offsetDays === 1 ? 'día' : 'días'} después`}
                                    </span>
                                    <ArrowDown className="size-3.5 text-muted-foreground/60" aria-hidden="true" />
                                </div>
                            )}

                            <button
                                type="button"
                                onClick={() => onSelectStep?.(step.id)}
                                className={cn(
                                    'w-full rounded-xl border border-border/70 bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                                    activeStepId === step.id && 'border-primary/60 bg-primary/5 ring-1 ring-primary/30',
                                )}
                                aria-label={`Editar paso ${idx + 1}: ${step.name || 'Sin nombre'}`}
                            >
                                <div className="flex items-start gap-3">
                                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                                        <Mail className="size-4" aria-hidden="true" />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-center justify-between gap-3">
                                            <span className="truncate text-sm font-semibold">{step.name || `Paso ${idx + 1}`}</span>
                                            <span className="shrink-0 text-xs text-muted-foreground">Paso {idx + 1}</span>
                                        </span>
                                        <span className="mt-1 block truncate text-xs text-muted-foreground">
                                            {step.subject || 'Asunto pendiente'}
                                        </span>
                                    </span>
                                </div>
                            </button>
                        </div>
                    ))
                )}

                {steps.length > 0 && (
                    <>
                        <div className="my-2 h-5 w-px bg-border" aria-hidden="true" />
                        <div className="rounded-full border border-border/70 bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
                            Fin de la secuencia
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
