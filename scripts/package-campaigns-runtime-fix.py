"""Package the published release with the runtime route fix from main.

Every runtime source must match main HEAD or the campaigns work already in
main's working tree. Reject unrelated changes rather than deploying them.
"""
import pathlib
import subprocess
import sys
import zipfile

source, destination = map(pathlib.Path, sys.argv[1:3])
targets = sys.argv[3:] or ['src/app/(app)/campaigns/page.tsx']
assert set(targets) <= {'src/app/(app)/campaigns/page.tsx', 'src/components/campaigns/BulkCampaignWorkspace.tsx',
    'src/components/campaigns/CampaignSequenceEditor.tsx', 'src/lib/bulk-campaign-assist.ts',
    'src/app/api/campaigns/bulk/assist/route.ts', 'src/app/(app)/profile/page.tsx',
    'src/components/profile/password-change-form.tsx', 'src/lib/profile/password-change.ts',
    'src/app/(app)/settings/email-studio/page.tsx', 'src/components/email-studio/SignatureManager.tsx'}
root = pathlib.Path(__file__).resolve().parents[1]
branch = subprocess.check_output(['git', 'branch', '--show-current'], cwd=root).decode().strip()
assert branch == 'main', 'Release must originate from main'
normalize = lambda value: value.replace(b'\r\n', b'\n')
route = 'src/app/(app)/campaigns/page.tsx'
fixed = (root / route).read_bytes()
assert b"export const dynamic = 'force-dynamic'" in fixed
with zipfile.ZipFile(source) as previous:
    entries = {name: previous.read(name) for name in previous.namelist()}
    assert route in targets or b'force-dynamic' in entries[route], 'Published route must remain dynamic'
    for name, content in entries.items():
        if name.endswith('/') or not (name.startswith('src/') or name in (
            'package.json', 'package-lock.json', 'next.config.js', 'apphosting.yaml'
        )):
            continue
        if name in targets:
            continue
        head = subprocess.run(['git', 'show', 'main:' + name], cwd=root, capture_output=True)
        if head.returncode == 0 and normalize(head.stdout) == normalize(content):
            continue
        if head.returncode != 0 and (root / name).exists() and normalize((root / name).read_bytes()) == normalize(content):
            continue
        assert 'bulk' in name.lower() or name == route, 'Non-campaign source differs from main: ' + name
        assert normalize((root / name).read_bytes()) == normalize(content), name
    for name in targets:
        assert (root / name).exists(), 'Missing working-tree target: ' + name
        entries[name] = (root / name).read_bytes()
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as output:
        for name, content in entries.items():
            output.writestr(name, content)
with zipfile.ZipFile(source) as old, zipfile.ZipFile(destination) as new:
    differences = [name for name in old.namelist() if old.read(name) != new.read(name)]
    differences += [name for name in new.namelist() if name not in old.namelist()]
    assert set(differences) == set(targets), differences
print('Verified main provenance; published-source changes:', differences)
print(destination)
