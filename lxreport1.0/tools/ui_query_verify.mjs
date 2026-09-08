import { chromium } from 'playwright-core';
import fs from 'node:fs';

const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: edgePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));

const results = {};

// 登录
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.locator('input').nth(0).fill('admin');
await page.locator('input').nth(1).fill('admin123');
await page.getByRole('button', { name: '登录', exact: true }).click();
await page.waitForTimeout(2000);

// 点击"新问数"创建全新会话
const newAsk = page.locator('button').filter({ hasText: '新问数' }).first();
if (await newAsk.count() > 0) {
  await newAsk.click();
  await page.waitForTimeout(1200);
  results.newAskClicked = true;
} else {
  results.newAskClicked = false;
}

// 找到输入区并发送华北问题
let inputBox = page.locator('textarea').first();
if (await inputBox.count() === 0) {
  inputBox = page.locator('[contenteditable="true"]').first();
}
await inputBox.click();
await inputBox.fill('统计华北地区的销售总额');
await page.waitForTimeout(400);

// 发送（Enter 或按钮）
const sendBtn = page.locator('button').filter({ hasText: /发送/ }).last();
if (await sendBtn.count() > 0) {
  await sendBtn.click();
  results.sendMethod = 'button';
} else {
  await inputBox.press('Enter');
  results.sendMethod = 'enter';
}

// 等待结果：先等"运行中"出现，再等"就绪"或 41099.5
let sawRunning = false;
let saw41099 = false;
let finalText = '';
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(1000);
  finalText = await page.locator('body').innerText();
  if (finalText.includes('运行中') || finalText.includes('查询中') || finalText.includes('生成')) {
    sawRunning = true;
  }
  if (finalText.includes('41,099.5') || finalText.includes('41099.5')) {
    saw41099 = true;
    break;
  }
  if (finalText.includes('就绪') && i > 15) {
    break;
  }
}

results.sawRunning = sawRunning;
results.saw41099 = saw41099;
results.resultReachedReady = finalText.includes('就绪');
results.hasSalesTotal = finalText.includes('销售总额');
results.bodyTail = finalText.slice(-1200);

await page.screenshot({ path: 'lxreport1.0/ui/desktop-1440/query-41099.png', fullPage: true });
results.consoleErrors = consoleErrors;
fs.writeFileSync('lxreport1.0/ui/ui-query-verify.json', JSON.stringify(results, null, 2), 'utf-8');
await browser.close();
console.log(JSON.stringify(results, null, 2));
