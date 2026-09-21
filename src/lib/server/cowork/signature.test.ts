import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCoworkSignature } from './signature';

test('signature keeps email formatting and removes executable and network content', () => {
  const result = sanitizeCoworkSignature('<p onclick="alert(1)"><b>Ana</b><br>Ventas</p>'
    + '<script>alert(1)</script><img src="https://tracking.example/pixel">'
    + '<a href="javascript:alert(1)">unsafe</a><a href="mailto:ana@example.com">Correo</a>'
    + '<div style="background:url(https://tracking.example/x)">Acme</div><iframe srcdoc="bad"></iframe>');
  assert.match(result.html, /<b>Ana<\/b>/);
  assert.match(result.html, /mailto:ana@example.com/);
  assert.doesNotMatch(result.html, /script|onclick|img|tracking|style=|iframe|javascript:/i);
  assert.match(result.text, /Ana\nVentas/);
  assert.deepEqual(sanitizeCoworkSignature(result.html), result);
});

test('signature rejects empty active-only content and strips encoded unsafe links', () => {
  assert.throws(() => sanitizeCoworkSignature('<script>bad</script><img src=x>'), /texto visible/);
  const result = sanitizeCoworkSignature('<a href="jav&#x61;script:alert(1)">Ana</a><svg onload="alert(1)"></svg>');
  assert.equal(result.html, '<a>Ana</a>');
});
