'use client';

import React, { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { antoniaService } from '@/lib/services/antonia-service';
import { AntoniaMission, AntoniaConfig, Campaign } from '@/lib/types';
import { googleAuthService } from '@/lib/google-auth-service';
import { microsoftAuthService } from '@/lib/microsoft-auth-service';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
    X
} from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
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
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';

export default function AntoniaPage() {
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
        enrichmentLevel: 'basic' as 'basic' | 'deep',
        campaignName: '',
        campaignContext: '',
        autoGenerateCampaign: false,
        missionLimit: 20
    });

    const [logsOpen, setLogsOpen] = useState(false);
    const [taskLogs, setTaskLogs] = useState<any[]>([]);
    const [currentMissionTitle, setCurrentMissionTitle] = useState('');
    const [editingMissionId, setEditingMissionId] = useState<string | null>(null);
    const [logsLoading, setLogsLoading] = useState(false);
    const [deletingMissionId, setDeletingMissionId] = useState<string | null>(null);

    // Integration Connection State
    const [googleConnected, setGoogleConnected] = useState(false);
    const [outlookConnected, setOutlookConnected] = useState(false);
    const [connectingProvider, setConnectingProvider] = useState<'google' | 'outlook' | null>(null);

    const supabase = createClientComponentClient();
    const { toast } = useToast();

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

    // Load integration connection status
    useEffect(() => {
        async function checkConnectionStatus() {
            if (!userId) return;

            try {
                const res = await fetch('/api/integrations/store-token');
                if (res.ok) {
                    const connections = await res.json();
                    setGoogleConnected(connections.google || false);
                    setOutlookConnected(connections.outlook || false);
                }
            } catch (error) {
                console.error('[OAuth] Failed to load connection status:', error);
            }
        }
        checkConnectionStatus();
    }, [userId]);

    const handleCreateMission = async () => {
        console.log('[ANTONIA] Creating mission...', { orgId, userId, wizardData });

        if (!orgId || !userId) {
            console.error('[ANTONIA] Missing orgId or userId', { orgId, userId });
            toast({
                variant: 'destructive',
                title: 'Error',
                description: 'No se pudo identificar tu organización o usuario. Intenta recargar la página.'
            });
            return;
        }

        try {
            // Smart Limit Validation
            const globalLimit = config?.dailyEnrichLimit || 50;
            const currentUsage = missions.reduce((acc, m) => acc + (m.params?.missionLimit || 0), 0);
            const needed = wizardData.missionLimit || 20;

            if (currentUsage + needed > globalLimit) {
                const available = Math.max(0, globalLimit - currentUsage);
                toast({
                    variant: 'destructive',
                    title: 'Límite Global Excedido',
                    description: `La organización tiene un límite de ${globalLimit} diarios. Usado: ${currentUsage}. Disponible: ${available}. Ajusta el límite de la misión.`
                });
                return;
            }

            const title = wizardData.missionName || `Buscar ${wizardData.jobTitle} en ${wizardData.location}`;
            const summary = `Buscar ${wizardData.jobTitle}s en ${wizardData.industry} (${wizardData.location}). Enriquecer con nivel ${wizardData.enrichmentLevel}. Campaña: ${wizardData.campaignName || 'Ninguna'}.`;

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
                missionLimit: 20, // Reset default
                missionName: '',
                enrichmentLevel: 'basic',
                campaignName: '',
                campaignContext: '',
                autoGenerateCampaign: false
            });

            toast({ title: 'Misión Iniciada', description: 'ANTONIA está trabajando en tu tarea.' });
        } catch (error: any) {
            console.error('[ANTONIA] Error creating mission:', error);
            toast({
                variant: 'destructive',
                title: 'Error al crear misión',
                description: error.message || 'Ocurrió un error inesperado.'
            });
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

    const handleShowLogs = async (missionId: string) => {
        setLogsOpen(true);
        setLogsLoading(true);
        try {
            if (!orgId) return;
            const logs = await antoniaService.getLogs(orgId, 100, missionId);
            setTaskLogs(logs || []);
        } catch (error) {
            console.error('[ANTONIA] Error loading logs:', error);
            toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los logs.' });
        } finally {
            setLogsLoading(false);
        }
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
    const handleConnectGoogle = async () => {
        setConnectingProvider('google');
        try {
            await googleAuthService.login();
            const session = googleAuthService.getSession();

            if (session?.accessToken && userId) {
                // Store token for server-side use
                const res = await fetch('/api/integrations/store-token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        provider: 'google',
                        userId: userId
                    })
                });

                if (res.ok) {
                    setGoogleConnected(true);
                    toast({
                        title: 'Google Conectado',
                        description: 'Tu cuenta está lista para enviar notificaciones.'
                    });
                } else {
                    throw new Error('Failed to store token');
                }
            }
        } catch (error: any) {
            console.error('[OAuth] Google connection failed:', error);
            toast({
                variant: 'destructive',
                title: 'Error',
                description: error.message || 'No se pudo conectar con Google.'
            });
        } finally {
            setConnectingProvider(null);
        }
    };

    const handleConnectOutlook = async () => {
        setConnectingProvider('outlook');
        try {
            await microsoftAuthService.login();
            const identity = microsoftAuthService.getUserIdentity();

            if (identity?.email && userId) {
                // Store connection for server-side use
                const res = await fetch('/api/integrations/store-token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        provider: 'outlook',
                        userId: userId
                    })
                });

                if (res.ok) {
                    setOutlookConnected(true);
                    toast({
                        title: 'Outlook Conectado',
                        description: 'Tu cuenta está lista para enviar notificaciones.'
                    });
                } else {
                    throw new Error('Failed to store token');
                }
            }
        } catch (error: any) {
            console.error('[OAuth] Outlook connection failed:', error);
            toast({
                variant: 'destructive',
                title: 'Error',
                description: error.message || 'No se pudo conectar con Outlook.'
            });
        } finally {
            setConnectingProvider(null);
        }
    };

    if (loading) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin h-8 w-8 text-primary" /></div>;

    return (
        <div className="container mx-auto space-y-6">
            <PageHeader
                title="Agente ANTONIA"
                description="Tu asistente de prospección automatizada. Define misiones y ANTONIA se encarga del resto."
            />

            <Tabs defaultValue="builder" className="w-full">
                <TabsList className="grid w-full max-w-md grid-cols-3">
                    <TabsTrigger value="builder">Crear Misión</TabsTrigger>
                    <TabsTrigger value="active">Activas ({missions.length})</TabsTrigger>
                    <TabsTrigger value="settings">Configuración</TabsTrigger>
                </TabsList>

                {/* --- MISSION BUILDER WIZARD --- */}
                <TabsContent value="builder" className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Left: Helper */}
                        <div className="lg:col-span-1 space-y-4">
                            <Card className="bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950/20 dark:to-pink-950/20 border-purple-200 dark:border-purple-800">
                                <CardHeader>
                                    <div className="flex items-center gap-2">
                                        <Bot className="w-5 h-5 text-purple-600" />
                                        <CardTitle className="text-lg">¿Cómo funciona?</CardTitle>
                                    </div>
                                </CardHeader>
                                <CardContent className="text-sm space-y-4">
                                    <div className="flex gap-3">
                                        <div className="mt-1 p-2 bg-white dark:bg-gray-900 rounded-lg border shadow-sm">
                                            <Target className="w-4 h-4 text-purple-600" />
                                        </div>
                                        <div>
                                            <p className="font-semibold text-gray-900 dark:text-gray-100">1. Define tu Objetivo</p>
                                            <p className="text-gray-600 dark:text-gray-400 text-xs mt-1">Especifica cargo, ubicación e industria de tus prospectos ideales.</p>
                                        </div>
                                    </div>
                                    <div className="flex gap-3">
                                        <div className="mt-1 p-2 bg-white dark:bg-gray-900 rounded-lg border shadow-sm">
                                            <Globe className="w-4 h-4 text-blue-600" />
                                        </div>
                                        <div>
                                            <p className="font-semibold text-gray-900 dark:text-gray-100">2. Búsqueda Automática</p>
                                            <p className="text-gray-600 dark:text-gray-400 text-xs mt-1">ANTONIA busca en LinkedIn, Apollo y bases de datos públicas 24/7.</p>
                                        </div>
                                    </div>
                                    <div className="flex gap-3">
                                        <div className="mt-1 p-2 bg-white dark:bg-gray-900 rounded-lg border shadow-sm">
                                            <Briefcase className="w-4 h-4 text-orange-600" />
                                        </div>
                                        <div>
                                            <p className="font-semibold text-gray-900 dark:text-gray-100">3. Enriquecimiento y Contacto</p>
                                            <p className="text-gray-600 dark:text-gray-400 text-xs mt-1">Verifica emails, enriquece datos y activa campañas automáticamente.</p>
                                        </div>
                                    </div>
                                    <Separator />
                                    <div className="bg-white/50 dark:bg-gray-900/50 p-3 rounded-lg border">
                                        <div className="flex items-center gap-2 text-xs text-purple-700 dark:text-purple-300">
                                            <Sparkles className="w-3 h-3" />
                                            <span className="font-medium">ANTONIA trabaja incluso cuando estás offline</span>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Right: Wizard Form */}
                        <Card className="lg:col-span-2 border-2 shadow-sm">
                            <CardHeader>
                                <div className="flex justify-between items-center">
                                    <CardTitle>Nueva Misión</CardTitle>
                                    <Badge variant="outline">Paso {step} de 3</Badge>
                                </div>
                                <div className="h-1 w-full bg-secondary mt-4 rounded-full overflow-hidden">
                                    <div className="h-full bg-gradient-to-r from-purple-600 to-pink-600 transition-all duration-500" style={{ width: `${(step / 3) * 100}%` }} />
                                </div>
                            </CardHeader>
                            <CardContent className="py-6 min-h-[320px]">
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
                                    </div>
                                )}

                                {step === 2 && (
                                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                                        <h3 className="text-lg font-medium mb-4">Acciones a Ejecutar</h3>
                                        <div className="space-y-2">
                                            <Label>Nombre de la Misión (Opcional)</Label>
                                            <Input
                                                placeholder="ej. Búsqueda Gerentes Retail Chile"
                                                value={wizardData.missionName || ''}
                                                onChange={(e) => setWizardData({ ...wizardData, missionName: e.target.value })}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Nivel de Enriquecimiento</Label>
                                            <Select
                                                value={wizardData.enrichmentLevel}
                                                onValueChange={(v) => setWizardData({ ...wizardData, enrichmentLevel: v as 'basic' | 'deep' })}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="standard">Estándar (Verificación de Email)</SelectItem>
                                                    <SelectItem value="deep">Profundo (Teléfonos + Redes Sociales)</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <p className="text-xs text-muted-foreground">El nivel profundo consume más créditos pero obtiene datos completos.</p>
                                        </div>

                                        <div className="space-y-2">
                                            <Label>Límite Diario de esta Misión (Smart Distribution)</Label>
                                            <div className="flex items-center gap-4">
                                                <Input
                                                    type="number"
                                                    min="1"
                                                    max={config?.dailyEnrichLimit || 50}
                                                    value={wizardData.missionLimit || 20}
                                                    onChange={(e) => setWizardData({ ...wizardData, missionLimit: parseInt(e.target.value) || 0 })}
                                                />
                                                <span className="text-sm text-muted-foreground whitespace-nowrap">
                                                    Disponible en Org: {Math.max(0, (config?.dailyEnrichLimit || 50) - missions.reduce((acc, m) => acc + (m.params?.missionLimit || 0), 0))}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="space-y-4 border p-4 rounded-lg bg-secondary/10">
                                            <div className="flex items-center justify-between">
                                                <div className="space-y-0.5">
                                                    <Label>Campaña Inteligente</Label>
                                                    <p className="text-xs text-muted-foreground">Deja que ANTONIA redacte y configure la campaña por ti.</p>
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
                                                            placeholder="Buscar campaña..."
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
                                                <span className="text-muted-foreground">Ubicación:</span>
                                                <span className="font-medium">{wizardData.location}</span>
                                            </div>
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
                            <CardFooter className="flex justify-between bg-secondary/10 py-4">
                                <Button
                                    variant="ghost"
                                    onClick={() => setStep(s => Math.max(1, s - 1))}
                                    disabled={step === 1}
                                >
                                    Atrás
                                </Button>
                                {step < 3 ? (
                                    <Button onClick={() => setStep(s => Math.min(3, s + 1))}>
                                        Siguiente <ArrowRight className="w-4 h-4 ml-2" />
                                    </Button>
                                ) : (
                                    <Button onClick={handleCreateMission} className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white shadow-md">
                                        <Play className="w-4 h-4 mr-2" /> Lanzar Misión
                                    </Button>
                                )}
                            </CardFooter>
                        </Card>
                    </div>
                </TabsContent>

                <TabsContent value="active" className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
                                                    {new Date(mission.createdAt).toLocaleDateString('es-AR')}
                                                </span>
                                                {editingMissionId !== mission.id && (
                                                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => startEditingMission(mission)}>
                                                        <Edit2 className="w-3 h-3 text-muted-foreground" />
                                                    </Button>
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
                                        <p className="text-sm text-muted-foreground line-clamp-3">
                                            {mission.goalSummary}
                                        </p>
                                        <div className="mt-4 flex gap-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="w-full"
                                                onClick={() => handleShowLogs(mission.id)}
                                            >
                                                <FileText className="w-3 h-3 mr-2" /> Ver Logs
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="text-muted-foreground hover:text-primary"
                                                onClick={() => handlePauseMission(mission)}
                                            >
                                                {mission.status === 'active' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="text-muted-foreground hover:text-red-500"
                                                onClick={() => setDeletingMissionId(mission.id)}
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="text-muted-foreground hover:text-red-500"
                                                onClick={() => setDeletingMissionId(mission.id)}
                                            >
                                                <Trash2 className="w-4 h-4" />
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

                <TabsContent value="settings" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Configuración de ANTONIA</CardTitle>
                            <CardDescription>Gestiona cómo ANTONIA se comunica contigo y opera</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-4">
                                <h3 className="text-lg font-medium">Notificaciones</h3>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <Label htmlFor="daily-report">Reporte Diario por Email</Label>
                                        <p className="text-sm text-muted-foreground">Recibe un resumen cada 24 horas</p>
                                    </div>
                                    <Switch
                                        id="daily-report"
                                        checked={config?.dailyReportEnabled}
                                        onCheckedChange={(c) => handleUpdateConfig('dailyReportEnabled', c)}
                                    />
                                </div>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <Label htmlFor="instant-alerts">Alertas Instantáneas</Label>
                                        <p className="text-sm text-muted-foreground">Notificaciones inmediatas para leads calientes</p>
                                    </div>
                                    <Switch
                                        id="instant-alerts"
                                        checked={config?.instantAlertsEnabled}
                                        onCheckedChange={(c) => handleUpdateConfig('instantAlertsEnabled', c)}
                                    />
                                </div>
                                <div>
                                    <Label>Emails de Notificación</Label>
                                    <p className="text-sm text-muted-foreground mb-2">Recibe reportes y alertas en estas direcciones.</p>

                                    <div className="space-y-3">
                                        <div className="flex gap-2">
                                            <Input
                                                placeholder="ej. equipo@empresa.com"
                                                value={newEmail}
                                                onChange={(e) => setNewEmail(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && handleAddEmail()}
                                            />
                                            <Button onClick={handleAddEmail} size="icon">
                                                <Plus className="w-4 h-4" />
                                            </Button>
                                        </div>

                                        <div className="border rounded-md overflow-hidden">
                                            <Table>
                                                <TableBody>
                                                    {notificationEmails.map((email) => (
                                                        <TableRow key={email}>
                                                            <TableCell className="py-2">{email}</TableCell>
                                                            <TableCell className="py-2 text-right">
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    onClick={() => handleRemoveEmail(email)}
                                                                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                                                                >
                                                                    <Trash2 className="w-4 h-4" />
                                                                </Button>
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                    {notificationEmails.length === 0 && (
                                                        <TableRow>
                                                            <TableCell colSpan={2} className="text-center text-muted-foreground py-4 text-sm">
                                                                No hay emails configurados.
                                                            </TableCell>
                                                        </TableRow>
                                                    )}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <Separator />

                            <div className="space-y-4">
                                <h3 className="text-lg font-medium">Límites y Cuotas Diarias</h3>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="search-limit">Búsquedas Diarias (Ejecuciones)</Label>
                                        <Input
                                            id="search-limit"
                                            type="number"
                                            min="1"
                                            defaultValue={config?.dailySearchLimit ?? 3}
                                            onBlur={(e) => {
                                                const val = parseInt(e.target.value);
                                                if (!isNaN(val) && val > 0) {
                                                    handleUpdateConfig('dailySearchLimit', val);
                                                }
                                            }}
                                        />
                                        <p className="text-xs text-muted-foreground">Máx. de veces que ANTONIA busca al día</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="enrich-limit">Enriquecimientos Diarios</Label>
                                        <Input
                                            id="enrich-limit"
                                            type="number"
                                            min="1"
                                            defaultValue={config?.dailyEnrichLimit ?? 50}
                                            onBlur={(e) => {
                                                const val = parseInt(e.target.value);
                                                if (!isNaN(val) && val > 0) {
                                                    handleUpdateConfig('dailyEnrichLimit', val);
                                                }
                                            }}
                                        />
                                        <p className="text-xs text-muted-foreground">Máx. leads a verificar email</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="investigate-limit">Investigaciones Diarias (Deep)</Label>
                                        <Input
                                            id="investigate-limit"
                                            type="number"
                                            min="1"
                                            defaultValue={config?.dailyInvestigateLimit ?? 20}
                                            onBlur={(e) => {
                                                const val = parseInt(e.target.value);
                                                if (!isNaN(val) && val > 0) {
                                                    handleUpdateConfig('dailyInvestigateLimit', val);
                                                }
                                            }}
                                        />
                                        <p className="text-xs text-muted-foreground">Máx. leads con datos completos (Tel)</p>
                                    </div>
                                </div>
                            </div>

                            <Separator />

                            <div className="space-y-4">
                                <h3 className="text-lg font-medium">Integraciones (Acceso Offline)</h3>
                                <p className="text-sm text-muted-foreground">Para que ANTONIA pueda enviar emails mientras estás desconectado, necesita acceso a tu cuenta.</p>

                                <div className="space-y-3">
                                    <div className="p-4 border rounded-lg bg-secondary/20 flex flex-col md:flex-row justify-between items-center gap-4">
                                        <div>
                                            <p className="font-medium">Google / Gmail</p>
                                            <p className="text-sm text-muted-foreground">Requerido para envío automático de emails</p>
                                        </div>
                                        <Button
                                            variant="outline"
                                            onClick={handleConnectGoogle}
                                            disabled={connectingProvider !== null}
                                        >
                                            {connectingProvider === 'google' ? (
                                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            ) : (
                                                <Settings className="w-4 h-4 mr-2" />
                                            )}
                                            {googleConnected ? 'Reconectar' : 'Conectar'} Cuenta
                                        </Button>
                                    </div>

                                    <div className="p-4 border rounded-lg bg-secondary/20 flex flex-col md:flex-row justify-between items-center gap-4">
                                        <div>
                                            <p className="font-medium">Microsoft Outlook</p>
                                            <p className="text-sm text-muted-foreground">Alternativa para envío automático de emails</p>
                                        </div>
                                        <Button
                                            variant="outline"
                                            onClick={handleConnectOutlook}
                                            disabled={connectingProvider !== null}
                                        >
                                            {connectingProvider === 'outlook' ? (
                                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            ) : (
                                                <Settings className="w-4 h-4 mr-2" />
                                            )}
                                            {outlookConnected ? 'Reconectar' : 'Conectar'} Cuenta
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
                <DialogContent className="max-w-3xl h-[80vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>Logs de la Misión</DialogTitle>
                        <DialogDescription>Registro detallado de actividades</DialogDescription>
                    </DialogHeader>

                    <ScrollArea className="flex-1 p-4 border rounded-md bg-slate-950 text-slate-50 font-mono text-sm">
                        {logsLoading ? (
                            <div className="flex items-center justify-center h-full">
                                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                            </div>
                        ) : taskLogs.length === 0 ? (
                            <div className="text-center text-muted-foreground py-8">
                                No hay logs registrados para esta misión.
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {taskLogs.map((log) => (
                                    <div key={log.id} className="border-b border-slate-800 pb-2 last:border-0">
                                        <div className="flex justify-between text-xs text-slate-400 mb-1">
                                            <span>{new Date(log.created_at).toLocaleString()}</span>
                                            <span className={`uppercase font-bold ${log.level === 'error' ? 'text-red-400' :
                                                log.level === 'warn' ? 'text-yellow-400' :
                                                    'text-blue-400'
                                                }`}>
                                                {log.level}
                                            </span>
                                        </div>
                                        <p className="whitespace-pre-wrap">{log.message}</p>
                                        {log.details && (
                                            <pre className="mt-1 text-xs text-slate-500 overflow-x-auto">
                                                {JSON.stringify(log.details, null, 2)}
                                            </pre>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </ScrollArea>
                </DialogContent>
            </Dialog>

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
        </div>
    );
}
