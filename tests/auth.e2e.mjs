import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

// Authentication is routed to a local fixture. This test never contacts a real
// Supabase project, sends mail, or asks Google for an account.
const baseURL = process.env.AKASHEET_TEST_URL || 'http://localhost:5173/';
const authOrigin = 'https://auth-test.supabase.co';
const artifacts = process.env.AKASHEET_QA_DIR || fileURLToPath(new URL('../test-results/auth', import.meta.url));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  args: ['--no-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 950 }, serviceWorkers: 'block' });
const page = await context.newPage();
const errors = [];
const calls = [];
let recoveryRedirect = null;
let googleAuthorization = null;
let changedPassword = null;
const createdAt = '2026-01-01T00:00:00.000Z';
const alice = { id: '11111111-1111-4111-8111-111111111111', email: 'alice@example.test' };
const bob = { id: '22222222-2222-4222-8222-222222222222', email: 'bob@example.test' };
function user(person) {
  return { ...person, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [{ id: person.id, user_id: person.id, identity_id: person.id, provider: 'email', identity_data: { sub: person.id, email: person.email }, created_at: createdAt, updated_at: createdAt }], created_at: createdAt, updated_at: createdAt, email_confirmed_at: createdAt };
}
function session(person) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: person.id, email: person.email, role: 'authenticated', aud: 'authenticated', iss: `${authOrigin}/auth/v1`, iat: now, exp: now + 3600 })).toString('base64url');
  return { access_token: `${header}.${payload}.fixture-signature`, refresh_token: `fixture-refresh-${person.id}`, expires_in: 3600, expires_at: now + 3600, token_type: 'bearer', user: user(person) };
}
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'access-control-expose-headers': 'x-supabase-api-version',
  'x-supabase-api-version': '2024-01-01',
};
async function json(route, value, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(value) });
}
await context.route('**/auth-config.json', route => json(route, { url: authOrigin, publishableKey: 'sb_publishable_auth_browser_fixture' }));
await context.route(`${authOrigin}/auth/v1/**`, async route => {
  const request = route.request();
  const url = new URL(request.url());
  if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return; }
  let body = {};
  try { body = request.postDataJSON() || {}; } catch {}
  calls.push({ path: url.pathname, method: request.method(), query: url.searchParams, body });
  if (url.pathname.endsWith('/settings')) { await json(route, { external: { google: true, email: true }, disable_signup: false, mailer_autoconfirm: false }); return; }
  if (url.pathname.endsWith('/authorize')) {
    googleAuthorization = url;
    await route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ja"><title>OAuth fixture</title><body>OAuth fixture reached</body></html>' });
    return;
  }
  if (url.pathname.endsWith('/token')) {
    if (url.searchParams.get('grant_type') === 'password') {
      if (body.password === 'wrong-password') { await json(route, { code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400); return; }
      await json(route, session(body.email === bob.email ? bob : alice)); return;
    }
    if (url.searchParams.get('grant_type') === 'pkce') { await json(route, session(alice)); return; }
    await json(route, session(String(body.refresh_token).includes(bob.id) ? bob : alice)); return;
  }
  if (url.pathname.endsWith('/signup')) { await json(route, user({ ...alice, email: body.email })); return; }
  if (url.pathname.endsWith('/recover')) { recoveryRedirect = url.searchParams.get('redirect_to'); await json(route, {}); return; }
  if (url.pathname.endsWith('/resend')) { await json(route, {}); return; }
  if (url.pathname.endsWith('/logout')) { await route.fulfill({ status: 204, headers: cors }); return; }
  if (url.pathname.endsWith('/user')) {
    if (request.method() === 'PUT') changedPassword = body.password;
    const authorization = request.headers().authorization || '';
    const tokenPayload = authorization.split('.')[1];
    const claims = tokenPayload ? JSON.parse(Buffer.from(tokenPayload, 'base64url').toString()) : {};
    await json(route, user(claims.sub === bob.id ? bob : alice)); return;
  }
  throw new Error(`Unexpected mocked auth endpoint: ${request.method()} ${url.pathname}`);
});
page.on('pageerror', error => errors.push(error.message));
const guestCard = () => page.getByRole('button', { name: 'サンプル｜理科と英語の暗記シートを開く', exact: true });
const dialog = () => page.getByRole('dialog');
const waitCanvas = async () => {
  await page.locator('.canvas-container canvas:not(.canvas-loading)').waitFor({ state: 'visible' });
  await page.waitForFunction(() => { const canvas = document.querySelector('.canvas-container canvas'); return canvas?.width > 100; });
};
async function openLogin() {
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await dialog().getByLabel('メールアドレス', { exact: true }).waitFor();
}
async function emailSignIn(person, password = 'correct-password') {
  await openLogin();
  await dialog().getByLabel('メールアドレス', { exact: true }).fill(person.email);
  await dialog().getByLabel('パスワード', { exact: true }).fill(password);
  await dialog().getByRole('button', { name: 'メールでログイン', exact: true }).click();
  if (password !== 'wrong-password') {
    await page.getByRole('button', { name: 'アカウントを開く', exact: true }).waitFor();
    await dialog().waitFor({ state: 'hidden' });
  }
}
async function signOut() {
  await page.getByRole('button', { name: 'アカウントを開く', exact: true }).click();
  await dialog().getByRole('button', { name: 'ログアウト', exact: true }).click();
  await page.getByRole('button', { name: 'ログイン', exact: true }).waitFor();
  await dialog().waitFor({ state: 'hidden' });
}

