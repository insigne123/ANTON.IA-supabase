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
import { Loader2, Plus } from 'lucide-react';

export default function OrganizationSettingsPage() {
    const [loading, setLoading] = useState(true);
    const [orgData, setOrgData] = useState<{ organization: any; members: any[] } | null>(null);

    const loadData = useCallback(async () => {
        // Don't set loading to true here to avoid flickering on realtime updates
        try {
            const data = await organizationService.getOrganizationDetails();
            setOrgData(data);
        } catch (error) {
            console.error('Failed to load organization data', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // Subscribe to changes in organization_members
    useRealtime('organization_members', '*', () => {
        console.log('Organization members changed, reloading...');
        loadData();
    });

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
                    <Button size="sm" variant="outline">
                        <Plus className="mr-2 h-4 w-4" />
                        Invite Member
                    </Button>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>User ID</TableHead>
                                <TableHead>Role</TableHead>
                                <TableHead>Joined</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {members.map((member) => (
                                <TableRow key={member.id}>
                                    <TableCell className="font-mono text-xs">{member.user_id}</TableCell>
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
        </div>
    );
}
