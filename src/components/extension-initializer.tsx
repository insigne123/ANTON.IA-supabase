'use client';

import { useEffect } from 'react';
import { extensionService } from '@/lib/services/extension-service';

export function ExtensionInitializer() {
    useEffect(() => {
        extensionService.initListener();
    }, []);

    return null;
}