async function rejectSecretConfig() {
  const isolated = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const target = await isolated.newPage();
  const authRequests = [];
  try {
    await isolated.route('**/auth-config.json', route => json(route, { url: authOrigin, publishableKey: 'sb_secret_not_a_real_key_browser_fixture' }));
    await isolated.route(`${authOrigin}/auth/v1/**`, async route => {
      authRequests.push(route.request().url());
      await json(route, { error_code: 'fixture_must_not_be_called' }, 400);
    });
    await target.goto(baseURL);
    await target.getByRole('button', { name: 'ログイン', exact: true }).click();
    const authDialog = target.getByRole('dialog');
    await authDialog.getByText('ログイン機能は現在準備中です。', { exact: true }).waitFor();
    assert.equal(await authDialog.locator('input').count(), 0, 'secret keys must not create a login form/client');
    await authDialog.getByRole('button', { name: 'ゲストで利用する' }).click();
    await target.getByRole('button', { name: 'サンプルPDFで試す', exact: true }).click();
    await target.locator('.canvas-container canvas:not(.canvas-loading)').waitFor({ state: 'visible' });
    assert.deepEqual(authRequests, [], 'rejected privileged config must never be sent to Auth');
  } finally { await isolated.close(); }
}

async function disabledGoogleProvider() {
  const isolated = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const target = await isolated.newPage();
  let settingsCalls = 0;
  try {
    await isolated.route('**/auth-config.json', route => json(route, { url: authOrigin, publishableKey: 'sb_publishable_auth_browser_fixture' }));
    await isolated.route(`${authOrigin}/auth/v1/**`, async route => {
      const request = route.request();
      if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return; }
      const path = new URL(request.url()).pathname;
      assert.ok(path.endsWith('/settings'), `disabled-provider test must not authenticate: ${path}`);
      settingsCalls++;
      await json(route, { external: { google: false, email: true }, disable_signup: false });
    });
    const settingsResponse = target.waitForResponse(response => response.url() === `${authOrigin}/auth/v1/settings`);
    await target.goto(baseURL);
    await settingsResponse;
    await target.getByRole('button', { name: 'ログイン', exact: true }).click();
    const authDialog = target.getByRole('dialog');
    assert.equal(await authDialog.getByRole('button', { name: 'Googleでログイン', exact: true }).isDisabled(), true);
    await authDialog.getByText('Googleログインは現在準備中です。', { exact: true }).waitFor();
    assert.equal(await authDialog.getByLabel('メールアドレス', { exact: true }).isEnabled(), true);
    assert.equal(await authDialog.getByRole('button', { name: 'メールでログイン', exact: true }).isEnabled(), true);
    assert.ok(settingsCalls > 0, 'provider state comes from Auth settings');
    assert.equal(await target.evaluate(() => document.documentElement.scrollWidth), 390);
  } finally { await isolated.close(); }
}

