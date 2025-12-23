'use client';

import React, { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { antoniaService } from '@/lib/services/antonia-service';
import { AntoniaMission, AntoniaConfig } from '@/lib/types';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Settings, Play, Pause, Bot, ArrowRight, CheckCircle2, Target, Briefcase, Globe, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';

export default function AntoniaPage() {
    const [missions, setMissions] = useState<AntoniaMission[]>([]);
    const [loading, setLoading] = useState(true);
    const [config, setConfig] = useState<AntoniaConfig | null>(null);
    const [orgId, setOrgId] = useState<string | null>(null);
    const [userId, setUserId] = useState<string | null>(null);

    // Wizard State
    const [step, setStep] = useState(1);
    const [wizardData, setWizardData] = useState({
        industry: '',
        location: '',
        jobTitle: '',
        keywords: '',
        campaignName: '',
        enrichmentLevel: 'standard'
    });

    const supabase = createClientComponentClient();
    const { toast } = useToast();

    useEffect(() => {
        async function loadData() {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            setUserId(user.id);

            const { data: member } = await supabase
                .from('organization_members')
                .select('organization_id')
                .eq('user_id', user.id)
                .single();

            if (member) {
                setOrgId(member.organization_id);
                const [missionsData, configData] = await Promise.all([
                    antoniaService.getActiveMissions(member.organization_id),
                    antoniaService.getConfig(member.organization_id)
                ]);
                setMissions(missionsData);
                setConfig(configData);
            }
            setLoading(false);
        }
        loadData();
    }, [supabase]);

    const handleCreateMission = async () => {
        if (!orgId || !userId) return;
        try {
            const title = `Buscar ${wizardData.jobTitle} en ${wizardData.location}`;
            const summary = `Buscar ${wizardData.jobTitle}s en ${wizardData.industry} (${wizardData.location}). Enriquecer con nivel ${wizardData.enrichmentLevel}. Campaña: ${wizardData.campaignName || 'Ninguna'}.`;

            const mission = await antoniaService.createMission(
                orgId,
                userId,
                title,
                summary,
                wizardData
            );
            setMissions([mission, ...missions]);

            // Trigger the worker to start processing
            try {
                const triggerRes = await fetch('/api/antonia/trigger', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ missionId: mission.id })
                });

                if (!triggerRes.ok) {
                    console.error('Failed to trigger mission:', await triggerRes.text());
                }
            } catch (triggerError) {
                console.error('Error triggering mission:', triggerError);
                // Don't fail the whole operation if trigger fails
            }

            setStep(1);
            setWizardData({ industry: '', location: '', jobTitle: '', keywords: '', campaignName: '', enrichmentLevel: 'standard' });

            toast({ title: 'Misión Iniciada', description: 'ANTONIA está trabajando en tu tarea.' });
        } catch (e) {
            console.error(e);
            toast({ title: 'Error', description: 'No se pudo iniciar la misión', variant: 'destructive' });
        }
    };

    const handleUpdateConfig = async (key: keyof AntoniaConfig, value: any) => {
        if (!orgId || !config) return;
        try {
            const newConfig = { ...config, [key]: value, organizationId: orgId };
            setConfig(newConfig);
            await antoniaService.upsertConfig(newConfig);
            toast({ title: 'Configuración Guardada' });
        } catch (e) {
            toast({ title: 'Error al Guardar', variant: 'destructive' });
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
                                        <div className="space-y-2">
                                            <Label>Industria</Label>
                                            <Input
                                                placeholder="ej. SaaS, Fintech, Salud"
                                                value={wizardData.industry}
                                                onChange={(e) => setWizardData({ ...wizardData, industry: e.target.value })}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Palabras Clave (Opcional)</Label>
                                            <Input
                                                placeholder="ej. 'Serie A', 'Contratando'"
                                                value={wizardData.keywords}
                                                onChange={(e) => setWizardData({ ...wizardData, keywords: e.target.value })}
                                            />
                                            <p className="text-xs text-muted-foreground">Filtra por señales de compra o eventos recientes.</p>
                                        </div>
                                    </div>
                                )}

                                {step === 2 && (
                                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                                        <h3 className="text-lg font-medium mb-4">Acciones a Ejecutar</h3>
                                        <div className="space-y-2">
                                            <Label>Nivel de Enriquecimiento</Label>
                                            <Select
                                                value={wizardData.enrichmentLevel}
                                                onValueChange={(v) => setWizardData({ ...wizardData, enrichmentLevel: v })}
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
                                            <Label>Campaña a Activar</Label>
                                            <Input
                                                placeholder="Escribe el nombre de una campaña (ej. 'Outreach V1')"
                                                value={wizardData.campaignName}
                                                onChange={(e) => setWizardData({ ...wizardData, campaignName: e.target.value })}
                                            />
                                            <p className="text-xs text-muted-foreground">Deja vacío para solo guardar los leads sin enviar emails.</p>
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
                                                <span className="font-medium">{wizardData.campaignName ? `Agregar a '${wizardData.campaignName}'` : 'Solo Guardar'}</span>
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
                                                {mission.status === 'active' ? 'ACTIVA' : mission.status.toUpperCase()}
                                            </Badge>
                                            <span className="text-xs text-muted-foreground">
                                                {new Date(mission.createdAt).toLocaleDateString('es-AR')}
                                            </span>
                                        </div>
                                        <CardTitle className="mt-2 line-clamp-1 relative z-10">{mission.title}</CardTitle>
                                    </CardHeader>
                                    <CardContent className="relative z-10">
                                        <p className="text-sm text-muted-foreground line-clamp-3">
                                            {mission.goalSummary}
                                        </p>
                                        <div className="mt-4 flex gap-2">
                                            <Button variant="outline" size="sm" className="w-full">Ver Logs</Button>
                                            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive">
                                                <Pause className="w-4 h-4" />
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
                                <div className="grid gap-2">
                                    <Label htmlFor="notification-email">Email de Notificaciones</Label>
                                    <Input
                                        id="notification-email"
                                        value={config?.notificationEmail || ''}
                                        onChange={(e) => handleUpdateConfig('notificationEmail', e.target.value)}
                                        placeholder="¿Dónde enviamos los reportes?"
                                    />
                                </div>
                            </div>

                            <Separator />

                            <div className="space-y-4">
                                <h3 className="text-lg font-medium">Integraciones (Acceso Offline)</h3>
                                <p className="text-sm text-muted-foreground">Para que ANTONIA pueda enviar emails mientras estás desconectado, necesita acceso a tu cuenta.</p>
                                <div className="p-4 border rounded-lg bg-secondary/20 flex flex-col md:flex-row justify-between items-center gap-4">
                                    <div>
                                        <p className="font-medium">Google / Gmail</p>
                                        <p className="text-sm text-muted-foreground">Requerido para envío automático de emails</p>
                                    </div>
                                    <Button variant="outline">
                                        <Settings className="w-4 h-4 mr-2" /> Conectar Cuenta
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
