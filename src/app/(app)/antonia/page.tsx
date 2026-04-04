'use client';

import React, { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';
import { antoniaService } from '@/lib/services/antonia-service';
import { AntoniaMission, AntoniaConfig, Campaign } from '@/lib/types';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
    Loader2,
    Settings,
    Play,
    Pause,
    Bot,
    ArrowRight,
    CheckCircle2,
    Target,
    Briefcase,
    Globe,
    Sparkles,
    Search,
    Plus,
    Trash2,
    ChevronDown,
    Edit2,
    FileText,
    BarChart,
    X,
    WandSparkles,
} from 'lucide-react';
import { QuotaUsageCard } from '@/components/antonia/QuotaUsageCard';
import { AgentActivityFeed } from '@/components/antonia/AgentActivityFeed';
import { MetricsDashboard } from '@/components/antonia/MetricsDashboard';
import { ReportsHistory } from '@/components/antonia/ReportsHistory';
import { ReportViewer } from '@/components/antonia/ReportViewer';
import { MissionQueues } from '@/components/antonia/MissionQueues';
import { LeadAuditTrail } from '@/components/antonia/LeadAuditTrail';
import { ActiveAgentsPanel } from '@/components/antonia/ActiveAgentsPanel';
import { MissionTunerDialog } from '@/components/antonia/MissionTunerDialog';
import { AutopilotControlCenter } from '@/components/antonia/AutopilotControlCenter';
import { AutopilotExceptionsPanel } from '@/components/antonia/AutopilotExceptionsPanel';
import { AutopilotNextActionsPanel } from '@/components/antonia/AutopilotNextActionsPanel';
import { AutopilotExecutiveReportPanel } from '@/components/antonia/AutopilotExecutiveReportPanel';

import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from "@/components/ui/sheet";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { companySizes } from '@/lib/data';
import { APOLLO_SENIORITIES } from '@/lib/apollo-taxonomies';
import { buildMissionGoalSummary, shortMissionGoalLabel } from '@/lib/antonia-mission-goals';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

function simplifyAutopilotModeLabel(value?: string | null) {
    switch (value) {
        case 'full_auto':
            return 'Full Auto';
        case 'semi_auto':
            return 'Semi Auto';
        default:
            return 'Manual Assist';
    }
}

function simplifyAutopilotModeDescription(value?: string | null) {
    switch (value) {
        case 'full_auto':
            return 'ANTONIA ejecuta sola y solo frena cuando detecta riesgo.';
        case 'semi_auto':
            return 'ANTONIA trabaja sola en casos seguros y te pide ayuda cuando duda.';
        default:
            return 'ANTONIA prepara el trabajo y una persona decide antes de enviar.';
    }
}

