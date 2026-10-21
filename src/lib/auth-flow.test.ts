import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const callback = readFileSync('src/app/api/auth/callback/route.ts', 'utf8');
const login = readFileSync('src/app/login/page.tsx', 'utf8');
const reset = readFileSync('src/app/restablecer-clave/page.tsx', 'utf8');
const auth = readFileSync('src/context/AuthContext.tsx', 'utf8');
const middleware = readFileSync('src/middleware.ts', 'utf8');

test('every `next` after signing in goes through safeNextPath: callback, login page and Google', () => {
  assert.match(callback, /safeNextPath\(requestUrl\.searchParams\.get\('next'\), '\/'\)/);
  assert.match(login, /safeNextPath\(searchParams\.get\('next'\), '\/dashboard'\)/);
  assert.match(auth, /const safeNext = safeNextPath\(nextPath, ''\)/);
  for (const source of [callback, login, auth]) assert.doesNotMatch(source, /startsWith\('\/'\) \? next/, 'no hand-made check left');
});

test('a failed or expired link lands on the login page with a notice instead of a silent redirect', () => {
  assert.match(callback, /await supabase\.auth\.exchangeCodeForSession\(code!?\)/);
  assert.equal((callback.match(/\/login\?enlace=vencido/g) || []).length, 3, 'a Supabase `error` param, a token hash that is not a recovery token, and an exchange error');
  assert.match(login, /searchParams\.get\('enlace'\) === 'vencido'/);
});

test('«¿Olvidaste tu contraseña?» sends a link back through the callback to /restablecer-clave, which anyone can open', () => {
  assert.match(login, /¿Olvidaste tu contraseña\?/);
  assert.match(login, /requestPasswordReset\(email\)/);
  assert.match(login, /PASSWORD_RESET_SENT/, 'the same answer whether or not the account exists');
  assert.match(auth, /resetPasswordForEmail\(email\.trim\(\), \{\s*redirectTo: `\$\{window\.location\.origin\}\/api\/auth\/callback\?next=\$\{next\}`/);
  assert.match(auth, /encodeURIComponent\('\/restablecer-clave'\)/);
  assert.match(auth, /supabase\.auth\.updateUser\(\{ password \}\)/);
  assert.match(middleware, /pathname === '\/restablecer-clave'/);
  assert.match(reset, /updatePassword\(password\)/);
  assert.match(reset, /fetch\('\/api\/auth\/recovery', \{ method: 'POST'/, 'the token is spent by a click, never by opening the link');
  assert.match(reset, /href="\/login\?recuperar=1"/, 'an expired link offers a new one');
});

test('the forms show Spanish errors on the page and one password rule', () => {
  assert.match(login, /authErrorMessage\(error, fallback\)/);
  assert.match(login, /role=\{notice\.tone === 'error' \? 'alert' : 'status'\}/);
  assert.doesNotMatch(login, /useToast|toast\(/, 'errors no longer live only in a toast');
  assert.doesNotMatch(login, /minLength=\{6\}/);
  assert.match(reset, /newPasswordProblem\(password, confirmation\)/);
});

test('public access has no registration flow and the browser auth context cannot create accounts', () => {
  assert.doesNotMatch(login, /signUp|handleSignUp|Crear cuenta|Crea tu cuenta|email-register|value="register"/);
  assert.doesNotMatch(auth, /signUpWithPassword|auth\.signUp\(/);
  assert.match(login, /Las cuentas las crea la administración de ANTON\.IA/);
  assert.match(login, /signInWithPassword\(email, password\)/);
});

test('a recovery token is spent only by the POST that «Continuar» sends, never by a GET', () => {
  const recovery = readFileSync('src/app/api/auth/recovery/route.ts', 'utf8');
  assert.match(recovery, /export async function POST/);
  assert.doesNotMatch(recovery, /export async function GET/);
  assert.match(recovery, /verifyOtp\(\{ token_hash: token, type: 'recovery' \}\)/);
  assert.doesNotMatch(callback, /verifyOtp/, 'the callback, a GET, cannot spend it: a mail filter opens every link of a message');
  assert.doesNotMatch(reset, /verifyOtp/, 'and the page asks the server');
});
