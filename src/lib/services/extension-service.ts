// Defines the interface for communicating with the Anton.IA Chrome Extension
import { normalizeLinkedinProfileUrl } from '@/lib/linkedin-url';

export type LinkedInSendResult = {
    success: boolean;
    error?: string;
    status?: 'confirmed_dm';
    linkedinThreadUrl?: string;
};

export const extensionService = {
    isInstalled: false,
    _listenerInitialized: false,
    _requestSeq: 0,

    initListener() {
        if (typeof window === 'undefined') return;
        if (this._listenerInitialized) return;
        this._listenerInitialized = true;

        const appOrigin = window.location.origin;

        window.addEventListener('message', (event) => {
            if (event.source !== window) return;
            if (event.origin !== appOrigin) return;
            if (!event.data || typeof event.data !== 'object') return;
            if (event.data.type === 'ANTON_EXTENSION_READY') {
                this.isInstalled = true;
            }
        });

        if (document.body.getAttribute('data-anton-extension-installed')) {
            this.isInstalled = true;
        }
    },

    async sendLinkedinDM(profileUrl: string, message: string): Promise<LinkedInSendResult> {
        const normalizedProfileUrl = normalizeLinkedinProfileUrl(profileUrl);
        if (!normalizedProfileUrl || !message.trim() || message.length > 500) {
            return { success: false, error: 'Revisa el perfil y limita el mensaje a 500 caracteres.' };
        }

        if (!this.isInstalled) {
            return { success: false, error: 'No detectamos la extensión de Anton.IA en este navegador.' };
        }

        const requestId = `linkedin-${Date.now()}-${++this._requestSeq}`;
        const timeoutMs = 60000;

        console.log('[App] Sending LinkedIn DM request:', { requestId, profileUrl, messageLength: message.length });

        return new Promise((resolve) => {
            let settled = false;
            const appOrigin = window.location.origin;

            const handler = (event: MessageEvent) => {
                if (event.source !== window) return;
                if (event.origin !== appOrigin) return;
                if (!event.data || typeof event.data !== 'object') return;
                if (event.data.type !== 'EXTENSION_Response') return;

                const payload = event.data.payload || {};
                if (payload.requestId && payload.requestId !== requestId) return;
                if (settled) return;

                settled = true;
                window.clearTimeout(timeoutId);
                window.removeEventListener('message', handler);
                if (payload.success && payload.status === 'confirmed_dm') {
                    resolve({ success: true, status: 'confirmed_dm', linkedinThreadUrl: payload.linkedinThreadUrl });
                } else {
                    resolve({ success: false, error: payload.error || 'LinkedIn no confirmó el mensaje.' });
                }
            };

            window.addEventListener('message', handler);

            const timeoutId = window.setTimeout(() => {
                if (settled) return;
                settled = true;
                window.removeEventListener('message', handler);
                console.error('[App] Timeout waiting for extension response', { requestId, timeoutMs });
                resolve({ success: false, error: `Timeout waiting for extension (${Math.round(timeoutMs / 1000)}s)` });
            }, timeoutMs);

            window.postMessage({
                type: 'ANTON_TO_EXTENSION',
                payload: {
                    action: 'SEND_DM',
                    requestId,
                    profileUrl: normalizedProfileUrl,
                    message,
                },
            }, appOrigin);
        });
    },
};

if (typeof window !== 'undefined') {
    extensionService.initListener();
}
