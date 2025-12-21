
const http = require('http');

function testEnrich() {
    const payload = JSON.stringify({
        leads: [{
            fullName: 'Non Existent Simulator',
            companyName: 'Simulated Corp',
            companyDomain: 'simulated-corp.com',
            sourceOpportunityId: 'sim-2'
        }],
        revealEmail: true,
        revealPhone: false,
        tableName: 'enriched_leads'
    });

    const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/opportunities/enrich-apollo',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': payload.length,
            'x-user-id': 'sim-user-id'
        }
    };

    console.log('Sending request via HTTP module...');
    const req = http.request(options, (res) => {
        console.log('Status:', res.statusCode);
        let data = '';

        res.on('data', (chunk) => {
            data += chunk;
        });

        res.on('end', () => {
            console.log('Body:', data);
        });
    });

    req.on('error', (e) => {
        console.error('Request failed:', e.message);
    });

    req.write(payload);
    req.end();
}

testEnrich();
