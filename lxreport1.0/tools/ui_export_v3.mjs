import { chromium } from 'playwright-core';
import fs from 'node:fs';

const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: edgePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.locator('input').nth(0).fill('admin');
await page.locator('input').nth(1).fill('admin123');
await page.getByRole('button', { name: '登录', exact: true }).click();
await page.waitForTimeout(2000);

// 新建会话 + 查询多指标
await page.locator('button').filter({ hasText: '新问数' }).first().click();
await page.waitForTimeout(800);
await page.locator('textarea').first().fill('按会员等级统计销售额和订单数');
await page.locator('textarea').first().press('Enter');

// 等待就绪 + CSV 显示
let csvReady = false;
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(1000);
  const txt = await page.locator('body').innerText();
  if (txt.includes('就绪') && txt.includes('查询结果') && txt.includes('CSV')) { csvReady = true; break; }
}
console.log('csv ready:', csvReady);
await page.screenshot({ path: 'lxreport1.0/ui/desktop-1440/csv-ready.png', fullPage: false });

const results = {};

// TC-EXPORT-001: 单步 CSV
const csvBtn = page.locator('button').filter({ hasText: 'CSV' }).last();
if (await csvBtn.count() > 0) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    csvBtn.click(),
  ]);
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
} else {
  results.csvDownload = { ok: false, reason: 'no CSV button' };
}
results.csvReady = csvReady;
console.log(JSON.stringify(results, null, 2));

// TC-EXPORT-002: 完整数据（在已完成分析项目里）
// 切到数据分析，找一个 complete 项目
await page.locator('button, a, [role="tab"]').filter({ hasText: '数据分析' }).first().click();
await page.waitForTimeout(1500);
const printBtn = page.locator('button').filter({ hasText: /打印|PDF/ }).first();
const fullDataBtn = page.locator('button').filter({ hasText: '完整数据' }).first();
console.log('print button count:', await printBtn.count());
console.log('full data button count:', await fullDataBtn.count());
await page.screenshot({ path: 'lxreport1.0/ui/desktop-1440/analysis-complete-view.png', fullPage: false });

// 如果有完整数据按钮，点击下载
if (await fullDataBtn.count() > 0) {
  try {
    const [dl2] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      fullDataBtn.click(),
    ]);
    const p2 = 'lxreport1.0/scenario/export/tc-export-002-full.csv';
    await dl2.saveAs(p2);
    results.fullDataExport = { ok: true, size: fs.statSync(p2).size, name: dl2.suggestedFilename() };
  } catch (e) {
    results.fullDataExport = { ok: false, error: String(e) };
  }
} else {
  results.fullDataExport = { ok: false, reason: 'no complete project with full data button found' };
}
results.printButtonFound = await printBtn.count() > 0;

// 如果有打印按钮，点击打开新窗口验证
if (await printBtn.count() > 0) {
  try {
    const [popup] = await Promise.all([
      page.waitForEvent('popup', { timeout: 5000 }),
      printBtn.click(),
    ]);
    await popup.waitForTimeout(800);
    const popupTitle = await popup.title();
    const popupBody = await popup.locator('body').innerText();
    results.printPopup = {
      ok: true,
      title: popupTitle,
      hasTitle: popupBody.includes('分析报告') || popupBody.includes('分析项目'),
      hasConclusion: popupBody.includes('结论') || popupBody.includes('overview'),
      hasFindings: popupBody.includes('发现') || popupBody.includes('findings'),
    };
    await popup.close();
  } catch (e) {
    results.printPopup = { ok: false, error: String(e) };
  }
} else {
  results.printPopup = { ok: false, reason: 'no print button' };
}

fs.writeFileSync('lxreport1.0/ui/ui-export-results.json', JSON.stringify(results, null, 2), 'utf-8');
await browser.close();
console.log('FINAL:', JSON.stringify(results, null, 2));
