import { chromium } from 'playwright-core';
import fs from 'node:fs';

const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: edgePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));

const results = {};

// 登录
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.locator('input').nth(0).fill('admin');
await page.locator('input').nth(1).fill('admin123');
await page.getByRole('button', { name: '登录', exact: true }).click();
await page.waitForTimeout(2000);

// 新问数会话
const newAsk = page.locator('button').filter({ hasText: '新问数' }).first();
await newAsk.click();
await page.waitForTimeout(1000);

// 新建会话 + 发送多指标查询（触发图表 + 多指标切换）
const newAsk2 = page.locator('button').filter({ hasText: '新问数' }).first();
await newAsk2.click();
await page.waitForTimeout(600);
const inputBox2 = page.locator('textarea').first();
await inputBox2.fill('按会员等级统计销售额和订单数');
await inputBox2.press('Enter');

let ready2 = false;
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(1000);
  const txt = await page.locator('body').innerText();
  if (txt.includes('就绪') && txt.includes('查询结果')) { ready2 = true; break; }
}
results.multiMetricQueryReady = ready2;
await page.screenshot({ path: 'lxreport1.0/ui/desktop-1440/multi-metric-result.png', fullPage: false });

// 等待结果出现
let ready = false;
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(1000);
  const txt = await page.locator('body').innerText();
  if (txt.includes('就绪') && (txt.includes('查询结果') || txt.includes('品类'))) { ready = true; break; }
}
results.queryReady = ready;

// TC-CHART-001: 图表切换（柱状/趋势/占比）
const chartButtons = page.locator('button').filter({ hasText: /柱状|趋势|占比/ });
results.chartButtonCount = await chartButtons.count();
const chartStates = {};
for (const label of ['柱状', '趋势', '占比']) {
  const btn = page.locator('button').filter({ hasText: new RegExp('^' + label + '$') }).first();
  if (await btn.count() > 0) {
    await btn.click();
    await page.waitForTimeout(600);
    // 检查是否有 chart 容器变化（SVG 通常存在）
    chartStates[label] = {
      svgCount: await page.locator('svg').count(),
      hasLegend: (await page.locator('body').innerText()).includes('手机数码') || (await page.locator('body').innerText()).includes('食品饮料'),
    };
  } else {
    chartStates[label] = null;
  }
}
results.chartSwitch = chartStates;

// TC-CHART-002: 指标切换（在分析步骤或问数多指标结果）
// 问数结果若是多指标，检查"分析指标"按钮
const metricBtns = page.locator('button').filter({ hasText: /销售额|销量|订单数/ });
results.metricButtonCount = await metricBtns.count();
if (await metricBtns.count() >= 3) {
  const before = await page.locator('body').innerText();
  await metricBtns.nth(1).click();
  await page.waitForTimeout(800);
  const after = await page.locator('body').innerText();
  results.metricSwitched = before !== after;
} else {
  results.metricSwitched = false;
}

// TC-EXPORT-001: 单步 CSV 下载
const csvBtn = page.locator('button').filter({ hasText: 'CSV' }).first();
if (await csvBtn.count() > 0) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    csvBtn.click(),
  ]);
  try {
    const path = 'lxreport1.0/scenario/export/tc-export-001-step.csv';
    await download.saveAs(path);
    const content = fs.readFileSync(path, 'utf-8');
    results.csvDownload = {
      ok: true,
      suggestedName: download.suggestedFilename(),
      size: fs.statSync(path).size,
      hasBom: content.charCodeAt(0) === 0xFEFF,
      head: content.slice(0, 200),
    };
  } catch (e) {
    results.csvDownload = { ok: false, error: String(e) };
  }
} else {
results.csvDownload = { ok: false, error: 'CSV button not found' };
}

results.consoleErrors = consoleErrors;
fs.writeFileSync('lxreport1.0/ui/ui-chart-export.json', JSON.stringify(results, null, 2), 'utf-8');
await page.screenshot({ path: 'lxreport1.0/ui/desktop-1440/chart-export.png', fullPage: false });
await browser.close();
console.log(JSON.stringify(results, null, 2));