async function invalidPkceCallback() {
  const isolated = await browser.newContext({ serviceWorkers: 'block' });
  const target = await isolated.newPage();
  let exchanges = 0;
  try {
    await isolated.addInitScript(() => {
      localStorage.setItem('akasheet-auth-v1-auth-test-supabase-co-code-verifier', JSON.stringify('fixture-expired-verifier'));
    });
    await isolated.route('**/auth-config.json', route => json(route, { url: authOrigin, publishableKey: 'sb_publishable_auth_browser_fixture' }));
    await isolated.route(`${authOrigin}/auth/v1/**`, async route => {
      const request = route.request();
      if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return; }
      const url = new URL(request.url());
      if (url.pathname.endsWith('/settings')) { await json(route, { external: { google: true, email: true } }); return; }
      if (url.pathname.endsWith('/token') && url.searchParams.get('grant_type') === 'pkce') {
        exchanges++;
        await json(route, { code: 'bad_code_verifier', msg: 'Fixture expired PKCE verifier' }, 400);
        return;
      }
      throw new Error(`Unexpected callback fixture endpoint: ${url.pathname}`);
    });
    const callback = new URL(baseURL);
    callback.searchParams.set('code', 'fixture-expired-code');
    await target.goto(callback.href);
    const alert = target.getByRole('dialog').getByRole('alert');
    await alert.waitFor();
    assert.match(await alert.innerText(), /認証リンク.*有効期限|別のブラウザ/);
    await target.waitForFunction(() => !new URL(location.href).searchParams.has('code'));
    assert.equal(await target.getByRole('button', { name: 'アカウントを開く', exact: true }).count(), 0);
    assert.equal(exchanges, 1, 'failed callback exchanges exactly once and surfaces the failure');
  } finally { await isolated.close(); }
}

