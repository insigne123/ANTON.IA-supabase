// scripts/simulate_linkedin_flow.js
// Run with: node scripts/simulate_linkedin_flow.js

console.log('=== Iniciando Simulación de Flujo LinkedIn ===\n');

// 1. Mock Data
const mockLead = {
    id: 'lead-123',
    fullName: 'Juan Perez',
    companyName: 'TechCorp',
    linkedinUrl: 'https://linkedin.com/in/juanperez',
    email: 'juan@techcorp.com',
    title: 'CTO',
    companyDomain: 'techcorp.com'
};

console.log('1. Datos del Lead:', mockLead);

// 2. Mock AI Generator (Logic from linkedin-templates.ts)
function mockGenerateDraft(lead, report) {
    console.log('   [AI] Generando borrador...');
    const firstName = lead.fullName.split(' ')[0];
    const company = lead.companyName || 'su empresa';

    if (report && report.cross && report.cross.pains && report.cross.pains[0]) {
        return `Hola ${firstName}, vi tu perfil en ${company}. Veo que en el sector es un reto "${report.cross.pains[0]}". Hablemos.`;
    }
    return `Hola ${firstName}, vi tu perfil y me pareció interesante lo que hacen en ${company}. Conectemos.`;
}

// 3. Mock Extension Service (Logic from extension-service.ts)
const mockExtensionService = {
    isInstalled: true,
    sendLinkedinDM: async (url, message) => {
        console.log(`   [Extensión] Enviando mensaje a ${url}...`);
        console.log(`   [Extensión] Contenido: "${message}"`);
        // Simulate latency
        await new Promise(r => setTimeout(r, 500));
        // Simulate success
        return { success: true };
    }
};

// 4. Mock Storage (Logic from contacted-leads-service.ts)
const mockStorage = {
    add: async (item) => {
        console.log('   [DB] Guardando en contacted_leads:', {
            id: item.id,
            leadId: item.leadId,
            provider: item.provider,
            status: item.status,
            threadUrl: item.linkedinThreadUrl
        });
        return true;
    }
};

// === RUN SIMULATION ===
(async () => {
    try {
        console.log('\n--- Paso 1: Apertura de Modal ---');
        // Scenario A: Basic Lead (No Report)
        const draftA = mockGenerateDraft(mockLead, null);
        console.log('   Borrador generado (Básico):', draftA);

        // Scenario B: Enriched Lead (With Report)
        const mockReport = { cross: { pains: ['Costos altos de AWS'] } };
        const draftB = mockGenerateDraft(mockLead, mockReport);
        console.log('   Borrador generado (Enriquecido):', draftB);

        console.log('\n--- Paso 2: Envío (Simulando clic en "Enviar con Extensión") ---');
        const messageToSend = draftB;

        // Check Extension
        if (!mockExtensionService.isInstalled) throw new Error("Extension missing");

        // Send
        const res = await mockExtensionService.sendLinkedinDM(mockLead.linkedinUrl, messageToSend);

        if (res.success) {
            // Save
            await mockStorage.add({
                id: 'uuid-gen-123',
                leadId: mockLead.id,
                provider: 'linkedin',
                status: 'sent',
                linkedinThreadUrl: mockLead.linkedinUrl,
                subject: 'LinkedIn DM',
                sentAt: new Date().toISOString()
            });
            console.log('   Result: ÉXITO. Flujo completado correctamente.');
        } else {
            console.error('   Result: FALLO en extensión.');
        }

    } catch (e) {
        console.error('   Simulación fallida:', e);
    }
    console.log('\n=== Simulación Finalizada ===');
})();