export default function AntoniaPage() {
    const [activeTab, setActiveTab] = useState('builder');
    const [missions, setMissions] = useState<AntoniaMission[]>([]);
    const [loading, setLoading] = useState(true);
    const [config, setConfig] = useState<AntoniaConfig | null>(null);
    const [orgId, setOrgId] = useState<string | null>(null);
    const [userId, setUserId] = useState<string | null>(null);
    const [existingCampaigns, setExistingCampaigns] = useState<Campaign[]>([]);
    const [campaignSearch, setCampaignSearch] = useState('');

    // Wizard State
    const [step, setStep] = useState(1);
    const [wizardData, setWizardData] = useState({
        jobTitle: '',
        location: '',
        industry: '',
        keywords: '',
        companySize: '',
        seniorities: [] as string[],
        missionName: '',
        targetOutcome: 'meetings' as 'meetings' | 'positive_replies' | 'pipeline',
        targetMeetings: 5,
        targetPositiveReplies: 12,
        targetPipelineValue: 10000,
        targetTimelineDays: 30,
        idealCustomerProfile: '',
        valueProposition: '',
        enrichmentLevel: 'basic' as 'basic' | 'deep',
        campaignName: '',
        campaignContext: '',
        autoGenerateCampaign: false,
        dailySearchLimit: 1,
        dailyEnrichLimit: 10,
        dailyInvestigateLimit: 5,
        dailyContactLimit: 3
    });

    const [currentMissionTitle, setCurrentMissionTitle] = useState('');
    const [editingMissionId, setEditingMissionId] = useState<string | null>(null);
    const [deletingMissionId, setDeletingMissionId] = useState<string | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [activitySheetOpen, setActivitySheetOpen] = useState(false);
    const [selectedActivityMission, setSelectedActivityMission] = useState<AntoniaMission | null>(null);
    const [missionTunerOpen, setMissionTunerOpen] = useState(false);
    const [selectedTuneMission, setSelectedTuneMission] = useState<AntoniaMission | null>(null);

    // Reports State
    const [reports, setReports] = useState<any[]>([]);
    const [reportsLoading, setReportsLoading] = useState(false);
    const [selectedReport, setSelectedReport] = useState<any>(null);
    const [viewerOpen, setViewerOpen] = useState(false);

    // Integration Connection State
    const [googleConnected, setGoogleConnected] = useState(false);
    const [outlookConnected, setOutlookConnected] = useState(false);

    const supabase = createClientComponentClient();
    const router = useRouter();
    const { toast } = useToast();

    const missingStep1 = [
        !wizardData.location.trim() ? 'Ubicacion' : null,
        !wizardData.industry.trim() ? 'Industria' : null,
        !wizardData.companySize.trim() ? 'Tamano de empresa' : null,
    ].filter(Boolean) as string[];
    const canGoNext = step !== 1 || missingStep1.length === 0;
    const canLaunch = missingStep1.length === 0;

    useEffect(() => {
        async function loadData() {
            try {
                console.log('[ANTONIA] Loading user data...');
                const { data: { user }, error: userError } = await supabase.auth.getUser();

                if (userError) {
                    console.error('[ANTONIA] Error getting user:', userError);
                    toast({
                        variant: 'destructive',
                        title: 'Error de autenticación',
                        description: 'No se pudo verificar tu sesión. Intenta iniciar sesión nuevamente.'
                    });
                    setLoading(false);
                    return;
                }

                if (!user) {
                    console.warn('[ANTONIA] No user found');
                    setLoading(false);
                    return;
                }

                console.log('[ANTONIA] User loaded:', user.id);
                setUserId(user.id);

                const { data: members, error: memberError } = await supabase
                    .from('organization_members')
                    .select('organization_id')
                    .eq('user_id', user.id)
                    .limit(1);

                if (memberError) {
                    console.error('[ANTONIA] Error getting organization membership:', {
                        code: memberError.code,
                        message: memberError.message,
                        details: memberError.details,
                        hint: memberError.hint,
                        fullError: memberError
                    });
                    toast({
                        variant: 'destructive',
                        title: 'Error',
                        description: `No se pudo cargar tu organización: ${memberError.message || 'Error desconocido'}`
                    });
                    setLoading(false);
                    return;
                }

                if (!members || members.length === 0) {
                    console.warn('[ANTONIA] User is not a member of any organization');
                    toast({
                        variant: 'destructive',
                        title: 'Sin organización',
                        description: 'No perteneces a ninguna organización. Contacta al administrador.'
                    });
                    setLoading(false);
                    return;
                }

                const member = members[0];
                console.log('[ANTONIA] Organization loaded:', member.organization_id);
                setOrgId(member.organization_id);


                const [missionsData, configData, campaignsData] = await Promise.all([
                    antoniaService.getActiveMissions(member.organization_id),
                    antoniaService.getConfig(member.organization_id),
                    antoniaService.getCampaigns(member.organization_id)
                ]);

                console.log('[ANTONIA] Data loaded successfully', {
                    missions: missionsData.length,
                    hasConfig: !!configData,
                    campaigns: campaignsData.length
                });

                setMissions(missionsData);
                setConfig(configData);
                setExistingCampaigns(campaignsData as Campaign[]);
            } catch (error) {
                console.error('[ANTONIA] Unexpected error loading data:', error);
                toast({
                    variant: 'destructive',
                    title: 'Error',
                    description: 'Ocurrió un error al cargar los datos.'
                });
            } finally {
                setLoading(false);
            }
        }
        loadData();
    }, [supabase, toast]);

    // Load Reports
    useEffect(() => {
        const loadReports = async () => {
            if (!orgId) return;
            setReportsLoading(true);
            try {
                const data = await antoniaService.getReports(orgId);
                setReports(data);
            } catch (error) {
                console.error('Failed to load reports', error);
            } finally {
                setReportsLoading(false);
            }
        };
        if (orgId) loadReports();
    }, [orgId]);

    // Load integration connection status
    useEffect(() => {
        async function checkConnectionStatus() {
            if (!userId) return;

            try {
                // Source of truth for offline sending is provider_tokens (refresh token stored server-side)
                const { data, error } = await supabase
                    .from('provider_tokens')
                    .select('provider')
                    .eq('user_id', userId);

                if (error) {
                    console.error('[OAuth] Failed to load provider token status:', error);
                    return;
                }

                const providers = new Set((data || []).map((r: any) => r.provider));
                setGoogleConnected(providers.has('google'));
                setOutlookConnected(providers.has('outlook'));
            } catch (error) {
                console.error('[OAuth] Failed to load connection status:', error);
            }
        }
        checkConnectionStatus();
    }, [userId, supabase]);

    const handleCreateMission = async () => {
        if (isCreating) return;
        setIsCreating(true);

        console.log('[ANTONIA] Creating mission...', { orgId, userId, wizardData });

        if (!orgId || !userId) {
            console.error('[ANTONIA] Missing orgId or userId', { orgId, userId });
            toast({
                variant: 'destructive',
                title: 'Error',
                description: 'No se pudo identificar tu organización o usuario. Intenta recargar la página.'
            });
            setIsCreating(false);
            return;
        }

        try {
            const title = wizardData.missionName || `Buscar ${wizardData.jobTitle} en ${wizardData.location}`;
            const summary = buildMissionGoalSummary(wizardData);

            console.log('[ANTONIA] Creating mission with title:', title);

            const mission = await antoniaService.createMission(
                orgId,
                userId,
                title,
                summary,
                wizardData
            );

            console.log('[ANTONIA] Mission created:', mission);
            setMissions([mission, ...missions]);

            // Trigger the worker to start processing
            try {
                console.log('[ANTONIA] Triggering worker for mission:', mission.id);
                const triggerRes = await fetch('/api/antonia/trigger', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ missionId: mission.id })
                });

                if (!triggerRes.ok) {
                    const errorText = await triggerRes.text();
                    console.error('[ANTONIA] Failed to trigger mission:', errorText);
                    toast({
                        variant: 'destructive',
                        title: 'Advertencia',
                        description: 'La misión se creó pero no se pudo iniciar automáticamente.'
                    });
                }
            } catch (triggerError) {
                console.error('[ANTONIA] Error triggering mission:', triggerError);
                // Don't fail the whole operation if trigger fails
            }

            setStep(1);
            setWizardData({
                jobTitle: '',
                location: '',
                industry: '',
                keywords: '',
                companySize: '',
                seniorities: [],
                missionName: '',
                targetOutcome: 'meetings',
                targetMeetings: 5,
                targetPositiveReplies: 12,
                targetPipelineValue: 10000,
                targetTimelineDays: 30,
                idealCustomerProfile: '',
                valueProposition: '',
                enrichmentLevel: 'basic',
                campaignName: '',
                campaignContext: '',
                autoGenerateCampaign: false,
                dailySearchLimit: 1,
                dailyEnrichLimit: 10,
                dailyInvestigateLimit: 5,
                dailyContactLimit: 3
            });

            toast({ title: 'Misión Iniciada', description: 'ANTONIA está trabajando en tu tarea.' });
        } catch (error: any) {
            console.error('[ANTONIA] Error creating mission:', error);
            toast({
                variant: 'destructive',
                title: 'Error al crear misión',
                description: error.message || 'Ocurrió un error inesperado.'
            });
        } finally {
            setIsCreating(false);
        }
    };

    const handlePauseMission = async (mission: AntoniaMission) => {
        try {
            const newStatus = mission.status === 'active' ? 'paused' : 'active';
            await antoniaService.updateMission(mission.id, { status: newStatus as any });

            setMissions(missions.map(m =>
                m.id === mission.id ? { ...m, status: newStatus as any } : m
            ));

            toast({
                title: newStatus === 'active' ? 'Misión Reanudada' : 'Misión Pausada',
                description: `La misión ha sido ${newStatus === 'active' ? 'activada' : 'pausada'} correctamente.`
            });
        } catch (error) {
            console.error('[ANTONIA] Error toggling mission status:', error);
            toast({ variant: 'destructive', title: 'Error', description: 'No se pudo actualizar el estado de la misión.' });
        }
    };

    const startEditingMission = (mission: AntoniaMission) => {
        setEditingMissionId(mission.id);
        setCurrentMissionTitle(mission.title);
    };

    const saveMissionTitle = async (missionId: string) => {
        if (!currentMissionTitle.trim()) return;

        try {
            await antoniaService.updateMission(missionId, { title: currentMissionTitle });
            setMissions(missions.map(m =>
                m.id === missionId ? { ...m, title: currentMissionTitle } : m
            ));
            setEditingMissionId(null);
            toast({ title: 'Nombre actualizado' });
        } catch (error) {
            toast({ variant: 'destructive', title: 'Error', description: 'No se pudo renombrar la misión' });
        }
    };

    const confirmDeleteMission = async () => {
        if (!deletingMissionId) return;
        try {
            await antoniaService.deleteMission(deletingMissionId);
            setMissions(missions.filter(m => m.id !== deletingMissionId));
            setDeletingMissionId(null);
            toast({ title: 'Misión Eliminada' });
        } catch (error) {
            console.error('Error deleting mission:', error);
            toast({ variant: 'destructive', title: 'Error', description: 'No se pudo eliminar la misión.' });
        }
    };


    const handleGenerateReport = async (missionId: string) => {
        if (!orgId || !userId) return;
        toast({
            title: "Generando reporte...",
            description: "El reporte se está generando. Podrás verlo en la pestaña Reportes en unos momentos."
        });

        try {
            await antoniaService.generateMissionReport(orgId, missionId, userId);
            // Refresh reports list after delay
            setTimeout(async () => {
                const data = await antoniaService.getReports(orgId);
                setReports(data);
            }, 5000);
        } catch (error) {
            console.error(error);
            toast({ title: "Error", description: "Fallo al iniciar generación de reporte", variant: "destructive" });
        }
    };

    const handleViewReport = (report: any) => {
        setSelectedReport(report);
        setViewerOpen(true);
    };

    const handleMissionUpdatedFromTuner = (updatedMission: any) => {
        if (!updatedMission?.id) return;
        setMissions((prev) => prev.map((m) => {
            if (m.id !== updatedMission.id) return m;
            return {
                ...m,
                title: updatedMission.title ?? m.title,
                goalSummary: updatedMission.goalSummary ?? m.goalSummary,
                params: updatedMission.params ?? m.params,
                status: (updatedMission.status as any) ?? m.status,
                updatedAt: updatedMission.updatedAt ?? m.updatedAt,
            } as AntoniaMission;
        }));
    };

    const handleUpdateConfig = async (key: keyof AntoniaConfig, value: any) => {
        if (!orgId) return;
        try {
            // If config is null, use defaults
            const currentConfig = config || {
                organizationId: orgId,
                dailyReportEnabled: true,
                instantAlertsEnabled: true,
                dailySearchLimit: 3,
                dailyEnrichLimit: 50,
                dailyInvestigateLimit: 20,
                trackingEnabled: false,
                autopilotEnabled: true,
                autopilotMode: 'full_auto',
                approvalMode: 'low_score_only',
                minAutoSendScore: 70,
                minReviewScore: 45,
                bookingLink: '',
                meetingInstructions: '',
                replyAutopilotEnabled: false,
                replyAutopilotMode: 'draft_only',
                replyApprovalMode: 'high_risk_only',
                replyMaxAutoTurns: 2,
                autoSendBookingReplies: false,
                allowReplyAttachments: false,
                pauseOnNegativeReply: true,
                pauseOnFailureSpike: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            const newConfig = { ...currentConfig, [key]: value, organizationId: orgId };
            setConfig(newConfig);
            await antoniaService.upsertConfig(newConfig);
            toast({ title: 'Configuración Guardada' });
        } catch (e) {
            console.error('Error saving config:', e);
            toast({ title: 'Error al Guardar', variant: 'destructive' });
        }
    };

    // Email Management
    const [notificationEmails, setNotificationEmails] = useState<string[]>([]);
    const [newEmail, setNewEmail] = useState('');

    useEffect(() => {
        if (config?.notificationEmail) {
            setNotificationEmails(config.notificationEmail.split(',').filter(Boolean));
        }
    }, [config?.notificationEmail]);

    const handleAddEmail = () => {
        if (newEmail && newEmail.includes('@') && !notificationEmails.includes(newEmail)) {
            const updated = [...notificationEmails, newEmail];
            setNotificationEmails(updated);
            setNewEmail(''); // Clear input
            handleUpdateConfig('notificationEmail', updated.join(','));
        }
    };

    const handleRemoveEmail = (email: string) => {
        const updated = notificationEmails.filter(e => e !== email);
        setNotificationEmails(updated);
        handleUpdateConfig('notificationEmail', updated.join(','));
    };

    // OAuth Integration Handlers
    const handleConnectGoogle = () => {
        router.push('/gmail');
    };

    const handleConnectOutlook = () => {
        router.push('/outlook');
    };

    if (loading) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin h-8 w-8 text-primary" /></div>;

    return (
        <div className="container mx-auto space-y-6">
            <PageHeader
                title="Agente ANTON.IA"
                description="Configura misiones, revisa actividad y mantén el control sin navegar entre paneles innecesarios."
            />

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="h-auto w-full max-w-4xl justify-start gap-1 overflow-x-auto rounded-2xl border border-border/60 bg-card/70 p-1 shadow-[0_8px_24px_-20px_rgba(15,23,42,0.14)]">
                    <TabsTrigger value="builder">Crear Misión</TabsTrigger>
                    <TabsTrigger value="active">Activas ({missions.length})</TabsTrigger>
                    <TabsTrigger value="reportes" className="flex items-center gap-2">
                        <FileText className="w-4 h-4" /> Reportes
                    </TabsTrigger>
                    <TabsTrigger value="metrics" className="flex items-center gap-2">
                        <BarChart className="w-4 h-4" /> Métricas
                    </TabsTrigger>
                    <TabsTrigger value="settings" className="flex items-center gap-2">
                        <Settings className="w-4 h-4" /> Configuración
                    </TabsTrigger>
                </TabsList>

                {/* --- MISSION BUILDER WIZARD --- */}
                <TabsContent value="builder" className="space-y-6">
                    {/* Quota Usage Dashboard */}
                    <QuotaUsageCard />

                    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
                        <Card className="overflow-hidden rounded-[28px] border-border/60 bg-card/85 shadow-[0_10px_28px_-24px_rgba(15,23,42,0.16)] dark:bg-card/70">
                            <CardHeader>
                                <div className="flex justify-between items-center">
                                    <CardTitle>Nueva Misión</CardTitle>
                                    <Badge variant="outline">Paso {step} de 3</Badge>
                                </div>
                                <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-secondary">
                                    <div className="h-full bg-primary transition-all duration-500" style={{ width: `${(step / 3) * 100}%` }} />
                                </div>
                            </CardHeader>
                            <CardContent className="py-6">
                                {step === 1 && (
                                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                                        <h3 className="text-lg font-medium mb-4">Audiencia Objetivo</h3>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Label>Cargo / Puesto</Label>
                                                <Input
                                                    placeholder="ej. Director de Marketing"
                                                    value={wizardData.jobTitle}
                                                    onChange={(e) => setWizardData({ ...wizardData, jobTitle: e.target.value })}
                                                    autoFocus
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Ubicación</Label>
                                                <Input
                                                    placeholder="ej. Buenos Aires, Argentina"
                                                    value={wizardData.location}
                                                    onChange={(e) => setWizardData({ ...wizardData, location: e.target.value })}
                                                />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Label>Industria</Label>
                                                <Input
                                                    placeholder="ej. SaaS, Fintech, Salud"
                                                    value={wizardData.industry}
                                                    onChange={(e) => setWizardData({ ...wizardData, industry: e.target.value })}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Tamaño de Empresa</Label>
                                                <Select value={wizardData.companySize} onValueChange={(v) => setWizardData({ ...wizardData, companySize: v })}>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Seleccionar tamaño" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {companySizes.map(s => <SelectItem key={s} value={s}>{s.replace('+', ' o más')}</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Nivel de Management</Label>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="outline" role="combobox" className="justify-between w-full">
                                                        <span className="truncate">
                                                            {wizardData.seniorities.length === 0 ? 'Seleccionar niveles' :
                                                                wizardData.seniorities.length === 1 ? APOLLO_SENIORITIES.find(o => o.value === wizardData.seniorities[0])?.label ?? '1 seleccionado'
                                                                    : `${wizardData.seniorities.length} seleccionados`}
                                                        </span>
                                                        <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent className="w-full max-h-80 overflow-auto">
                                                    {APOLLO_SENIORITIES.map(opt => (
                                                        <DropdownMenuCheckboxItem
                                                            key={opt.value}
                                                            checked={wizardData.seniorities.includes(opt.value)}
                                                            onCheckedChange={(checked) => {
                                                                const set = new Set(wizardData.seniorities);
                                                                if (checked) set.add(opt.value); else set.delete(opt.value);
                                                                setWizardData({ ...wizardData, seniorities: Array.from(set) });
                                                            }}
                                                            className="capitalize"
                                                        >
                                                            {opt.label}
                                                        </DropdownMenuCheckboxItem>
                                                    ))}
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                            <p className="text-xs text-muted-foreground">Opcional: C-Level, VP, Director, Manager, etc.</p>
                                        </div>

                                        <div className="space-y-4 border p-4 rounded-lg bg-secondary/10">
                                            <div>
                                                <Label className="text-base font-semibold">Objetivo comercial</Label>
                                                <p className="text-xs text-muted-foreground mt-1">Define que resultado debe perseguir ANTONIA, no solo a quien buscar.</p>
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <Label>Outcome principal</Label>
                                                    <Select value={wizardData.targetOutcome} onValueChange={(v) => setWizardData({ ...wizardData, targetOutcome: v as 'meetings' | 'positive_replies' | 'pipeline' })}>
                                                        <SelectTrigger>
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="meetings">Reuniones</SelectItem>
                                                            <SelectItem value="positive_replies">Replies positivas</SelectItem>
                                                            <SelectItem value="pipeline">Pipeline</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>Ventana objetivo (dias)</Label>
                                                    <Input
                                                        type="number"
                                                        min="1"
                                                        max="365"
                                                        value={wizardData.targetTimelineDays}
                                                        onChange={(e) => setWizardData({ ...wizardData, targetTimelineDays: parseInt(e.target.value) || 30 })}
                                                    />
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <Label>{wizardData.targetOutcome === 'positive_replies' ? 'Replies objetivo' : 'Reuniones objetivo'}</Label>
                                                    <Input
                                                        type="number"
                                                        min="1"
                                                        max="500"
                                                        value={wizardData.targetOutcome === 'positive_replies' ? wizardData.targetPositiveReplies : wizardData.targetMeetings}
                                                        onChange={(e) => setWizardData({
                                                            ...wizardData,
                                                            [wizardData.targetOutcome === 'positive_replies' ? 'targetPositiveReplies' : 'targetMeetings']: parseInt(e.target.value) || (wizardData.targetOutcome === 'positive_replies' ? 12 : 5)
                                                        })}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>Meta de pipeline (opcional)</Label>
                                                    <Input
                                                        type="number"
                                                        min="1"
                                                        value={wizardData.targetPipelineValue}
                                                        onChange={(e) => setWizardData({ ...wizardData, targetPipelineValue: parseInt(e.target.value) || 10000 })}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {step === 2 && (
                                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                                        <div className="mb-4 space-y-1">
                                            <h3 className="text-lg font-medium">Cómo debe trabajar la misión</h3>
                                            <p className="text-sm text-muted-foreground">Completa solo lo que ayude a ANTONIA a encontrar mejores prospectos y redactar mensajes más precisos.</p>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Nombre de la Misión (Opcional)</Label>
                                            <Input
                                                placeholder="Ej. Directores de Operaciones en retail Chile"
                                                value={wizardData.missionName || ''}
                                                onChange={(e) => setWizardData({ ...wizardData, missionName: e.target.value })}
                                            />
                                            <p className="text-xs text-muted-foreground">Úsalo para reconocer esta misión rápido cuando tengas varias activas.</p>
                                        </div>
                                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                            <div className="space-y-2 rounded-2xl border border-border/60 bg-background/60 p-4">
                                                <div className="space-y-1">
                                                    <Label>Empresa o cuenta ideal</Label>
                                                    <p className="text-xs text-muted-foreground">Describe qué tipo de empresa vale la pena priorizar.</p>
                                                </div>
                                                <Textarea
                                                    rows={3}
                                                    placeholder="Ej. Empresas con varias sucursales, alta rotación de personal y necesidad frecuente de reforzar equipos operativos."
                                                    value={wizardData.idealCustomerProfile}
                                                    onChange={(e) => setWizardData({ ...wizardData, idealCustomerProfile: e.target.value })}
                                                />
                                            </div>
                                            <div className="space-y-2 rounded-2xl border border-border/60 bg-background/60 p-4">
                                                <div className="space-y-1">
                                                    <Label>Qué valor quieres destacar</Label>
                                                    <p className="text-xs text-muted-foreground">Resume el beneficio principal que ANTONIA debe usar en el outreach.</p>
                                                </div>
                                                <Textarea
                                                    rows={3}
                                                    placeholder="Ej. Ayudamos a cubrir dotación más rápido y a reducir la carga operativa con outsourcing flexible."
                                                    value={wizardData.valueProposition}
                                                    onChange={(e) => setWizardData({ ...wizardData, valueProposition: e.target.value })}
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-2 rounded-2xl border border-border/60 bg-background/60 p-4">
                                            <div className="space-y-1">
                                                <Label>Nivel de enriquecimiento</Label>
                                                <p className="text-xs text-muted-foreground">Elige cuánta información adicional quieres pedir por lead.</p>
                                            </div>
                                            <Select
                                                value={wizardData.enrichmentLevel}
                                                onValueChange={(v) => setWizardData({ ...wizardData, enrichmentLevel: v as 'basic' | 'deep' })}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="basic">Básico (Email verificado)</SelectItem>
                                                    <SelectItem value="deep">Profundo (Teléfonos + Redes Sociales)</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <p className="text-xs text-muted-foreground">El nivel profundo consume más créditos pero obtiene datos completos.</p>
                                        </div>

                                        <div className="space-y-4 rounded-2xl border border-border/60 bg-muted/10 p-5">
                                            <Label className="text-base font-semibold">Límites Diarios de esta Misión</Label>
                                            <p className="text-xs text-muted-foreground">Define cuánta actividad puede ejecutar la misión cada día. Empieza conservador y luego ajusta.</p>
                                            <div className="grid gap-2 md:grid-cols-4 text-xs">
                                                <div className="rounded-lg border bg-background p-3"><span className="text-muted-foreground">Búsquedas</span><div className="mt-1 font-medium">{wizardData.dailySearchLimit} / día</div></div>
                                                <div className="rounded-lg border bg-background p-3"><span className="text-muted-foreground">Enriquecimiento</span><div className="mt-1 font-medium">{wizardData.dailyEnrichLimit} / día</div></div>
                                                <div className="rounded-lg border bg-background p-3"><span className="text-muted-foreground">Investigación</span><div className="mt-1 font-medium">{wizardData.dailyInvestigateLimit} / día</div></div>
                                                <div className="rounded-lg border bg-background p-3"><span className="text-muted-foreground">Contacto</span><div className="mt-1 font-medium">{wizardData.dailyContactLimit} / día</div></div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <div className="flex items-center gap-2">
                                                        <Label className="text-sm">Búsquedas por día</Label>
                                                        <TooltipProvider>
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <div className="cursor-help text-muted-foreground hover:text-primary">
                                                                        <Bot className="w-3 h-3" />
                                                                    </div>
                                                                </TooltipTrigger>
                                                                <TooltipContent>
                                                                    <p className="max-w-xs">Número de veces que el agente buscará nuevos prospectos en LinkedIn y otras fuentes diariamente.</p>
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>
                                                    </div>
                                                    <Input
                                                        type="number"
                                                        min="1"
                                                        max="5"
                                                        value={wizardData.dailySearchLimit}
                                                        onChange={(e) => setWizardData({ ...wizardData, dailySearchLimit: parseInt(e.target.value) || 1 })}
                                                    />
                                                    <p className="text-xs text-muted-foreground">Máx: 5 búsquedas/día</p>
                                                </div>

                                                <div className="space-y-2">
                                                    <div className="flex items-center gap-2">
                                                        <Label className="text-sm">Leads a enriquecer</Label>
                                                        <TooltipProvider>
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <div className="cursor-help text-muted-foreground hover:text-primary">
                                                                        <Sparkles className="w-3 h-3" />
                                                                    </div>
                                                                </TooltipTrigger>
                                                                <TooltipContent>
                                                                    <p className="max-w-xs">Cantidad máxima de personas cuyos correos electrónicos serán verificados y validados por día.</p>
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>
                                                    </div>
                                                    <Input
                                                        type="number"
                                                        min="1"
                                                        max="50"
                                                        value={wizardData.dailyEnrichLimit}
                                                        onChange={(e) => setWizardData({ ...wizardData, dailyEnrichLimit: parseInt(e.target.value) || 10 })}
                                                    />
                                                    <p className="text-xs text-muted-foreground">Máx: 50 leads/día</p>
                                                </div>

                                                <div className="space-y-2">
                                                    <div className="flex items-center gap-2">
                                                        <Label className="text-sm">Leads a investigar</Label>
                                                        <TooltipProvider>
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <div className="cursor-help text-muted-foreground hover:text-primary">
                                                                        <Search className="w-3 h-3" />
                                                                    </div>
                                                                </TooltipTrigger>
                                                                <TooltipContent>
                                                                    <p className="max-w-xs">Cantidad de perfiles que serán analizados en profundidad (skills, actividad reciente) para personalizar mensajes.</p>
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>
                                                    </div>
                                                    <Input
                                                        type="number"
                                                        min="1"
                                                        max="50"
                                                        value={wizardData.dailyInvestigateLimit}
                                                        onChange={(e) => setWizardData({ ...wizardData, dailyInvestigateLimit: parseInt(e.target.value) || 5 })}
                                                    />
                                                    <p className="text-xs text-muted-foreground">Máx: 50 leads/día</p>
                                                </div>

                                                <div className="space-y-2">
                                                    <div className="flex items-center gap-2">
                                                        <Label className="text-sm">Leads a contactar</Label>
                                                        <TooltipProvider>
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <div className="cursor-help text-muted-foreground hover:text-primary">
                                                                        <FileText className="w-3 h-3" />
                                                                    </div>
                                                                </TooltipTrigger>
                                                                <TooltipContent>
                                                                    <p className="max-w-xs">Número máximo de correos electrónicos de primer contacto que se enviarán automáticamente por día.</p>
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </TooltipProvider>
                                                    </div>
                                                    <Input
                                                        type="number"
                                                        min="1"
                                                        max="50"
                                                        value={wizardData.dailyContactLimit}
                                                        onChange={(e) => setWizardData({ ...wizardData, dailyContactLimit: parseInt(e.target.value) || 3 })}
                                                    />
                                                    <p className="text-xs text-muted-foreground">Máx: 50 contactos/día</p>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-4 rounded-2xl border border-border/60 bg-muted/10 p-5">
                                            <div className="flex items-center justify-between">
                                                <div className="space-y-0.5">
                                                    <Label>Campaña inteligente</Label>
                                                    <p className="text-xs text-muted-foreground">Elige si quieres que ANTONIA genere una campaña nueva o la sume a una existente.</p>
                                                </div>
                                                <Switch
                                                    checked={wizardData.autoGenerateCampaign}
                                                    onCheckedChange={(c) => setWizardData({ ...wizardData, autoGenerateCampaign: c, campaignName: c ? '' : wizardData.campaignName })}
                                                />
                                            </div>

                                            {!wizardData.autoGenerateCampaign && (
                                                <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                                                    <div className="flex items-center gap-2">
                                                        <Search className="w-4 h-4 text-muted-foreground" />
                                                        <Input
                                                            placeholder="Buscar campaña existente"
                                                            value={campaignSearch}
                                                            onChange={(e) => setCampaignSearch(e.target.value)}
                                                            className="h-8"
                                                        />
                                                    </div>

                                                    <div className="border rounded-md max-h-[200px] overflow-auto">
                                                        <Table>
                                                            <TableHeader>
                                                                <TableRow>
                                                                    <TableHead>Nombre</TableHead>
                                                                    <TableHead>Estado</TableHead>
                                                                    <TableHead className="text-right">Creación</TableHead>
                                                                </TableRow>
                                                            </TableHeader>
                                                            <TableBody>
                                                                {existingCampaigns
                                                                    .filter(c => c.name.toLowerCase().includes(campaignSearch.toLowerCase()))
                                                                    .map((campaign) => (
                                                                        <TableRow
                                                                            key={campaign.id}
                                                                            className={`cursor-pointer transition-colors ${wizardData.campaignName === campaign.name ? 'bg-primary/10 border-l-4 border-primary' : 'hover:bg-secondary/50'}`}
                                                                            onClick={() => setWizardData({ ...wizardData, campaignName: campaign.name })}
                                                                        >
                                                                            <TableCell className="font-medium">
                                                                                {campaign.name}
                                                                                {wizardData.campaignName === campaign.name && (
                                                                                    <CheckCircle2 className="w-3 h-3 text-primary inline ml-2" />
                                                                                )}
                                                                            </TableCell>
                                                                            <TableCell>
                                                                                <Badge variant={campaign.status === 'paused' ? "secondary" : "default"} className="text-[10px] h-5">
                                                                                    {campaign.status === 'paused' ? 'Pausada' : 'Activa'}
                                                                                </Badge>
                                                                            </TableCell>
                                                                            <TableCell className="text-right text-xs text-muted-foreground">
                                                                                {new Date(campaign.createdAt).toLocaleDateString()}
                                                                            </TableCell>
                                                                        </TableRow>
                                                                    ))}
                                                                {existingCampaigns.length === 0 && (
                                                                    <TableRow>
                                                                        <TableCell colSpan={3} className="text-center py-4 text-muted-foreground">
                                                                            No tienes campañas creadas.
                                                                        </TableCell>
                                                                    </TableRow>
                                                                )}
                                                            </TableBody>
                                                        </Table>
                                                    </div>
                                                    {wizardData.campaignName && !existingCampaigns.find(c => c.name === wizardData.campaignName) && (
                                                        <p className="text-xs text-yellow-600 dark:text-yellow-400">
                                                            Nota: "{wizardData.campaignName}" no coincide con ninguna campaña existente. Se creará una nueva si no es intencional.
                                                        </p>
                                                    )}
                                                </div>
                                            )}

                                            {wizardData.autoGenerateCampaign && (
                                                <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                                                    <Label>Contexto Adicional (Opcional)</Label>
                                                    <Input
                                                        placeholder="ej. 'Sé formal y enfócate en ROI'"
                                                        value={wizardData.campaignContext || ''}
                                                        onChange={(e) => setWizardData({ ...wizardData, campaignContext: e.target.value })}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {step === 3 && (
                                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                                        <h3 className="text-lg font-medium mb-4">Resumen de la Misión</h3>
                                        <div className="bg-secondary/30 p-4 rounded-lg border space-y-3">
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">Objetivo:</span>
                                                <span className="font-medium">{wizardData.jobTitle} en {wizardData.industry}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">Meta:</span>
                                                <span className="font-medium">{shortMissionGoalLabel(wizardData)}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">Ubicación:</span>
                                                <span className="font-medium">{wizardData.location}</span>
                                            </div>
                                            {wizardData.valueProposition && (
                                                <div className="flex justify-between gap-4">
                                                    <span className="text-muted-foreground">Valor:</span>
                                                    <span className="font-medium text-right">{wizardData.valueProposition}</span>
                                                </div>
                                            )}
                                            {wizardData.keywords && (
                                                <div className="flex justify-between">
                                                    <span className="text-muted-foreground">Filtros:</span>
                                                    <span className="font-medium">{wizardData.keywords}</span>
                                                </div>
                                            )}
                                            <Separator />
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">Enriquecimiento:</span>
                                                <span className="font-medium capitalize">{wizardData.enrichmentLevel}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">Acción:</span>
                                                <span className="font-medium">
                                                    {wizardData.autoGenerateCampaign
                                                        ? 'Generar Campaña IA'
                                                        : (wizardData.campaignName ? `Agregar a '${wizardData.campaignName}'` : 'Solo Guardar')}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-green-50 dark:bg-green-950/20 p-3 rounded-lg border border-green-200 dark:border-green-800">
                                            <CheckCircle2 className="w-4 h-4 text-green-600" />
                                            <span>Listo para lanzar. ANTONIA comenzará a buscar inmediatamente.</span>
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                            <CardFooter className="flex justify-between border-t bg-muted/10 py-4">
                                <Button
                                    variant="ghost"
                                    onClick={() => setStep(s => Math.max(1, s - 1))}
                                    disabled={step === 1}
                                >
                                    Atrás
                                </Button>
                                {step < 3 ? (
                                    <Button
                                        onClick={() => setStep(s => Math.min(3, s + 1))}
                                        disabled={!canGoNext}
                                        title={!canGoNext ? `Completa: ${missingStep1.join(', ')}` : undefined}
                                    >
                                        Siguiente <ArrowRight className="w-4 h-4 ml-2" />
                                    </Button>
                                ) : (
                                    <Button
                                        onClick={handleCreateMission}
                                        disabled={!canLaunch}
                                        title={!canLaunch ? `Completa: ${missingStep1.join(', ')}` : undefined}
                                        className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white shadow-md"
                                    >
                                        <Play className="w-4 h-4 mr-2" /> Lanzar Misión
                                    </Button>
                                )}
                            </CardFooter>
                        </Card>

                        <div className="space-y-6">
                            {orgId && <ActiveAgentsPanel organizationId={orgId} />}
                            <Card className="rounded-[24px] border-border/60 bg-card/80 shadow-[0_10px_28px_-24px_rgba(15,23,42,0.16)] dark:bg-card/70">
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-base">Cómo trabaja ANTONIA</CardTitle>
                                    <CardDescription>Solo lo esencial para entender el flujo antes de lanzar una misión.</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4 text-sm">
                                    <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                                        <div className="font-medium">1. Define a quién buscar</div>
                                        <p className="mt-1 text-muted-foreground">Cargo, ubicación, industria y tamaño de empresa.</p>
                                    </div>
                                    <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                                        <div className="font-medium">2. Ajusta el ritmo diario</div>
                                        <p className="mt-1 text-muted-foreground">Búsqueda, enriquecimiento, investigación y contacto.</p>
                                    </div>
                                    <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                                        <div className="font-medium">3. Lanza y revisa</div>
                                        <p className="mt-1 text-muted-foreground">ANTONIA ejecuta y tú supervisas donde haga falta.</p>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="active" className="space-y-6">
                    {/* Quota Usage Dashboard (Visible locally in active tab too) */}
                    <QuotaUsageCard />

                    {orgId && <ActiveAgentsPanel organizationId={orgId} />}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {missions.length === 0 ? (
                            <div className="col-span-full flex flex-col items-center justify-center py-16 text-muted-foreground border-2 border-dashed rounded-xl">
                                <Bot className="w-12 h-12 mb-4 opacity-50" />
                                <p className="text-lg font-medium">No hay misiones activas</p>
                                <p className="text-sm">Crea una nueva misión para comenzar.</p>
                            </div>
                        ) : (
                            missions.map((mission) => (
                                <Card key={mission.id} className="relative overflow-hidden group hover:border-primary/50 transition-colors">
                                    <div className="absolute top-0 right-0 p-2 opacity-50">
                                        <Bot className="w-12 h-12 text-secondary" />
                                    </div>
                                    <CardHeader>
                                        <div className="flex justify-between items-start relative z-10">
                                            <Badge variant={mission.status === 'active' ? 'default' : 'secondary'} className={mission.status === 'active' ? 'bg-green-500' : ''}>
                                                {mission.status === 'active' ? 'ACTIVA' : mission.status === 'paused' ? 'PAUSADA' : mission.status.toUpperCase()}
                                            </Badge>
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs text-muted-foreground">
                                                    {mission.createdAt ? new Date(mission.createdAt).toLocaleDateString('es-AR') : '-'}
                                                </span>
                                                {editingMissionId !== mission.id && (
                                                    <>
                                                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => startEditingMission(mission)}>
                                                            <Edit2 className="w-3 h-3 text-muted-foreground" />
                                                        </Button>
                                                        <Button variant="ghost" size="icon" className="h-6 w-6 hover:text-red-500" onClick={() => setDeletingMissionId(mission.id)}>
                                                            <Trash2 className="w-3 h-3 text-muted-foreground hover:text-red-500" />
                                                        </Button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        {editingMissionId === mission.id ? (
                                            <div className="flex items-center gap-2 mt-2 relative z-20">
                                                <Input
                                                    value={currentMissionTitle}
                                                    onChange={(e) => setCurrentMissionTitle(e.target.value)}
                                                    className="h-8 text-sm"
                                                    autoFocus
                                                />
                                                <Button size="sm" onClick={() => saveMissionTitle(mission.id)} className="h-8">Guardar</Button>
                                                <Button size="icon" variant="ghost" onClick={() => setEditingMissionId(null)} className="h-8 w-8">
                                                    <X className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        ) : (
                                            <CardTitle className="mt-2 line-clamp-1 relative z-10">{mission.title}</CardTitle>
                                        )}
                                    </CardHeader>
                                    <CardContent className="relative z-10">
                                        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                                            {mission.goalSummary}
                                        </p>

                                        {mission.params?.targetOutcome && (
                                            <div className="mb-3 flex flex-wrap gap-2">
                                                <Badge variant="outline">{shortMissionGoalLabel(mission.params)}</Badge>
                                            </div>
                                        )}

                                        {/* Mission Parameters */}
                                        <div className="mb-4 p-3 bg-secondary/20 rounded-lg border text-xs space-y-1">
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">Objetivo:</span>
                                                <span className="font-medium">{mission.params?.jobTitle || 'N/A'}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">Ubicación:</span>
                                                <span className="font-medium">{mission.params?.location || 'N/A'}</span>
                                            </div>
                                            {mission.params?.industry && (
                                                <div className="flex justify-between">
                                                    <span className="text-muted-foreground">Industria:</span>
                                                    <span className="font-medium">{mission.params.industry}</span>
                                                </div>
                                            )}
                                        </div>

                                        <div className="mt-4 grid grid-cols-2 gap-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="w-full"
                                                onClick={() => {
                                                    setSelectedActivityMission(mission);
                                                    setActivitySheetOpen(true);
                                                }}
                                            >
                                                <Sparkles className="w-3 h-3 mr-2 text-indigo-500" /> Actividad
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="w-full"
                                                onClick={() => handleGenerateReport(mission.id)}
                                            >
                                                <FileText className="w-3 h-3 mr-2" /> Reporte Histórico
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="w-full col-span-2"
                                                onClick={() => {
                                                    setSelectedTuneMission(mission);
                                                    setMissionTunerOpen(true);
                                                }}
                                            >
                                                <WandSparkles className="w-3 h-3 mr-2 text-emerald-500" /> Ajustar misión con IA
                                            </Button>
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                className="w-full col-span-2"
                                                onClick={() => handlePauseMission(mission)}
                                            >
                                                {mission.status === 'active' ? <Pause className="w-3 h-3 mr-2" /> : <Play className="w-3 h-3 mr-2" />}
                                                {mission.status === 'active' ? 'Pausar' : 'Reanudar'}
                                            </Button>
                                        </div>
                                    </CardContent>
                                    {mission.status === 'active' && (
                                        <div className="absolute bottom-0 left-0 h-1 bg-primary/20 w-full">
                                            <div className="h-full bg-gradient-to-r from-purple-600 to-pink-600 w-1/3 animate-pulse"></div>
                                        </div>
                                    )}
                                </Card>
                            ))
                        )}
                    </div>
                </TabsContent>

                <TabsContent value="reportes" className="space-y-6">
                    <div className="grid grid-cols-1 gap-6">
                        <ReportsHistory
                            reports={reports}
                            loading={reportsLoading}
                            onView={handleViewReport}
                        />
                    </div>
                </TabsContent>

                <TabsContent value="metrics">
                    <Card>
                        <CardHeader>
                            <CardTitle>Rendimiento de Campañas</CardTitle>
                            <CardDescription>Visualiza las tasas de apertura y respuesta de tus misiones.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {orgId && <MetricsDashboard organizationId={orgId} />}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="settings" className="space-y-6">
                    <Card className="overflow-hidden rounded-[28px] border-border/60 bg-card/85 shadow-[0_10px_28px_-24px_rgba(15,23,42,0.16)] dark:bg-card/70">
                        <CardHeader className="border-b border-border/60 bg-muted/10">
                            <CardTitle>Configuración de ANTONIA</CardTitle>
                            <CardDescription>Deja visibles solo las decisiones importantes. El resto queda resumido o plegado.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6 p-6">
                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Modo</div>
                                    <div className="mt-2 font-medium">{config?.autopilotEnabled ? simplifyAutopilotModeLabel(config?.autopilotMode) : 'Asistida / manual'}</div>
                                </div>
                                <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Aprobación</div>
                                    <div className="mt-2 font-medium">{config?.approvalMode === 'all_contacts' ? 'Todo' : config?.approvalMode === 'high_risk_only' ? 'Solo alto riesgo' : config?.approvalMode === 'disabled' ? 'Sin aprobación' : 'Solo leads dudosos'}</div>
                                </div>
                                <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Tracking</div>
                                    <div className="mt-2 font-medium">{config?.trackingEnabled ? 'Activo' : 'Inactivo'}</div>
                                </div>
                                <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Booking link</div>
                                    <div className="mt-2 truncate font-medium">{config?.bookingLink || 'No configurado'}</div>
                                </div>
                            </div>

                            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
                                <Card className="rounded-[24px] border-border/60 shadow-none">
                                    <CardHeader className="pb-3">
                                        <CardTitle className="text-base">Controles principales</CardTitle>
                                        <CardDescription>Lo mínimo para definir cómo trabaja ANTONIA y cómo te avisa.</CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-5">
                                        <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-background/70 p-4">
                                            <div className="space-y-1">
                                                <Label htmlFor="daily-report">Reporte diario por email</Label>
                                                <p className="text-sm text-muted-foreground">Resumen automático una vez al día.</p>
                                            </div>
                                            <Switch
                                                id="daily-report"
                                                checked={config?.dailyReportEnabled}
                                                onCheckedChange={(c) => handleUpdateConfig('dailyReportEnabled', c)}
                                            />
                                        </div>
                                        <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-background/70 p-4">
                                            <div className="space-y-1">
                                                <Label htmlFor="instant-alerts">Alertas instantáneas</Label>
                                                <p className="text-sm text-muted-foreground">Avisos inmediatos cuando aparece algo urgente.</p>
                                            </div>
                                            <Switch
                                                id="instant-alerts"
                                                checked={config?.instantAlertsEnabled}
                                                onCheckedChange={(c) => handleUpdateConfig('instantAlertsEnabled', c)}
                                            />
                                        </div>
                                        <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-background/70 p-4">
                                            <div className="space-y-1">
                                                <Label htmlFor="tracking-enabled">Tracking de aperturas</Label>
                                                <p className="text-sm text-muted-foreground">Medir aperturas en los emails enviados.</p>
                                            </div>
                                            <Switch
                                                id="tracking-enabled"
                                                checked={!!config?.trackingEnabled}
                                                onCheckedChange={(c) => handleUpdateConfig('trackingEnabled', c)}
                                            />
                                        </div>

                                        <div className="grid gap-4 md:grid-cols-2">
                                            <div className="space-y-2">
                                                <Label>Modo de trabajo</Label>
                                                <Select
                                                    value={config?.autopilotMode || 'manual_assist'}
                                                    onValueChange={(value) => handleUpdateConfig('autopilotMode', value)}
                                                >
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Selecciona modo" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="manual_assist">Manual Assist</SelectItem>
                                                        <SelectItem value="semi_auto">Semi Auto</SelectItem>
                                                        <SelectItem value="full_auto">Full Auto</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Política de aprobación</Label>
                                                <Select
                                                    value={config?.approvalMode || 'low_score_only'}
                                                    onValueChange={(value) => handleUpdateConfig('approvalMode', value)}
                                                >
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Selecciona política" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="all_contacts">Aprobar todos</SelectItem>
                                                        <SelectItem value="low_score_only">Solo score bajo</SelectItem>
                                                        <SelectItem value="high_risk_only">Solo alto riesgo</SelectItem>
                                                        <SelectItem value="disabled">Sin aprobación</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card className="rounded-[24px] border-border/60 shadow-none">
                                    <CardHeader className="pb-3">
                                        <CardTitle className="text-base">Canales y contacto</CardTitle>
                                        <CardDescription>Qué cuentas puede usar ANTONIA y dónde debe avisarte.</CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-5">
                                        <div className="space-y-3">
                                            <Label>Emails de notificación</Label>
                                            <div className="flex gap-2">
                                                <Input
                                                    placeholder="equipo@empresa.com"
                                                    value={newEmail}
                                                    onChange={(e) => setNewEmail(e.target.value)}
                                                    onKeyDown={(e) => e.key === 'Enter' && handleAddEmail()}
                                                />
                                                <Button onClick={handleAddEmail} size="icon" className="shadow-none">
                                                    <Plus className="w-4 h-4" />
                                                </Button>
                                            </div>
                                            <div className="space-y-2 rounded-2xl border border-border/60 bg-background/70 p-3">
                                                {notificationEmails.length > 0 ? notificationEmails.map((email) => (
                                                    <div key={email} className="flex items-center justify-between gap-3 rounded-xl bg-background px-3 py-2">
                                                        <span className="truncate text-sm">{email}</span>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => handleRemoveEmail(email)}
                                                            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </div>
                                                )) : <div className="px-1 py-2 text-sm text-muted-foreground">No hay emails configurados.</div>}
                                            </div>
                                        </div>

                                        <div className="space-y-3">
                                            <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                                                <div className="font-medium">Google / Gmail</div>
                                                <p className="mt-1 text-sm text-muted-foreground">Cuenta principal para envío automático.</p>
                                                <Button variant="outline" className="mt-3 shadow-none" onClick={handleConnectGoogle}>
                                                    <Settings className="mr-2 h-4 w-4" />
                                                    {googleConnected ? 'Reconectar' : 'Conectar'}
                                                </Button>
                                            </div>
                                            <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                                                <div className="font-medium">Microsoft Outlook</div>
                                                <p className="mt-1 text-sm text-muted-foreground">Alternativa para envío automático.</p>
                                                <Button variant="outline" className="mt-3 shadow-none" onClick={handleConnectOutlook}>
                                                    <Settings className="mr-2 h-4 w-4" />
                                                    {outlookConnected ? 'Reconectar' : 'Conectar'}
                                                </Button>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>

                            <Accordion type="multiple" className="w-full space-y-4">
                                <AccordionItem value="limits" className="overflow-hidden rounded-[24px] border border-border/60 px-0">
                                    <AccordionTrigger className="px-5 py-4 text-base font-medium hover:no-underline">Límites diarios</AccordionTrigger>
                                    <AccordionContent className="px-5 pb-5">
                                        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                                            <div className="space-y-2">
                                                <Label htmlFor="search-limit">Búsquedas</Label>
                                                <Input
                                                    id="search-limit"
                                                    type="number"
                                                    min="1"
                                                    max="5"
                                                    defaultValue={config?.dailySearchLimit ?? 3}
                                                    onBlur={(e) => {
                                                        const val = parseInt(e.target.value);
                                                        if (!isNaN(val) && val > 0) handleUpdateConfig('dailySearchLimit', val);
                                                    }}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="enrich-limit">Enriquecimientos</Label>
                                                <Input
                                                    id="enrich-limit"
                                                    type="number"
                                                    min="1"
                                                    max="50"
                                                    defaultValue={config?.dailyEnrichLimit ?? 50}
                                                    onBlur={(e) => {
                                                        const val = parseInt(e.target.value);
                                                        if (!isNaN(val) && val > 0) handleUpdateConfig('dailyEnrichLimit', val);
                                                    }}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="investigate-limit">Investigaciones</Label>
                                                <Input
                                                    id="investigate-limit"
                                                    type="number"
                                                    min="1"
                                                    max="50"
                                                    defaultValue={config?.dailyInvestigateLimit ?? 20}
                                                    onBlur={(e) => {
                                                        const val = parseInt(e.target.value);
                                                        if (!isNaN(val) && val > 0) handleUpdateConfig('dailyInvestigateLimit', val);
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>

                                <AccordionItem value="advanced" className="overflow-hidden rounded-[24px] border border-border/60 px-0">
                                    <AccordionTrigger className="px-5 py-4 text-base font-medium hover:no-underline">Controles avanzados</AccordionTrigger>
                                    <AccordionContent className="space-y-6 px-5 pb-5">
                                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                            <div className="space-y-2 rounded-xl border bg-card p-4">
                                                <div className="flex items-center justify-between gap-3">
                                                    <div>
                                                        <Label htmlFor="autopilot-enabled">Activar autopilot</Label>
                                                        <p className="text-xs text-muted-foreground">Habilita decisiones automáticas con guardrails.</p>
                                                    </div>
                                                    <Switch
                                                        id="autopilot-enabled"
                                                        checked={!!config?.autopilotEnabled}
                                                        onCheckedChange={(value) => handleUpdateConfig('autopilotEnabled', value)}
                                                    />
                                                </div>
                                            </div>
                                            <div className="space-y-2 rounded-xl border bg-card p-4">
                                                <Label htmlFor="min-auto-send">Auto-send</Label>
                                                <Input
                                                    key={`min-auto-send-${config?.minAutoSendScore ?? 70}`}
                                                    id="min-auto-send"
                                                    type="number"
                                                    min="0"
                                                    max="100"
                                                    defaultValue={config?.minAutoSendScore ?? 70}
                                                    onBlur={(event) => handleUpdateConfig('minAutoSendScore', Number(event.target.value || 0))}
                                                />
                                            </div>
                                            <div className="space-y-2 rounded-xl border bg-card p-4">
                                                <Label htmlFor="min-review">Review</Label>
                                                <Input
                                                    key={`min-review-${config?.minReviewScore ?? 45}`}
                                                    id="min-review"
                                                    type="number"
                                                    min="0"
                                                    max="100"
                                                    defaultValue={config?.minReviewScore ?? 45}
                                                    onBlur={(event) => handleUpdateConfig('minReviewScore', Number(event.target.value || 0))}
                                                />
                                            </div>
                                            <div className="space-y-2 rounded-xl border bg-card p-4">
                                                <div className="flex items-center justify-between gap-3">
                                                    <div>
                                                        <Label htmlFor="pause-negative">Pausar por reply negativo</Label>
                                                        <p className="text-xs text-muted-foreground">Protege reputación.</p>
                                                    </div>
                                                    <Switch
                                                        id="pause-negative"
                                                        checked={!!config?.pauseOnNegativeReply}
                                                        onCheckedChange={(value) => handleUpdateConfig('pauseOnNegativeReply', value)}
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        <div className="grid gap-4 md:grid-cols-2">
                                            <div className="space-y-2 rounded-xl border bg-card p-4">
                                                <Label htmlFor="booking-link">Booking link</Label>
                                                <Input
                                                    key={`booking-link-${config?.bookingLink || ''}`}
                                                    id="booking-link"
                                                    defaultValue={config?.bookingLink || ''}
                                                    placeholder="https://calendly.com/tu-equipo/demo"
                                                    onBlur={(event) => handleUpdateConfig('bookingLink', event.target.value)}
                                                />
                                            </div>
                                            <div className="space-y-2 rounded-xl border bg-card p-4">
                                                <Label htmlFor="meeting-instructions">Notas para reuniones</Label>
                                                <Textarea
                                                    key={`meeting-instructions-${config?.meetingInstructions || ''}`}
                                                    id="meeting-instructions"
                                                    defaultValue={config?.meetingInstructions || ''}
                                                    placeholder="Contexto que ANTONIA debe usar cuando un lead pide reunión."
                                                    onBlur={(event) => handleUpdateConfig('meetingInstructions', event.target.value)}
                                                    className="min-h-[96px]"
                                                />
                                            </div>
                                        </div>

                                        <div className="grid gap-6 xl:grid-cols-2">
                                            <AutopilotControlCenter config={config} onUpdateConfig={handleUpdateConfig} />
                                            <AutopilotExecutiveReportPanel />
                                        </div>
                                        <div className="grid gap-6 xl:grid-cols-2">
                                            <AutopilotExceptionsPanel />
                                            <AutopilotNextActionsPanel onOpenTab={(tab) => setActiveTab(tab === 'autopilot' ? 'settings' : tab)} />
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>
                            </Accordion>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>


            <AlertDialog open={!!deletingMissionId} onOpenChange={(open) => !open && setDeletingMissionId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Estás seguro?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Esta acción no se puede deshacer. Esto eliminará permanentemente la misión y todos sus datos asociados, incluyendo logs y tareas pendientes.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDeleteMission} className="bg-red-600 hover:bg-red-700">
                            Eliminar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <Sheet open={activitySheetOpen} onOpenChange={setActivitySheetOpen}>
                <SheetContent side="right" className="w-full sm:w-[600px] sm:max-w-[600px] p-0 flex flex-col">
                    <SheetHeader className="px-6 py-4 border-b">
                        <SheetTitle>Detalles: {selectedActivityMission?.title || 'Misión'}</SheetTitle>
                    </SheetHeader>

                    {selectedActivityMission && (
                        <Tabs defaultValue="activity" className="flex-1 flex flex-col overflow-hidden">
                            <div className="px-6 pt-2 border-b">
                                <TabsList className="grid w-full grid-cols-3">
                                    <TabsTrigger value="activity">Actividad</TabsTrigger>
                                    <TabsTrigger value="queues">Cola de Leads</TabsTrigger>
                                    <TabsTrigger value="audit">Auditoria</TabsTrigger>
                                </TabsList>
                            </div>

                            <TabsContent value="activity" className="flex-1 overflow-hidden p-0 m-0 relative">
                                <div className="absolute inset-0">
                                    <AgentActivityFeed missionId={selectedActivityMission.id} />
                                </div>
                            </TabsContent>

                            <TabsContent value="queues" className="flex-1 overflow-hidden p-0 m-0 relative">
                                <div className="absolute inset-0">
                                    <MissionQueues missionId={selectedActivityMission.id} />
                                </div>
                            </TabsContent>

                            <TabsContent value="audit" className="flex-1 overflow-hidden p-0 m-0 relative">
                                <div className="absolute inset-0">
                                    <LeadAuditTrail missionId={selectedActivityMission.id} />
                                </div>
                            </TabsContent>
                        </Tabs>
                    )}
                </SheetContent>
            </Sheet>

            <ReportViewer
                isOpen={viewerOpen}
                onClose={() => setViewerOpen(false)}
                report={selectedReport}
            />

            <MissionTunerDialog
                open={missionTunerOpen}
                onOpenChange={setMissionTunerOpen}
                mission={selectedTuneMission}
                onMissionUpdated={handleMissionUpdatedFromTuner}
            />
        </div >
    );
}
