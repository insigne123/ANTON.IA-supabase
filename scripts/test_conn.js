
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
    console.error('Missing credentials');
    process.exit(1);
}

const target = `${url}/rest/v1/organizations?select=count&limit=1`;

console.log(`Fetching: ${target}`);

fetch(target, {
    headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`
    }
})
    .then(res => {
        console.log(`Status: ${res.status}`);
        return res.text();
    })
    .then(text => console.log('Body:', text.slice(0, 100)))
    .catch(e => console.error('Fetch Error:', e));
