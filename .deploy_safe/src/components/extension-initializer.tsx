'use client';

import { useEffect } from 'react';
import { extensionService } from '@/lib/services/extension-service';

export function ExtensionInitializer() {
    useEffect(() => {
        // Force initialization on mount
        console.log('[App] ExtensionInitializer mounted');
        extensionService.initListener();
        if (typeof window !== 'undefined') {
            (window as any).extensionService = extensionService;
        }
    }, []);

    return null;
}
