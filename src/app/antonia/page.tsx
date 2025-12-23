'use client';

import React, { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { antoniaService } from '@/lib/services/antonia-service';
import { AntoniaMission, AntoniaConfig } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Settings, Play, Pause, Bot, ArrowRight, CheckCircle2, Target, Briefcase, Globe } from 'lucide-react';
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
            // Construct meaningful title and summary
            const title = `Find ${wizardData.jobTitle} in ${wizardData.location}`;
            const summary = `Search for ${wizardData.jobTitle}s in ${wizardData.industry} (${wizardData.location}). Enrich with ${wizardData.enrichmentLevel} depth. Trigger campaign: ${wizardData.campaignName || 'None'}.`;

            const mission = await antoniaService.createMission(
                orgId,
                userId,
                title,
                summary,
                wizardData // Store structured params
            );
            setMissions([mission, ...missions]);

            // Reset Wizard
            setStep(1);
            setWizardData({ industry: '', location: '', jobTitle: '', keywords: '', campaignName: '', enrichmentLevel: 'standard' });

            toast({ title: 'Mission Launched', description: 'ANTONIA is now working on your task.' });
        } catch (e) {
            console.error(e);
            toast({ title: 'Error', description: 'Failed to start mission', variant: 'destructive' });
        }
    };

    const handleUpdateConfig = async (key: keyof AntoniaConfig, value: any) => {
        if (!orgId || !config) return;
        try {
            const newConfig = { ...config, [key]: value, organizationId: orgId };
            setConfig(newConfig);
            await antoniaService.upsertConfig(newConfig);
            toast({ title: 'Settings Saved' });
        } catch (e) {
            toast({ title: 'Error Saving Settings', variant: 'destructive' });
        }
    };

    if (loading) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin h-8 w-8 text-primary" /></div>;

    return (
        <div className="container mx-auto p-6 max-w-6xl space-y-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl text-white shadow-lg">
                        <Bot className="w-8 h-8" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">ANTONIA Mission Control</h1>
                        <p className="text-muted-foreground">Automated Prospecting Agent</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 px-3 py-1 bg-secondary/50 rounded-full border text-sm">
                        <div className={`w-2 h-2 rounded-full ${config?.dailyReportEnabled ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                        {config?.dailyReportEnabled ? 'Online & Listening' : 'Offline'}
                    </div>
                </div>
            </div>

            <Tabs defaultValue="builder" className="w-full">
                <TabsList className="w-full max-w-md grid grid-cols-2 mb-8">
                    <TabsTrigger value="builder">Mission Builder</TabsTrigger>
                    <TabsTrigger value="active">Active Missions ({missions.length})</TabsTrigger>
                    <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>

                {/* --- MISSION BUILDER WIZARD --- */}
                <TabsContent value="builder">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {/* Left: Helper / Context */}
                        <div className="lg:col-span-1 space-y-4">
                            <Card className="bg-primary/5 border-primary/10">
                                <CardHeader>
                                    <CardTitle className="text-lg">How it works</CardTitle>
                                </CardHeader>
                                <CardContent className="text-sm space-y-3">
                                    <div className="flex gap-2">
                                        <div className="mt-1 bg-background p-1 rounded border"><Target className="w-4 h-4 text-purple-500" /></div>
                                        <p><span className="font-semibold">Define Target:</span> Tell me who you are looking for.</p>
                                    </div>
                                    <div className="flex gap-2">
                                        <div className="mt-1 bg-background p-1 rounded border"><Globe className="w-4 h-4 text-blue-500" /></div>
                                        <p><span className="font-semibold">Search:</span> I will scan LinkedIn, Apollo, and the web.</p>
                                    </div>
                                    <div className="flex gap-2">
                                        <div className="mt-1 bg-background p-1 rounded border"><Briefcase className="w-4 h-4 text-orange-500" /></div>
                                        <p><span className="font-semibold">Engage:</span> I can verify emails and start a campaign for you.</p>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Right: Wizard Form */}
                        <Card className="lg:col-span-2 border-2 shadow-sm">
                            <CardHeader>
                                <div className="flex justify-between items-center">
                                    <CardTitle>New Mission</CardTitle>
                                    <Badge variant="outline">Step {step} of 3</Badge>
                                </div>
                                <div className="h-1 w-full bg-secondary mt-4 rounded-full overflow-hidden">
                                    <div className="h-full bg-primary transition-all duration-500" style={{ width: `${(step / 3) * 100}%` }} />
                                </div>
                            </CardHeader>
                            <CardContent className="py-6 min-h-[300px]">
                                {step === 1 && (
                                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                                        <h3 className="text-lg font-medium mb-4">Target Audience</h3>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Label>Job Title</Label>
                                                <Input
                                                    placeholder="e.g. Marketing Director"
                                                    value={wizardData.jobTitle}
                                                    onChange={(e) => setWizardData({ ...wizardData, jobTitle: e.target.value })}
                                                    autoFocus
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label>Location</Label>
                                                <Input
                                                    placeholder="e.g. New York, USA"
                                                    value={wizardData.location}
                                                    onChange={(e) => setWizardData({ ...wizardData, location: e.target.value })}
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Industry</Label>
                                            <Input
                                                placeholder="e.g. SaaS, Fintech, Healthcare"
                                                value={wizardData.industry}
                                                onChange={(e) => setWizardData({ ...wizardData, industry: e.target.value })}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Keywords (Optional)</Label>
                                            <Input
                                                placeholder="e.g. 'Series A', 'Hiring'"
                                                value={wizardData.keywords}
                                                onChange={(e) => setWizardData({ ...wizardData, keywords: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                )}

                                {step === 2 && (
                                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                                        <h3 className="text-lg font-medium mb-4">Actions</h3>
                                        <div className="space-y-2">
                                            <Label>Enrichment Depth</Label>
                                            <Select
                                                value={wizardData.enrichmentLevel}
                                                onValueChange={(v) => setWizardData({ ...wizardData, enrichmentLevel: v })}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="standard">Standard (Email Verification)</SelectItem>
                                                    <SelectItem value="deep">Deep (Mobile Phones + Socials)</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Campaign to Trigger</Label>
                                            <Input
                                                placeholder="Type campaign name (e.g. 'Cold Outreach V1')"
                                                value={wizardData.campaignName}
                                                onChange={(e) => setWizardData({ ...wizardData, campaignName: e.target.value })}
                                            />
                                            <p className="text-xs text-muted-foreground">Leave empty to just save leads without emailing.</p>
                                        </div>
                                    </div>
                                )}

                                {step === 3 && (
                                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                                        <div className="bg-secondary/30 p-4 rounded-lg border space-y-3">
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">Target:</span>
                                                <span className="font-medium">{wizardData.jobTitle} in {wizardData.industry}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">Location:</span>
                                                <span className="font-medium">{wizardData.location}</span>
                                            </div>
                                            <Separator />
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">Action:</span>
                                                <span className="font-medium">{wizardData.campaignName ? `Add to '${wizardData.campaignName}'` : 'Save Only'}</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                                            Ready to launch. I will start searching immediately.
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
                                    Back
                                </Button>
                                {step < 3 ? (
                                    <Button onClick={() => setStep(s => Math.min(3, s + 1))}>
                                        Next <ArrowRight className="w-4 h-4 ml-2" />
                                    </Button>
                                ) : (
                                    <Button onClick={handleCreateMission} className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white shadow-md">
                                        <Play className="w-4 h-4 mr-2" /> Launch Mission
                                    </Button>
                                )}
                            </CardFooter>
                        </Card>
                    </div>
                </TabsContent>

                <TabsContent value="active">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {missions.length === 0 ? (
                            <div className="col-span-full flex flex-col items-center justify-center py-16 text-muted-foreground border-2 border-dashed rounded-xl">
                                <Bot className="w-12 h-12 mb-4 opacity-50" />
                                <p className="text-lg font-medium">No active missions</p>
                                <p className="text-sm">Use the Mission Builder to start one.</p>
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
                                                {mission.status.toUpperCase()}
                                            </Badge>
                                            <span className="text-xs text-muted-foreground">
                                                {new Date(mission.createdAt).toLocaleDateString()}
                                            </span>
                                        </div>
                                        <CardTitle className="mt-2 line-clamp-1 relative z-10">{mission.title}</CardTitle>
                                    </CardHeader>
                                    <CardContent className="relative z-10">
                                        <p className="text-sm text-muted-foreground line-clamp-3">
                                            {mission.goalSummary}
                                        </p>
                                        <div className="mt-4 flex gap-2">
                                            <Button variant="outline" size="sm" className="w-full">Logs</Button>
                                            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive">
                                                <Pause className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </CardContent>
                                    {mission.status === 'active' && (
                                        <div className="absolute bottom-0 left-0 h-1 bg-primary/20 w-full">
                                            <div className="h-full bg-primary w-1/3 animate-pulse"></div>
                                        </div>
                                    )}
                                </Card>
                            ))
                        )}
                    </div>
                </TabsContent>

                <TabsContent value="settings">
                    <Card>
                        <CardHeader>
                            <CardTitle>Configuration</CardTitle>
                            <CardDescription>Manage how ANTONIA interacts with you</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-4">
                                <h3 className="text-lg font-medium">Notifications</h3>
                                <div className="flex items-center justify-between">
                                    <Label htmlFor="daily-report">Daily Email Report</Label>
                                    <Switch
                                        id="daily-report"
                                        checked={config?.dailyReportEnabled}
                                        onCheckedChange={(c) => handleUpdateConfig('dailyReportEnabled', c)}
                                    />
                                </div>
                                <div className="flex items-center justify-between">
                                    <Label htmlFor="instant-alerts">Instant Alerts (Hot Leads)</Label>
                                    <Switch
                                        id="instant-alerts"
                                        checked={config?.instantAlertsEnabled}
                                        onCheckedChange={(c) => handleUpdateConfig('instantAlertsEnabled', c)}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="notification-email">Notification Email</Label>
                                    <Input
                                        id="notification-email"
                                        value={config?.notificationEmail || ''}
                                        onChange={(e) => handleUpdateConfig('notificationEmail', e.target.value)}
                                        placeholder="Where should we send reports?"
                                    />
                                </div>
                            </div>

                            <div className="space-y-4 pt-4 border-t">
                                <h3 className="text-lg font-medium">Integrations (Offline Access)</h3>
                                <div className="p-4 border rounded-lg bg-secondary/20 flex flex-col md:flex-row justify-between items-center gap-4">
                                    <div>
                                        <p className="font-medium">Google / Gmail</p>
                                        <p className="text-sm text-muted-foreground">Required for sending emails while you are offline.</p>
                                    </div>
                                    <Button variant="outline">
                                        <Settings className="w-4 h-4 mr-2" /> Connect Account
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
