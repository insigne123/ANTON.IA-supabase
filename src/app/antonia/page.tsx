'use client';

import React, { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { antoniaService } from '@/lib/services/antonia-service';
import { AntoniaMission, AntoniaConfig } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Plus, Settings, Play, Pause, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function AntoniaPage() {
    const [missions, setMissions] = useState<AntoniaMission[]>([]);
    const [loading, setLoading] = useState(true);
    const [config, setConfig] = useState<AntoniaConfig | null>(null);
    const [newMissionInput, setNewMissionInput] = useState('');
    const [orgId, setOrgId] = useState<string | null>(null);
    const [userId, setUserId] = useState<string | null>(null);

    const supabase = createClientComponentClient();
    const { toast } = useToast();

    useEffect(() => {
        async function loadData() {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            setUserId(user.id);

            // Fetch user's organization (assuming single org for simplicity, should fetch from context/store)
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
        if (!newMissionInput.trim() || !orgId || !userId) return;
        try {
            // Simple parser for prototype: "Do X"
            const mission = await antoniaService.createMission(
                orgId,
                userId,
                newMissionInput.slice(0, 50) + (newMissionInput.length > 50 ? '...' : ''),
                newMissionInput,
                {}
            );
            setMissions([mission, ...missions]);
            setNewMissionInput('');
            toast({ title: 'Mission Started', description: 'ANTONIA is on it.' });
        } catch (e) {
            console.error(e);
            toast({ title: 'Error', description: 'Failed to start mission', variant: 'destructive' });
        }
    };

    const handleUpdateConfig = async (key: keyof AntoniaConfig, value: any) => {
        if (!orgId || !config) return;
        try {
            const newConfig = { ...config, [key]: value, organizationId: orgId };
            setConfig(newConfig); // Optimistic
            await antoniaService.upsertConfig(newConfig);
            toast({ title: 'Settings Saved' });
        } catch (e) {
            toast({ title: 'Error Saving Settings', variant: 'destructive' });
        }
    };

    if (loading) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin h-8 w-8 text-primary" /></div>;

    return (
        <div className="container mx-auto p-6 max-w-6xl space-y-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-500 to-pink-600">
                        ANTONIA
                    </h1>
                    <p className="text-muted-foreground mt-1">Your Autonomous AI Agent</p>
                </div>
                <div className="flex gap-2">
                    {/* Connection Status Indicator */}
                    <Badge variant={config?.dailyReportEnabled ? 'default' : 'secondary'} className="h-8 px-4 text-sm">
                        {config?.dailyReportEnabled ? 'Online' : 'Resting'}
                    </Badge>
                </div>
            </div>

            <Tabs defaultValue="missions" className="w-full">
                <TabsList className="grid w-full max-w-md grid-cols-2 mb-8">
                    <TabsTrigger value="missions">Missions</TabsTrigger>
                    <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>

                <TabsContent value="missions" className="space-y-6">
                    {/* New Mission Input */}
                    <Card className="border-2 border-primary/20 bg-card/50 backdrop-blur-sm">
                        <CardHeader>
                            <CardTitle>Assign a new Task</CardTitle>
                            <CardDescription>Tell ANTONIA what to do (e.g., "Search for Marketing Directors in New York and email them")</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="flex gap-3">
                                <Input
                                    placeholder="Describe your mission..."
                                    className="bg-background/80"
                                    value={newMissionInput}
                                    onChange={(e) => setNewMissionInput(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleCreateMission()}
                                />
                                <Button onClick={handleCreateMission} disabled={!newMissionInput.trim()}>
                                    <Play className="w-4 h-4 mr-2" /> Start
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Active Missions Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {missions.length === 0 ? (
                            <div className="col-span-full text-center py-10 text-muted-foreground">
                                <p>No active missions. ANTONIA is waiting for instructions.</p>
                            </div>
                        ) : (
                            missions.map((mission) => (
                                <Card key={mission.id} className="relative overflow-hidden group hover:border-primary/50 transition-colors">
                                    <CardHeader>
                                        <div className="flex justify-between items-start">
                                            <Badge variant={mission.status === 'active' ? 'default' : 'secondary'}>
                                                {mission.status.toUpperCase()}
                                            </Badge>
                                            <span className="text-xs text-muted-foreground">
                                                {new Date(mission.createdAt).toLocaleDateString()}
                                            </span>
                                        </div>
                                        <CardTitle className="mt-2 line-clamp-1">{mission.title}</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <p className="text-sm text-muted-foreground line-clamp-3">
                                            {mission.goalSummary}
                                        </p>
                                        <div className="mt-4 flex gap-2">
                                            <Button variant="outline" size="sm" className="w-full">View Logs</Button>
                                            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive">
                                                <Pause className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </CardContent>
                                    {/* Progress bar simulation */}
                                    <div className="absolute bottom-0 left-0 h-1 bg-primary/20 w-full">
                                        <div className="h-full bg-primary w-1/3 animate-pulse"></div>
                                    </div>
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
