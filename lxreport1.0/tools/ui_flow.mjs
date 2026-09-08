import { chromium } from 'playwright-core';
import fs from 'node:fs';

const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: edgePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));

const results = {};

// 1. 登录
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const inputs = page.locator('input');
await inputs.nth(0).fill('admin');
await inputs.nth(1).fill('admin123');
await page.getByRole('button', { name: '登录', exact: true }).click();
await page.waitForTimeout(2500);
results.login = {
  url: page.url(),
  hasUserInfo: (await page.locator('body').innerText()).includes('admin'),
};
await page.screenshot({ path: 'lxreport1.0/ui/desktop-1440/admin-main.png', fullPage: false });

// 2. 问数：华北销售总额
await page.waitForTimeout(1000);
const q = '统计华北地区的销售总额';
const body = await page.locator('body').innerText();
// 尝试找到输入框（textarea 或 contenteditable）
let inputBox = page.locator('textarea').first();
if (await inputBox.count() === 0) {
  inputBox = page.locator('[contenteditable="true"]').first();
}
if (await inputBox.count() === 0) {
  inputBox = page.locator('input[type="text"]').last();
}
const boxCount = await inputBox.count();
results.inputBoxFound = boxCount > 0;
if (boxCount > 0) {
  await inputBox.click();
  await inputBox.fill(q);
  await page.waitForTimeout(300);
  // 发送按钮
  const sendBtn = page.locator('button').filter({ hasText: /发送|查询|问/ }).last();
  await sendBtn.click();
  results.querySent = true;
} else {
  results.querySent = false;
}

// 3. 等待结果（SSE 完成）
let resultText = '';
let resultFound = false;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000);
  resultText = await page.locator('body').innerText();
  if (resultText.includes('41,099.5') || resultText.includes('41099.5')) {
    resultFound = true;
    break;
  }
  if (resultText.includes('销售总额')) {
    resultFound = true;
    break;
  }
}
results.queryResult = {
  found: resultFound,
  has41099: resultText.includes('41,099.5') || resultText.includes('41099.5'),
  bodySnippet: resultText.slice(-1500),
};
await page.screenshot({ path: 'lxreport1.0/ui/desktop-1440/query-result.png', fullPage: true });

// 4. 隐藏流程 / 展开流程
const hideBtn = page.locator('button').filter({ hasText: /隐藏流程|收起流程|隐藏/ }).first();
if (await hideBtn.count() > 0) {
  await hideBtn.click();
  await page.waitForTimeout(800);
  results.hideFlow = true;
  await page.screenshot({ path: 'lxreport1.0/ui/desktop-1440/hidden-flow.png', fullPage: false });
  const expandBtn = page.locator('button').filter({ hasText: /展开流程|显示流程|展开/ }).first();
  if (await expandBtn.count() > 0) {
    await expandBtn.click();
    await page.waitForTimeout(800);
    results.expandFlow = true;
  } else {
    results.expandFlow = false;
  }
} else {
  results.hideFlow = false;
  results.expandFlow = false;
}

// 5. 会话列表检查
await page.waitForTimeout(800);
const bodyAfter = await page.locator('body').innerText();
results.sessionListHasQuery = bodyAfter.includes('统计华北地区的销售总额');

// 6. 模式切换（问数 -> 数据分析 -> 问数）
const analysisBtn = page.locator('button, a, [role="tab"]').filter({ hasText: /数据分析/ }).first();
if (await analysisBtn.count() > 0) {
  await analysisBtn.click();
  await page.waitForTimeout(1200);
  const analysisBody = await page.locator('body').innerText();
  results.analysisMode = analysisBody.includes('分析') || analysisBody.includes('项目');
  await page.screenshot({ path: 'lxreport1.0/ui/desktop-1440/analysis-mode.png', fullPage: false });
  const askBtn = page.locator('button, a, [role="tab"]').filter({ hasText: /问数/ }).first();
  if (await askBtn.count() > 0) {
    await askBtn.click();
    await page.waitForTimeout(1000);
  }
  results.switchBack = true;
} else {
  results.analysisMode = false;
  results.switchBack = false;
}

// 7. 回到问数后确认内容还在
const finalBody = await page.locator('body').innerText();
results.backToAsk = finalBody.includes('统计华北地区的销售总额');

// 8. 窄屏截图（模拟手机）
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(800);
await page.screenshot({ path: 'lxreport1.0/ui/mobile-390/query-result.png', fullPage: false });

// 9. 小屏
await page.setViewportSize({ width: 1024, height: 768 });
await page.waitForTimeout(800);
await page.screenshot({ path: 'lxreport1.0/ui/laptop-1024/query-result.png', fullPage: false });

results.consoleErrors = consoleErrors;
fs.writeFileSync('lxreport1.0/ui/ui-results.json', JSON.stringify(results, null, 2), 'utf-8');
await browser.close();
console.log(JSON.stringify(results, null, 2));
