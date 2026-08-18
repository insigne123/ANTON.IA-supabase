'use client';

import { useEffect, useState } from 'react';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription
} from '@/components/ui/sheet';
import { UnifiedRow } from '@/lib/unified-sheet-types';
import { activityService } from '@/lib/services/activity-service';
import { Activity } from '@/lib/crm-types';
import { CommercialTimeline } from '@/components/commercial/CommercialTimeline';
import { ContactabilityStatusCard } from '@/components/commercial/ContactabilityStatusCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar, Mail } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import Link from 'next/link';

interface Props {
    lead: UnifiedRow | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

function getAISuggestion(lead: UnifiedRow, activities: Activity[]): string {
    const stage = lead.stage || 'inbox';
    const hasEmail = activities.some(a => a.type === 'email');
    const lastEmail = activities.find(a => a.type === 'email' && a.title.includes('enviado'));
    const hasReply = activities.some(a => a.type === 'email' && a.title.includes('Respuesta'));

    // Calculate days since last contact
    let daysSinceContact = 0;
    if (lastEmail) {
        const lastContactDate = new Date(lastEmail.createdAt);
        daysSinceContact = Math.floor((Date.now() - lastContactDate.getTime()) / (1000 * 60 * 60 * 24));
    }

    // Generate suggestion based on stage and activity
    if (stage === 'inbox' || stage === 'qualified') {
        if (!hasEmail) {
            return `Este lead aún no ha sido contactado. Es un buen momento para enviar el primer email de presentación.`;
        }
    }

    if (stage === 'contacted') {
        if (hasReply) {
            return `¡El lead respondió! Revisa su mensaje y programa una llamada o reunión para avanzar.`;
        }
        if (daysSinceContact >= 3) {
            return `Han pasado ${daysSinceContact} días desde el último contacto sin respuesta. Considera enviar un follow-up o intentar por otro canal.`;
        }
        return `Email enviado hace ${daysSinceContact} día(s). Espera 2-3 días antes del follow-up.`;
    }

    if (stage === 'engaged') {
        return `El lead está interesado. Agenda una demo o reunión para presentar tu solución en detalle.`;
    }

    if (stage === 'meeting') {
        return `Reunión agendada. Prepara la presentación y confirma la asistencia 24h antes.`;
    }

    return `Revisa el historial de actividad y decide el próximo paso según el contexto del lead.`;
}

function humanizeValue(value: string) {
    return value
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (character) => character.toUpperCase());
}


export function LeadDetailDrawer({ lead, open, onOpenChange }: Props) {
    const [activities, setActivities] = useState<Activity[]>([]);
    const [activitiesLoading, setActivitiesLoading] = useState(false);
    const [activitiesError, setActivitiesError] = useState(false);

    useEffect(() => {
        if (lead && open) {
            setActivitiesLoading(true);
            setActivitiesError(false);
            const leadId = lead.sourceId;
            activityService.getLeadActivities(leadId, lead.gid, lead.email || undefined)
                .then(setActivities)
                .catch((error) => {
                    console.error(error);
                    setActivitiesError(true);
                })
                .finally(() => setActivitiesLoading(false));
        } else {
            setActivities([]);
            setActivitiesLoading(false);
            setActivitiesError(false);
        }
    }, [lead, open]);

    if (!lead) return null;

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-full overflow-y-auto sm:max-w-[540px]">
                <SheetHeader className="mb-5">
                    <div className="flex items-start gap-4">
                        <Avatar className="h-12 w-12">
                            <AvatarFallback>{lead.name?.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="space-y-1">
                            <SheetTitle>{lead.name || 'Lead sin nombre'}</SheetTitle>
                            <SheetDescription>
                                {[lead.title, lead.company].filter(Boolean).join(' · ') || 'Sin cargo o empresa'}
                            </SheetDescription>
                            <div className="flex items-center gap-2 mt-2">
                                {lead.email && (
                                    <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                                      <Link href={`/contact/compose?id=${lead.sourceId}&email=${lead.email}`}>
                                            <Mail className="h-3 w-3 mr-1" /> Email
                                      </Link>
                                    </Button>
                                )}
                                {lead.linkedinUrl && (
                                    <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                                      <a href={lead.linkedinUrl} target="_blank" rel="noreferrer">
                                        <span className="mr-1 font-bold text-sky-700 dark:text-sky-300">in</span> LinkedIn
                                      </a>
                                    </Button>
                                )}
                                <Badge variant="secondary">{humanizeValue(String(lead.stage || 'inbox'))}</Badge>
                                {lead.autopilotStatus && <Badge variant="outline">{humanizeValue(lead.autopilotStatus)}</Badge>}
                            </div>
                        </div>
                    </div>
                </SheetHeader>

                <div className="mb-6">
                    <ContactabilityStatusCard email={lead.email} compact />
                </div>

                {(lead.nextAction || lead.nextActionDueAt || lead.meetingLink) && (
                    <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
                        <h4 className="mb-1 text-sm font-semibold text-amber-900 dark:text-amber-100">Próxima acción registrada</h4>
                        {lead.nextAction && <p className="text-sm text-amber-800 dark:text-amber-100/80">{lead.nextAction}</p>}
                        {lead.nextActionDueAt && (
                            <p className="mt-2 text-xs text-amber-700 dark:text-amber-200/80">
                                Vence: {new Date(lead.nextActionDueAt).toLocaleString()}
                            </p>
                        )}
                        {lead.meetingLink && (
                            <Button asChild size="sm" variant="outline" className="mt-3 h-8 text-xs">
                              <a href={lead.meetingLink} target="_blank" rel="noreferrer">
                                    <Calendar className="h-3 w-3 mr-1" /> Abrir booking link
                              </a>
                            </Button>
                        )}
                    </div>
                )}

                <div className="mb-6 rounded-lg border border-border/70 bg-muted/30 p-4">
                    <h4 className="mb-1 text-sm font-semibold text-foreground">
                        Siguiente paso sugerido
                    </h4>
                    {activitiesLoading ? (
                        <p className="text-sm text-muted-foreground">Revisando actividad…</p>
                    ) : activitiesError ? (
                        <p className="text-sm text-muted-foreground">No se pudo revisar la actividad. Puedes abrir el historial más abajo.</p>
                    ) : (
                        <p className="text-sm text-muted-foreground">{getAISuggestion(lead, activities)}</p>
                    )}
                    <div className="mt-3 flex gap-2">
                        {lead.email && (
                            <Button asChild size="sm" className="h-8 text-xs">
                              <Link href={`/contact/compose?id=${lead.sourceId}&email=${lead.email}`}>
                                    Enviar email
                              </Link>
                            </Button>
                        )}
                    </div>
                </div>

                <CommercialTimeline
                    leadId={lead.sourceId}
                    gid={lead.gid}
                    email={lead.email}
                    name={lead.name}
                    company={lead.company}
                />

            </SheetContent>
        </Sheet>
    );
}
