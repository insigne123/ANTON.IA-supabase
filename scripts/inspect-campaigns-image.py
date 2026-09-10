"""Read-only check of the actual App Hosting image's Next route artifacts."""
import json
import subprocess
import sys
import tarfile
import urllib.request

token = subprocess.check_output(['gcloud.cmd', 'auth', 'print-access-token', '--quiet']).decode().strip()
base = 'https://us-central1-docker.pkg.dev/v2/leadflowai-3yjcy/firebaseapphosting-images/studio'

def fetch(path):
    return urllib.request.urlopen(urllib.request.Request(base + path, headers={
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.docker.distribution.manifest.v2+json',
    }), timeout=120)

manifest = json.load(fetch('/manifests/' + sys.argv[1]))
found = False
for layer in reversed(manifest['layers']):
    with fetch('/blobs/' + layer['digest']) as response:
        with tarfile.open(fileobj=response, mode='r|gz') as archive:
            for member in archive:
                if member.isfile() and '/static/chunks/' in member.name and member.name.endswith('.js'):
                    client_code = archive.extractfile(member).read()
                    if b'Generar correo con IA' in client_code:
                        print(json.dumps({'image': sys.argv[1], 'artifact': member.name,
                            'hasObjectiveGenerationAction': True,
                            'hasInlineGenerationSuccess': b'Correo generado.' in client_code}))
                    if b'Generar secuencia con IA' in client_code:
                        print(json.dumps({'image': sys.argv[1], 'artifact': member.name,
                            'hasSequenceGeneration': True,
                            'hasSideEditor': b'Asistente de IA' in client_code,
                            'hasExplicitChoice': b'Elige antes de generar' in client_code}))
                if member.name.endswith('/.next/server/app/(app)/campaigns/page.js'):
                    code = archive.extractfile(member).read().decode()
                    print(json.dumps({'image': sys.argv[1], 'artifact': member.name,
                        'hasForceDynamic': 'force-dynamic' in code,
                        'hasRuntimeFlag': 'BULK_CAMPAIGNS_ENABLED' in code,
                        'hasBulkWorkspace': 'BulkCampaignWorkspace' in code}))
                if member.name.endswith('/.next/prerender-manifest.json'):
                    data = json.load(archive.extractfile(member))
                    print(json.dumps({'image': sys.argv[1], 'artifact': member.name,
                        'campaignsPrerendered': '/campaigns' in data['routes'],
                        'campaignsEntry': data['routes'].get('/campaigns')}, ensure_ascii=True))
                    found = True
    if found:
        break
assert found, 'No Next prerender manifest found in image'
