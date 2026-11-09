import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  args: ['--no-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(process.env.AKASHEET_TEST_URL || 'http://localhost:4173/annki/');
  await page.getByRole('button', { name: 'サンプルPDFで試す' }).waitFor();
  await page.evaluate(() => Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Service Worker did not become ready')), 15000)),
  ]));
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'サンプルPDFで試す' }).click();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.canvas-container canvas');
    return canvas && canvas.width > 100 && !canvas.classList.contains('canvas-loading');
  });
  await page.getByRole('button', { name: '次のページ', exact: true }).click();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.canvas-container canvas');
    return canvas && canvas.getAttribute('aria-label').includes('2ページ') && !canvas.classList.contains('canvas-loading');
  });
  assert.equal(await page.getByRole('switch').getAttribute('aria-checked'), 'true');
  await page.getByRole('button', { name: 'ライブラリに戻る' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  assert.deepEqual(errors, []);
  console.log('Passed: subdirectory hosting, offline reload, offline PDF sample/page navigation, mobile layout.');
} finally {
  await browser.close();
}
