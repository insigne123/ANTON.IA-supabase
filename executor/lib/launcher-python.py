"""Trusted collector: tmpfs outputs are serialized before the container stops."""
import base64, json, os, re, subprocess, threading
watchdog = threading.Timer(max(1, min(120, int(os.environ.get('COWORK_JOB_TIMEOUT_MS', '120000')) / 1000)), lambda: os._exit(124))
watchdog.daemon = True
watchdog.start()
child = subprocess.Popen(['python', '-u', '/work/main.py'], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
streams = {}
def capture(key, stream):
    data = bytearray(); truncated = False
    while True:
        chunk = stream.read(8192)
        if not chunk: break
        left = max(0, 65536 - len(data))
        if len(chunk) > left: truncated = True
        data.extend(chunk[:left])
    streams[key] = (data.decode('utf-8', errors='replace'), truncated)
threads = [threading.Thread(target=capture, args=(key, stream)) for key, stream in [('stdout', child.stdout), ('stderr', child.stderr)]]
for thread in threads: thread.start()
code = child.wait()
for thread in threads: thread.join()
files = []; total = 0
if code == 0:
    entries = list(os.scandir('/out'))
    if len(entries) > 16: raise RuntimeError('Too many output files')
    for entry in entries:
        if not entry.is_file(follow_symlinks=False) or not re.match(r'^[^.][^/\\\x00]{0,119}\.(csv|json|md|txt|xlsx|docx|pptx|zip|html|css|js|mjs|png|svg|pdf)$', entry.name, re.I): continue
        total += entry.stat(follow_symlinks=False).st_size
        if total > 10 * 1024 * 1024: raise RuntimeError('Output exceeds 10 MB')
        with open(entry.path, 'rb') as source: data = source.read()
        files.append({'name': entry.name, 'size': len(data), 'contentBase64': base64.b64encode(data).decode('ascii')})
watchdog.cancel()
print(json.dumps({'status': 'completed' if code == 0 else 'failed', 'exitCode': code, 'files': files,
  'stdout': streams['stdout'][0], 'stderr': streams['stderr'][0], 'stdoutTruncated': streams['stdout'][1], 'stderrTruncated': streams['stderr'][1]}))
