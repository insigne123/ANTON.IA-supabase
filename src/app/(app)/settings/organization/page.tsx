'use client';

import { useEffect, useState, useCallback } from 'react';
import { organizationService } from '@/lib/services/organization-service';
import { useRealtime } from '@/hooks/use-realtime';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Copy, Mail, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';

export default function OrganizationSettingsPage() {
    const [loading, setLoading] = useState(true);
    const [orgData, setOrgData] = useState<{ organization: any; members: any[] } | null>(null);
    const [invites, setInvites] = useState<any[]>([]);
    const [inviteEmail, setInviteEmail] = useState('');
    const [isInviteOpen, setIsInviteOpen] = useState(false);
    const { toast } = useToast();

    const loadData = useCallback(async () => {
        try {
            const [details, invitesData] = await Promise.all([
                organizationService.getOrganizationDetails(),
                organizationService.getInvites()
            ]);
            setOrgData(details);
            setInvites(invitesData);
        } catch (error) {
            console.error('Failed to load organization data', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    useRealtime('organization_members', '*', loadData);
    useRealtime('organization_invites', '*', loadData);

    const handleInvite = async () => {
        if (!inviteEmail) return;

        const result = await organizationService.createInvite(inviteEmail);
        if (result) {
            toast({
                title: "Invite Created",
                description: "The invite link has been generated.",
            });
            setInviteEmail('');
            setIsInviteOpen(false);
            loadData();
        } else {
            toast({
                title: "Error",
                description: "Failed to create invite.",
                variant: "destructive"
            });
        }
    };

    const handleRevokeInvite = async (id: string) => {
        const success = await organizationService.revokeInvite(id);
        if (success) {
            toast({
                title: "Invite Revoked",
                description: "The invite has been cancelled.",
            });
            loadData();
        }
    };

    const copyInviteLink = (token: string) => {
        const link = `${window.location.origin}/invite/${token}`;
        navigator.clipboard.writeText(link);
        toast({
            title: "Copied!",
            description: "Invite link copied to clipboard.",
        });
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!orgData) {
        return (
            <div className="p-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Organization Not Found</CardTitle>
                        <CardDescription>
                            You are not currently a member of any organization.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Button onClick={() => organizationService.createOrganization('My Organization').then(loadData)}>
                            Create Organization
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    const { organization, members } = orgData;

    return (
        <div className="space-y-6 p-6">
            <div>
                <h3 className="text-lg font-medium">Organization Settings</h3>
                <p className="text-sm text-muted-foreground">
                    Manage your organization profile and team members.
                </p>
            </div>
            <Separator />

            <Card>
                <CardHeader>
                    <CardTitle>General Information</CardTitle>
                    <CardDescription>
                        Basic details about your organization.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid w-full max-w-sm items-center gap-1.5">
                        <Label htmlFor="orgName">Organization Name</Label>
                        <Input type="text" id="orgName" value={organization.name} readOnly />
                    </div>
                    <div className="text-sm text-muted-foreground">
                        Created on {new Date(organization.created_at).toLocaleDateString()}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <div className="space-y-1">
                        <CardTitle>Team Members</CardTitle>
                        <CardDescription>
                            People with access to this organization.
                        </CardDescription>
                    </div>
                    <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
                        <DialogTrigger asChild>
                            <Button size="sm" variant="outline">
                                <Plus className="mr-2 h-4 w-4" />
                                Invite Member
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Invite Team Member</DialogTitle>
                                <DialogDescription>
                                    Generate an invite link for a new member.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid gap-2">
                                    <Label htmlFor="email">Email address</Label>
                                    <Input
                                        id="email"
                                        placeholder="colleague@company.com"
                                        value={inviteEmail}
                                        onChange={(e) => setInviteEmail(e.target.value)}
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button onClick={handleInvite}>Generate Invite</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>User</TableHead>
                                <TableHead>Role</TableHead>
                                <TableHead>Joined</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {members.map((member) => (
                                <TableRow key={member.id}>
                                    <TableCell>
                                        <div className="flex items-center gap-3">
                                            {member.profiles?.avatar_url ? (
                                                <img
                                                    src={member.profiles.avatar_url}
                                                    alt={member.profiles.full_name || 'User'}
                                                    className="w-8 h-8 rounded-full"
                                                />
                                            ) : (
                                                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium">
                                                    {(member.profiles?.full_name?.[0] || member.profiles?.email?.[0] || '?').toUpperCase()}
                                                </div>
                                            )}
                                            <div className="flex flex-col">
                                                <span className="font-medium text-sm">
                                                    {member.profiles?.full_name || 'Unknown User'}
                                                </span>
                                                <span className="text-xs text-muted-foreground">
                                                    {member.profiles?.email}
                                                </span>
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant={member.role === 'owner' ? 'default' : 'secondary'}>
                                            {member.role}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground text-sm">
                                        {new Date(member.created_at).toLocaleDateString()}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {/* Actions placeholder */}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {invites.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle>Pending Invites</CardTitle>
                        <CardDescription>
                            Invites that haven't been accepted yet.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Email</TableHead>
                                    <TableHead>Role</TableHead>
                                    <TableHead>Sent</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {invites.map((invite) => (
                                    <TableRow key={invite.id}>
                                        <TableCell>{invite.email}</TableCell>
                                        <TableCell>
                                            <Badge variant="outline">{invite.role}</Badge>
                                        </TableCell>
                                        <TableCell className="text-muted-foreground text-sm">
                                            {new Date(invite.created_at).toLocaleDateString()}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-2">
                                                <Button size="icon" variant="ghost" onClick={() => copyInviteLink(invite.token)} title="Copy Link">
                                                    <Copy className="h-4 w-4" />
                                                </Button>
                                                <Button size="icon" variant="ghost" asChild title="Send via Email">
                                                    <a href={`mailto:${invite.email}?subject=Invitation to join ${organization.name}&body=You have been invited to join ${organization.name} on ANTON.IA. Click here to accept: ${typeof window !== 'undefined' ? window.location.origin : ''}/invite/${invite.token}`}>
                                                        <Mail className="h-4 w-4" />
                                                    </a>
                                                </Button>
                                                <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => handleRevokeInvite(invite.id)} title="Revoke">
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
