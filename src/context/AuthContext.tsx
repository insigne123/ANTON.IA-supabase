'use client';

import { Fragment, createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { setLeadResearchStorageScope } from '@/lib/lead-research-storage';
import { setEmailDraftStorageScope } from '@/lib/email-drafts-storage';
import { setResearchedLeadsStorageScope } from '@/lib/researched-leads-storage';
import { setQuotaStorageScope } from '@/lib/quota-client';
import { organizationService, type OrganizationRole } from '@/lib/services/organization-service';
import { safeNextPath } from '@/lib/safe-next-path';
import { authScopeKey, readCachedAuthScope, writeCachedAuthScope } from '@/lib/auth-scope-cache';

interface AuthContextType {
    user: User | null;
    session: Session | null;
    organizationId: string | null;
    organizationRole: OrganizationRole | null;
    loading: boolean;
    error: string | null;
    signInWithGoogle: (nextPath?: string) => Promise<void>;
    signInWithPassword: (email: string, password: string) => Promise<void>;
    /** Sends the reset link; Supabase answers the same whether or not the account exists. */
    requestPasswordReset: (email: string) => Promise<void>;
    updatePassword: (password: string) => Promise<void>;
    signOut: () => Promise<void>;
    refreshOrganization: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Points the per-person and per-organization browser stores (research, drafts, researched leads, quota) at one scope. */
function primeStorageScopes(userId: string, organizationId: string | null) {
    setLeadResearchStorageScope(userId, organizationId);
    setEmailDraftStorageScope(userId);
    setResearchedLeadsStorageScope(userId);
    setQuotaStorageScope(userId, organizationId);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [organizationId, setOrganizationId] = useState<string | null>(null);
    const [organizationRole, setOrganizationRole] = useState<OrganizationRole | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const sessionRef = useRef<Session | null>(null);
    const scopeRequestRef = useRef(0);
    const recoveryRequestRef = useRef<Promise<string> | null>(null);
    // The last session's scope, read on the first client render. The stores point at it before any screen reads them, and
    // when the session resolves to the same person and organization the key below does not change: the app mounts once.
    // Before, every load mounted the whole app twice (anonymous, then the person), so each screen asked for its data twice.
    const [initialScope] = useState(() => {
        const cached = readCachedAuthScope();
        if (cached) primeStorageScopes(cached.userId, cached.organizationId);
        return cached;
    });
    const primedUserIdRef = useRef(initialScope?.userId || null);
    const [scopeResolved, setScopeResolved] = useState(false);

    const applySessionScope = useCallback(async (nextSession: Session | null, forceScopeRefresh = false) => {
        const requestId = ++scopeRequestRef.current;
        // On the first resolution the primed scope counts as the previous one, so the same person's stores are not emptied
        // while the organization loads.
        const previousUserId = sessionRef.current?.user?.id || primedUserIdRef.current || null;
        primedUserIdRef.current = null;
        sessionRef.current = nextSession;
        const userId = nextSession?.user?.id || null;

        if (forceScopeRefresh || previousUserId !== userId) {
            setLeadResearchStorageScope(null, null);
        }
        setEmailDraftStorageScope(userId);
        setResearchedLeadsStorageScope(userId);
        setLoading(true);

        let nextOrganizationId: string | null = null;
        let nextOrganizationRole: OrganizationRole | null = null;
        if (userId) {
            try {
                const organizationResult = await organizationService.listOrganizations();
                nextOrganizationId = organizationResult.activeOrganizationId;
                nextOrganizationRole = organizationResult.organizations.find(
                    (organization) => organization.id === nextOrganizationId,
                )?.role || null;
            } catch (organizationError) {
                console.error('Error fetching organization context:', organizationError);
            }
        }
        if (requestId !== scopeRequestRef.current) return;

        setLeadResearchStorageScope(userId, nextOrganizationId);
        setQuotaStorageScope(userId, nextOrganizationId);
        setSession(nextSession);
        setUser(nextSession?.user ?? null);
        setOrganizationId(nextOrganizationId);
        setOrganizationRole(nextOrganizationRole);
        setLoading(false);
        setScopeResolved(true);
        writeCachedAuthScope(userId ? { userId, organizationId: nextOrganizationId } : null);
    }, []);

    const refreshOrganization = useCallback(async () => {
        await applySessionScope(sessionRef.current, true);
    }, [applySessionScope]);

    useEffect(() => {
        // Legacy recovery emails carry tokens in a fragment. PKCE helpers cannot
        // consume that flow automatically, and the callback server never sees it.
        const fragment = new URLSearchParams(window.location.hash.slice(1));
        if (recoveryRequestRef.current || fragment.get('type') === 'recovery' || fragment.has('error')) {
            const access_token = fragment.get('access_token');
            const refresh_token = fragment.get('refresh_token');
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
            let active = true;
            if (!recoveryRequestRef.current) {
                // setSession validates the link's user with Auth and persists the
                // shared cookies before requesting the password form.
                const expired = '/login?recuperar=1&enlace=vencido';
                recoveryRequestRef.current = !access_token || !refresh_token || fragment.has('error')
                    ? Promise.resolve(expired)
                    : supabase.auth.setSession({ access_token, refresh_token })
                        .then(({ error }) => error ? expired : '/restablecer-clave')
                        .catch(() => expired);
            }
            // StrictMode can restart the effect after removing the fragment.
            // Retain one in-flight validation, with navigation owned by the active effect.
            void recoveryRequestRef.current.then(target => { if (active) window.location.replace(target); });
            return () => { active = false; };
        }
        // Check active session
        supabase.auth.getSession().then(({ data: { session } }) => {
            void applySessionScope(session);
        });

        // Listen for changes
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((event, session) => {
            // Older emails return tokens in the URL fragment instead of a PKCE
            // code. The server cannot see that fragment: route the recovery
            // event after the SDK has saved its session cookies.
            if (event === 'PASSWORD_RECOVERY' && window.location.pathname !== '/restablecer-clave') {
                window.location.replace('/restablecer-clave');
                return;
            }
            window.setTimeout(() => void applySessionScope(session), 0);
        });
        const unsubscribeOrganization = organizationService.subscribeToCurrentOrganizationChanges(() => {
            window.setTimeout(() => void applySessionScope(sessionRef.current, true), 0);
        });

        return () => {
            subscription.unsubscribe();
            unsubscribeOrganization();
        };
    }, [applySessionScope]);

    const signInWithGoogle = async (nextPath?: string) => {
        setError(null);

        const safeNext = safeNextPath(nextPath, '');
        const redirectTo = safeNext
            ? `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(safeNext)}`
            : `${window.location.origin}/api/auth/callback`;

        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo,
            },
        });
        if (error) setError(error.message);
    };

    const signInWithPassword = async (email: string, password: string) => {
        setError(null);
        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        if (error) {
            setError(error.message);
            throw error;
        }
    };

    const requestPasswordReset = async (email: string) => {
        setError(null);
        const next = encodeURIComponent('/restablecer-clave');
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
            redirectTo: `${window.location.origin}/api/auth/callback?next=${next}`,
        });
        if (error) {
            setError(error.message);
            throw error;
        }
    };

    const updatePassword = async (password: string) => {
        setError(null);
        const { error } = await supabase.auth.updateUser({ password });
        if (error) {
            setError(error.message);
            throw error;
        }
    };

    const signOut = async () => {
        await supabase.auth.signOut();
        // The redirect below can leave before the auth listener runs; the next person on this browser starts clean.
        writeCachedAuthScope(null);
        window.location.href = '/login'; // Force full reload/redirect to clear state
    };

    return (
        <AuthContext.Provider value={{ user, session, organizationId, organizationRole, loading, error, signInWithGoogle, signInWithPassword, requestPasswordReset, updatePassword, signOut, refreshOrganization }}>
            <Fragment key={scopeResolved ? authScopeKey({ userId: user?.id, organizationId }) : authScopeKey(initialScope)}>
                {children}
            </Fragment>
        </AuthContext.Provider>
    );
}

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
