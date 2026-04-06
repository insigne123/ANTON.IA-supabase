
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

const service = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';

console.log('--- JWT Inspector ---');

if (!service.startsWith('ey')) {
    console.log('Key does not look like a JWT (does not start with ey).');
    process.exit(1);
}

try {
    const parts = service.split('.');
    if (parts.length !== 3) throw new Error('Not 3 parts');
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));

    console.log('JWT Payload:', JSON.stringify(payload, null, 2));

    const projectRefFromUrl = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
    console.log(`\nExpecting Project Ref: ${projectRefFromUrl}`);

    // Check against payload (if it contains ref info, usually 'iss' or 'ref' claim)
    if (payload.iss) {
        console.log(`Issuer (iss): ${payload.iss}`);
        if (projectRefFromUrl && !payload.iss.includes(projectRefFromUrl)) {
            console.error('❌ MISMATCH: Key Issuer does not contain the Project URL ref!');
        } else {
            console.log('✅ Issuer matches Project URL ref.');
        }
    }

    console.log(`Key End: ...${service.slice(-6)}`);

} catch (e) {
    console.error('Failed to parse JWT:', e.message);
}
