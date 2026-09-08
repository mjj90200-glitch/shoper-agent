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

// 切到数据分析
await page.locator('button, a, [role="tab"]').filter({ hasText: '数据分析' }).first().click();
await page.waitForTimeout(1200);

// 新建分析
await page.locator('button').filter({ hasText: '新建分析' }).first().click();
await page.waitForTimeout(1500);

// 填写目标
const goalInput = page.locator('textarea').first();
await goalInput.fill('分析 2025 年各地区销售表现，找出贡献最高的品类和异常月份');
await page.waitForTimeout(400);

// 生成计划
const genBtn = page.locator('button').filter({ hasText: /生成分析计划|生成计划|生成/ }).first();
if (await genBtn.count() > 0) { await genBtn.click(); } else { console.log('no gen button'); process.exit(1); }

// 等待计划生成 + 显示确认并执行按钮
let planReady = false;
for (let i = 0; i < 180; i++) {
  await page.waitForTimeout(1000);
  const txt = await page.locator('body').innerText();
  if (txt.includes('确认并执行') || txt.includes('确认执行') || txt.includes('开始执行')) { planReady = true; break; }
}
console.log('plan ready:', planReady);

// 点击执行
const execBtn = page.locator('button').filter({ hasText: /确认并执行|确认执行|开始执行/ }).first();
if (await execBtn.count() > 0) { await execBtn.click(); } else { console.log('no exec button'); process.exit(1); }

// 等待执行完成：停止分析按钮重新出现 = 完成
let done = false;
for (let i = 0; i < 600; i++) {
  await page.waitForTimeout(1000);
  const txt = await page.locator('body').innerText();
  if (txt.includes('综合报告') || txt.includes('综合分析报告') || txt.includes('总体结论') || (txt.includes('分析已完成') && txt.includes('重新执行'))) { done = true; break; }
  if (i % 30 === 0) console.log('exec wait', i, 's');
}
console.log('exec done:', done);
await page.screenshot({ path: 'lxreport1.0/ui/desktop-1440/analysis-complete.png', fullPage: true });

const results = { planReady, done };

// TC-EXPORT-002: 完整数据
const fullDataBtn = page.locator('button').filter({ hasText: '完整数据' }).first();
if (await fullDataBtn.count() > 0) {
  const [dl] = await Promise.all([ page.waitForEvent('download', { timeout: 15000 }), fullDataBtn.click() ]);
  const path = 'lxreport1.0/scenario/export/tc-export-002-full.csv';
  await dl.saveAs(path);
  const content = fs.readFileSync(path, 'utf-8');
  results.fullDataExport = { ok: true, name: dl.suggestedFilename(), size: fs.statSync(path).size, head: content.slice(0,300) };
} else {
  results.fullDataExport = { ok: false, reason: 'no full data button' };
}

// TC-PRINT-002: 打印 / PDF
const printBtn = page.locator('button').filter({ hasText: /打印|PDF/ }).first();
if (await printBtn.count() > 0) {
  const [popup] = await Promise.all([ page.waitForEvent('popup', { timeout: 10000 }), printBtn.click() ]);
  await popup.waitForTimeout(800);
  const body = await popup.locator('body').innerText();
  results.printPopup = { ok: true, title: await popup.title(), hasReportTitle: body.includes('分析报告') || body.includes('综合分析报告'), hasOverview: body.includes('总体结论') || body.includes('综合结论') };
  await popup.close();
} else {
  results.printPopup = { ok: false, reason: 'no print button' };
}

fs.writeFileSync('lxreport1.0/ui/ui-analysis-export.json', JSON.stringify(results, null, 2), 'utf-8');
await browser.close();
console.log(JSON.stringify(results, null, 2));
