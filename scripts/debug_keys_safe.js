
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const service = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

console.log('--- Env Var Format Check ---');
console.log(`URL: '${url}'`);
console.log(`Key Start: '${service.substring(0, 5)}...'`);
console.log(`Key End:   '...${service.substring(service.length - 5)}'`);
console.log(`Key Length: ${service.length}`);

if (service.trim() !== service) {
    console.log('⚠️ WARNING: Key has leading/trailing whitespace!');
}
if (service.includes('"') || service.includes("'")) {
    console.log('⚠️ WARNING: Key contains quotes inside the value (dotenv might have parsed them literally if not careful)!');
}

// Extract project ref from URL
const projectRef = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
console.log(`Project Ref from URL: ${projectRef}`);
