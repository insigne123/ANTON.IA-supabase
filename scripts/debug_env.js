
const fs = require('fs');
const path = require('path');

const envPath = path.resolve('.env.local');

console.log('--- Debug .env.local ---');
if (fs.existsSync(envPath)) {
    console.log('File found.');
    const content = fs.readFileSync(envPath, 'utf-8');
    const lines = content.split('\n');
    lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const [key, ...val] = trimmed.split('=');
            if (key.includes('SUPABASE') || key.includes('CRON')) {
                console.log(`Line ${i + 1}: ${key.trim()} = ${val.length > 0 ? '(Present)' : '(Empty)'}`);
            }
        }
    });
} else {
    console.log('File NOT found.');
}
