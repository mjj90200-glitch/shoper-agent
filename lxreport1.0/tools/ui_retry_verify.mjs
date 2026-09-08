import { chromium } from 'playwright-core';
import fs from 'node:fs';

const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: edgePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.locator('input').nth(0).fill('admin');
await page.locator('input').nth(1).fill('admin123');
await page.getByRole('button', { name: '登录', exact: true }).click();
await page.waitForTimeout(2000);

// 切到数据分析，打开 error 项目
await page.locator('button, a, [role="tab"]').filter({ hasText: '数据分析' }).first().click();
await page.waitForTimeout(1500);
const projectBtn = page.locator('button').filter({ hasText: '2025年各地区销售表现分析' }).first();
await projectBtn.click();
await page.waitForTimeout(1500);

const before = await page.locator('body').innerText();
console.log('before errors:', (before.match(/Can't connect/g) || []).length);

// 点击第一个"单独重试"（MySQL 已恢复）
const retryBtn = page.locator('button').filter({ hasText: '单独重试' }).first();
console.log('retry btn count:', await retryBtn.count());
if (await retryBtn.count() > 0) {
  await retryBtn.click();
  await page.waitForTimeout(3000);
}

// 等待重试完成（错误减少或就绪）
let retried = false;
for (let i = 0; i < 120; i++) {
  await page.waitForTimeout(1000);
  const after = await page.locator('body').innerText();
  const errAfter = (after.match(/Can't connect/g) || []).length;
  const errBefore = (before.match(/Can't connect/g) || []).length;
  if (errAfter < errBefore) { retried = true; break; }
  if (after.includes('查询结果') && i > 20) { retried = true; break; }
}

const after = await page.locator('body').innerText();
const results = {
  retried,
  errorsBefore: (before.match(/Can't connect/g) || []).length,
  errorsAfter: (after.match(/Can't connect/g) || []).length,
  hasResult: after.includes('查询结果'),
  stillHasRetry: after.includes('单独重试'),
};
fs.writeFileSync('lxreport1.0/ui/ui-retry-verify.json', JSON.stringify(results, null, 2), 'utf-8');
await page.screenshot({ path: 'lxreport1.0/ui/desktop-1440/retry-verify.png', fullPage: false });
await browser.close();
console.log(JSON.stringify(results, null, 2));