try {
  await mkdir(artifacts, { recursive: true });
  await page.goto(baseURL);
  await page.getByRole('button', { name: 'ログイン', exact: true }).waitFor();

  // Guest access keeps working; its PDF must not silently become another account's.
  await page.getByRole('button', { name: 'サンプルPDFで試す', exact: true }).click();
  await waitCanvas();
  await page.getByRole('button', { name: 'ライブラリに戻る', exact: true }).click();
  await guestCard().waitFor();

  await emailSignIn(alice, 'wrong-password');
  await dialog().getByRole('alert').waitFor();
  assert.match(await dialog().getByRole('alert').innerText(), /メール|パスワード|ログイン/);
  await dialog().getByLabel('パスワード', { exact: true }).fill('correct-password');
  await dialog().getByRole('button', { name: 'メールでログイン', exact: true }).click();
  await page.getByRole('button', { name: 'アカウントを開く', exact: true }).waitFor();
  await dialog().waitFor({ state: 'hidden' });
  assert.equal(await guestCard().count(), 0, 'Alice must not automatically see guest PDFs');

  await page.getByRole('button', { name: 'サンプルPDFで試す', exact: true }).click();
  await waitCanvas();
  await page.getByRole('button', { name: '次のページ', exact: true }).click();
  await waitCanvas();
  await page.getByRole('button', { name: 'しおりを付ける', exact: true }).click();
  await page.getByRole('button', { name: 'ライブラリに戻る', exact: true }).click();
  await guestCard().waitFor();

  await page.reload();
  await page.getByRole('button', { name: 'アカウントを開く', exact: true }).waitFor();
  await guestCard().waitFor();
  await page.getByRole('button', { name: 'アカウントを開く', exact: true }).click();
  assert.match(await dialog().innerText(), /alice@example\.test/);
  await dialog().getByRole('button', { name: 'ログイン画面を閉じる', exact: true }).click();
  await signOut();
  await guestCard().waitFor();
  await guestCard().click();
  await waitCanvas();
  assert.equal(await page.getByRole('textbox', { name: 'ページ番号' }).inputValue(), '1', 'guest progress remains separate from Alice');
  await page.getByRole('button', { name: 'ライブラリに戻る', exact: true }).click();

  await emailSignIn(bob);
  assert.equal(await guestCard().count(), 0, 'Bob must not see Alice or guest PDFs');
  await page.getByRole('button', { name: 'ゲストの教材をコピー', exact: true }).click();
  await guestCard().waitFor();
  await guestCard().click();
  await waitCanvas();
  assert.equal(await page.getByRole('textbox', { name: 'ページ番号' }).inputValue(), '1', 'explicit copy starts with guest progress');
  await page.getByRole('button', { name: '次のページ', exact: true }).click();
  await waitCanvas();
  await page.getByRole('button', { name: 'ライブラリに戻る', exact: true }).click();
  await signOut();
  await guestCard().click();
  await waitCanvas();
  assert.equal(await page.getByRole('textbox', { name: 'ページ番号' }).inputValue(), '1', 'guest copy preserves the original guest PDF and progress');
  await page.getByRole('button', { name: 'ライブラリに戻る', exact: true }).click();
  await emailSignIn(alice);
  await guestCard().click();
  await waitCanvas();
  assert.equal(await page.getByRole('textbox', { name: 'ページ番号' }).inputValue(), '2');
  assert.equal(await page.getByRole('button', { name: 'しおりを外す', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'ライブラリに戻る', exact: true }).click();
  await signOut();

  await openLogin();
  await dialog().getByRole('button', { name: '新規登録する', exact: true }).click();
  await dialog().getByLabel('メールアドレス', { exact: true }).fill('new-student@example.test');
  await dialog().getByLabel('パスワード', { exact: true }).fill('new-student-password');
  await dialog().getByRole('button', { name: 'アカウントを作成', exact: true }).click();
  await dialog().getByRole('status').waitFor();
  assert.match(await dialog().getByRole('status').innerText(), /メール|確認/);
  const signupCall = calls.find(call => call.path.endsWith('/signup'));
  assert.ok(signupCall?.body.code_challenge, 'email signup is PKCE protected');
  assert.equal(signupCall.query.get('redirect_to')?.split('?')[0], new URL('./', baseURL).href);
  await dialog().getByRole('button', { name: 'ログインに戻る', exact: true }).click();
  await dialog().getByRole('button', { name: 'パスワードを忘れた方', exact: true }).click();
  await dialog().getByLabel('メールアドレス', { exact: true }).fill(alice.email);
  await dialog().getByRole('button', { name: '再設定メールを送る', exact: true }).click();
  await dialog().getByRole('status').waitFor();
  assert.ok(recoveryRedirect, 'reset sends callback to the app');
  assert.equal(new URL(recoveryRedirect).pathname, new URL(baseURL).pathname);
  const recoverCall = calls.find(call => call.path.endsWith('/recover'));
  assert.equal(recoverCall.body.code_challenge_method, 's256');

  // Follow the fixture's password recovery callback using the verifier saved by
  // the real SDK, then verify that the new password reaches updateUser().
  const recoveredURL = new URL(recoveryRedirect);
  recoveredURL.searchParams.set('code', 'fixture-recovery-code');
  await page.goto(recoveredURL.href);
  await page.getByRole('heading', { name: '新しいパスワードを設定', exact: true }).waitFor();
  await dialog().getByLabel('パスワード', { exact: true }).fill('changed-fixture-password');
  await dialog().getByLabel('パスワード（確認）', { exact: true }).fill('changed-fixture-password');
  await dialog().getByRole('button', { name: 'パスワードを更新', exact: true }).click();
  await page.waitForFunction(() => !location.search.includes('code='));
  await page.getByRole('button', { name: 'アカウントを開く', exact: true }).waitFor();
  assert.equal(changedPassword, 'changed-fixture-password');
  if (await dialog().count()) await dialog().getByRole('button', { name: 'ログイン画面を閉じる', exact: true }).click();
  await signOut();

  await page.setViewportSize({ width: 390, height: 844 });
  await openLogin();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await page.screenshot({ path: `${artifacts}/mobile-login.png`, fullPage: true });
  await dialog().getByRole('button', { name: 'Googleでログイン', exact: true }).click();
  await page.waitForURL(url => url.origin === authOrigin);
  assert.ok(googleAuthorization, 'Google navigates to Supabase authorize');
  assert.equal(googleAuthorization.searchParams.get('provider'), 'google');
  assert.equal(new URL(googleAuthorization.searchParams.get('redirect_to')).pathname, new URL(baseURL).pathname);
  assert.equal(googleAuthorization.searchParams.get('code_challenge_method'), 's256');
  assert.ok(googleAuthorization.searchParams.get('code_challenge')?.length >= 40);
  assert.deepEqual(errors, [], 'no unhandled JavaScript errors');
  await rejectSecretConfig();
  await disabledGoogleProvider();
  await invalidPkceCallback();
  console.log(JSON.stringify({ status: 'passed', mockedAuth: true, checks: ['guest PDF access', 'invalid credentials', 'email login', 'logout', 'session persistence', 'account library isolation', 'guest progress preserved', 'explicit guest copy preserves original', 'account progress preserved', 'signup confirmation', 'password reset PKCE', 'password update', 'mobile login layout', 'Google OAuth PKCE redirect', 'privileged config rejected without auth requests', 'disabled Google provider', 'invalid PKCE callback feedback'], authRequests: calls.length }, null, 2));
} finally {
  await browser.close();
}
