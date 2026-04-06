
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const service = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

console.log(`Anon Key Length: ${anon.length}`);
console.log(`Service Key Length: ${service.length}`);

if (anon === service) {
    console.log('WARNING: Service Key is identical to Anon Key!');
} else {
    console.log('Keys are different.');
}

if (service.length < 50) {
    console.log('WARNING: Service Key looks too short to be a valid JWT.');
}
