import { chromium } from 'playwright-core';
import fs from 'node:fs';

const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: edgePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const requests = [];
page.on('request', (r) => {
  if (r.url().includes('/api/')) requests.push({ method: r.method(), url: r.url(), postData: r.postData() });
});
page.on('response', (r) => {
  if (r.url().includes('/api/')) console.log('RESP:', r.status(), r.request().method(), r.url());
});
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE_ERR:', m.text()); });
page.on('pageerror', (e) => console.log('PAGE_ERR:', e.message));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.locator('input').nth(0).fill('admin');
await page.locator('input').nth(1).fill('admin123');
await page.getByRole('button', { name: '登录', exact: true }).click();
await page.waitForTimeout(2000);

const delBtn = page.locator('button[aria-label^="删除重命名后的会话"]').first();
console.log('target count:', await delBtn.count());
if (await delBtn.count() > 0) {
  await delBtn.locator('xpath=..').hover();
  await page.waitForTimeout(300);
  await delBtn.click();
  console.log('clicked delete');
  await page.waitForTimeout(2000);
  const body = await page.locator('body').innerText();
  console.log('still visible:', body.includes('重命名后的会话-自动化'));
  console.log('has 删除失败 notice:', body.includes('删除失败'));
  console.log('has 会话已删除 notice:', body.includes('会话已删除'));
}

console.log('ALL API REQUESTS:');
requests.forEach((r) => console.log(JSON.stringify(r)));
await page.screenshot({ path: 'lxreport1.0/ui/desktop-1440/delete-net-state.png', fullPage: false });
await browser.close();
