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

// 切到数据分析
await page.getByRole('button', { name: '数据分析', exact: true }).click();
await page.waitForTimeout(1500);

const body = await page.locator('body').innerText();
const result = {
  url: page.url(),
  bodyHead: body.slice(0, 1500),
  hasNewAnalysis: body.includes('新分析'),
  hasGoalInput: await page.locator('textarea, input').count(),
  placeholders: await page.locator('textarea, input').evaluateAll((els) => els.map((e) => e.placeholder || e.getAttribute('aria-label') || '')),
  buttons: await page.locator('button').evaluateAll((els) => els.map((e) => (e.innerText || e.getAttribute('title') || e.getAttribute('aria-label') || '').trim().slice(0, 40)).filter(Boolean).slice(0, 40)),
};
fs.writeFileSync('lxreport1.0/ui/probe-analysis.json', JSON.stringify(result, null, 2), 'utf-8');
await page.screenshot({ path: 'lxreport1.0/ui/desktop-1440/analysis-mode.png', fullPage: false });
await browser.close();
console.log('DONE');
