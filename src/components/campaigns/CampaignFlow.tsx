'use client';

import { ArrowDown, Clock, Mail } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { CampaignStep } from '@/lib/services/campaigns-service';

interface CampaignFlowProps {
    steps: CampaignStep[];
    onSelectStep?: (stepId: string) => void;
    activeStepId?: string | null;
}

export function CampaignFlow({ steps, onSelectStep, activeStepId }: CampaignFlowProps) {
    return (
        <div className="flex flex-col items-center space-y-4 py-8 bg-muted/20 rounded-lg border border-dashed">
            {/* Start Node */}
            <div className="flex flex-col items-center">
                <div className="px-4 py-2 bg-green-100 text-green-700 text-xs font-bold rounded-full border border-green-200">
                    INICIO
                </div>
                <div className="h-8 w-px bg-border my-1" />
            </div>

            {steps.length === 0 ? (
                <div className="text-sm text-muted-foreground italic">Sin pasos definidos</div>
            ) : (
                steps.map((step, idx) => (
                    <div key={step.id} className="flex flex-col items-center w-full max-w-md relative group">
                        {/* Edge from previous (if not first, handled by Start node above actually, but for wait time) */}
                        {idx > 0 && (
                            <div className="flex flex-col items-center -mt-4 mb-2 z-0">
                                <div className="h-8 w-px bg-border" />
                                <div className="bg-background border rounded-full px-3 py-1 text-[10px] text-muted-foreground flex items-center gap-1 shadow-sm">
                                    <Clock className="w-3 h-3" />
                                    <span>Espera {step.offsetDays} días</span>
                                </div>
                                <div className="h-4 w-px bg-border" />
                                <ArrowDown className="w-3 h-3 text-border" />
                            </div>
                        )}
                        {/* If first step, just show the edge from Start, but maybe show offset if > 0 */}
                        {idx === 0 && (
                            <div className="flex flex-col items-center -mt-3 mb-2">
                                {step.offsetDays > 0 && (
                                    <div className="bg-background border rounded-full px-3 py-1 text-[10px] text-muted-foreground flex items-center gap-1 shadow-sm mb-1">
                                        <Clock className="w-3 h-3" />
                                        <span>Espera {step.offsetDays} días</span>
                                    </div>
                                )}
                                <ArrowDown className="w-3 h-3 text-border" />
                            </div>
                        )}


                        {/* Node */}
                        <Card
                            onClick={() => onSelectStep?.(step.id)}
                            className={cn(
                                "w-full p-4 cursor-pointer transition-all hover:shadow-md hover:border-primary/50 relative z-10",
                                activeStepId === step.id ? "border-primary ring-1 ring-primary bg-primary/5" : "bg-card"
                            )}
                        >
                            <div className="flex items-start gap-3">
                                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 shrink-0 mt-0.5">
                                    <Mail className="w-4 h-4" />
                                </div>
                                <div className="grid gap-1">
                                    <div className="font-semibold text-sm flex items-center justify-between">
                                        <span>{step.name || `Paso ${idx + 1}`}</span>
                                        <span className="text-[10px] px-2 py-0.5 bg-muted rounded text-muted-foreground">step_{idx + 1}</span>
                                    </div>
                                    <div className="text-xs text-muted-foreground line-clamp-2">
                                        {step.subject || '(Sin asunto)'}
                                    </div>
                                </div>
                            </div>
                        </Card>

                        {/* Edge to next (visual connector only if next exists, handled by next iter) */}
                    </div>
                ))
            )}

            {/* End Node */}
            {steps.length > 0 && (
                <div className="flex flex-col items-center">
                    <div className="h-8 w-px bg-border my-1" />
                    <div className="px-4 py-2 bg-slate-100 text-slate-600 text-xs font-bold rounded-full border border-slate-200">
                        FIN
                    </div>
                </div>
            )}
        </div>
    );
}
