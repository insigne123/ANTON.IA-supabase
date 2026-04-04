
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { EnrichedOppLead } from "@/lib/types";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Building2, MapPin, Mail, Phone, Linkedin, Globe, Briefcase, Users } from "lucide-react";

interface EnrichedLeadDetailsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    lead: EnrichedOppLead | null;
}

export function EnrichedLeadDetailsDialog({ open, onOpenChange, lead }: EnrichedLeadDetailsDialogProps) {
    if (!lead) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Detalles del Lead</DialogTitle>
                    <DialogDescription>{lead.enrichmentStatus === 'completed' ? 'Datos enriquecidos' : 'Enriquecimiento pendiente'}</DialogDescription>
                </DialogHeader>

                <div className="space-y-6">
                    {/* Header Profile */}
                    <div className="flex items-start gap-4">
                        <Avatar className="w-20 h-20 border">
                            <AvatarImage src={lead.photoUrl || ''} />
                            <AvatarFallback className="text-xl bg-slate-200">{lead.fullName?.substring(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 space-y-1">
                            <h3 className="text-xl font-bold">{lead.fullName}</h3>
                            <p className="text-muted-foreground font-medium flex items-center gap-2">
                                {lead.title} {lead.companyName && <span>at {lead.companyName}</span>}
                            </p>
                            {lead.headline && <p className="text-sm text-muted-foreground italic">"{lead.headline}"</p>}
                            <div className="flex flex-wrap gap-2 mt-2">
                                {lead.seniority && <Badge variant="secondary" className="capitalize">{lead.seniority}</Badge>}
                                {(lead.city || lead.country) && <Badge variant="outline" className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {[lead.city, lead.country].filter(Boolean).join(', ')}</Badge>}
                            </div>
                        </div>
                    </div>

                    <Separator />

                    {/* Contact Info */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-3">
                            <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2"><Mail className="w-4 h-4" /> Contacto</h4>
                            <div className="space-y-2 text-sm border p-3 rounded-md bg-slate-50 dark:bg-slate-900/50">
                                {lead.email ? (
                                    <div className="flex items-center gap-2 justify-between">
                                        <span className={lead.emailStatus === 'verified' ? 'text-green-600 font-medium' : ''}>{lead.email}</span>
                                        {lead.emailStatus && <Badge variant="outline" className="text-[10px] h-5">{lead.emailStatus}</Badge>}
                                    </div>
                                ) : <span className="text-muted-foreground italic">Sin email</span>}

                                <Separator className="my-2" />

                                {lead.primaryPhone ? (
                                    <div className="flex items-center gap-2">
                                        <Phone className="w-4 h-4 text-muted-foreground" />
                                        <span>{lead.primaryPhone}</span>
                                    </div>
                                ) : lead.phoneNumbers && lead.phoneNumbers.length > 0 ? (
                                    <div className="space-y-1">
                                        {lead.phoneNumbers.map((p: any, i: number) => (
                                            <div key={i} className="flex items-center gap-2">
                                                <Phone className="w-3 h-3 text-muted-foreground" />
                                                <span>{typeof p === 'string' ? p : p.number}</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2 text-muted-foreground italic">
                                        <Phone className="w-4 h-4" /> Sin teléfono
                                    </div>
                                )}

                                <Separator className="my-2" />

                                {lead.linkedinUrl ? (
                                    <div className="flex items-center gap-2">
                                        <Linkedin className="w-4 h-4 text-blue-600" />
                                        <a href={lead.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">Perfil de LinkedIn</a>
                                    </div>
                                ) : <span className="text-muted-foreground italic">Sin LinkedIn</span>}
                            </div>
                        </div>

                        <div className="space-y-3">
                            <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2"><Building2 className="w-4 h-4" /> Organización</h4>
                            <div className="space-y-2 text-sm border p-3 rounded-md bg-slate-50 dark:bg-slate-900/50">
                                <div className="font-bold text-base">{lead.companyName}</div>

                                {lead.companyDomain && (
                                    <div className="flex items-center gap-2">
                                        <Globe className="w-3 h-3 text-muted-foreground" />
                                        <a href={`https://${lead.companyDomain}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{lead.companyDomain}</a>
                                    </div>
                                )}

                                {(lead.organizationIndustry || lead.industry) && (
                                    <div className="flex items-center gap-2">
                                        <Briefcase className="w-3 h-3 text-muted-foreground" />
                                        <span>{lead.organizationIndustry || lead.industry}</span>
                                    </div>
                                )}

                                {lead.organizationSize && (
                                    <div className="flex items-center gap-2">
                                        <Users className="w-3 h-3 text-muted-foreground" />
                                        <span>{lead.organizationSize} empleados</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Departments */}
                    {lead.departments && Array.isArray(lead.departments) && lead.departments.length > 0 && (
                        <>
                            <Separator />
                            <div className="space-y-2">
                                <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Departamentos</h4>
                                <div className="flex flex-wrap gap-2">
                                    {lead.departments.map((d: string, i: number) => (
                                        <Badge key={i} variant="secondary" className="font-normal">{d}</Badge>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}

                    {/* Phone Numbers List if detailed */}
                    {lead.phoneNumbers && Array.isArray(lead.phoneNumbers) && lead.phoneNumbers.length > 1 && (
                        <>
                            <Separator />
                            <div className="space-y-2">
                                <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Todos los Teléfonos ({lead.phoneNumbers.length})</h4>
                                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                                    {lead.phoneNumbers.map((p: any, i: number) => {
                                        const num = typeof p === 'string' ? p : p.sanitized_number || p.number || p.raw_number;
                                        const type = typeof p === 'object' ? p.type : null;
                                        // if(num === lead.primaryPhone) return null; // Show all to be safe
                                        return (
                                            <li key={i} className="flex items-center gap-2 bg-muted/30 p-2 rounded border">
                                                <Phone className="w-3 h-3 text-muted-foreground" />
                                                <span className="font-mono">{num}</span>
                                                {type && <Badge variant="outline" className="text-[10px] h-4 uppercase">{type}</Badge>}
                                            </li>
                                        )
                                    })}
                                </ul>
                            </div>
                        </>
                    )}

                    <div className="text-xs text-muted-foreground text-center pt-4">
                        ID: {lead.id} • Actualizado: {lead.updatedAt ? new Date(lead.updatedAt).toLocaleDateString() : '—'}
                    </div>

                </div>
            </DialogContent>
        </Dialog>
    );
}
