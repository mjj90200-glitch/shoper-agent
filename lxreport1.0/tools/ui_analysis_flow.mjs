import { chromium } from 'playwright-core';
import fs from 'node:fs';

const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: edgePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
const apiCalls = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));
page.on('request', (r) => { if (r.url().includes('/api/')) apiCalls.push({ method: r.method(), url: r.url() }); });

const results = {};

// 登录
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.locator('input').nth(0).fill('admin');
await page.locator('input').nth(1).fill('admin123');
await page.getByRole('button', { name: '登录', exact: true }).click();
await page.waitForTimeout(2000);

// 切到数据分析
await page.getByRole('button', { name: '数据分析', exact: true }).click();
await page.waitForTimeout(1200);

// 新建分析项目
const newBtn = page.locator('button').filter({ hasText: '新建分析' }).first();
await newBtn.click();
await page.waitForTimeout(1500);
let body = await page.locator('body').innerText();
results.enteredNewProject = body.includes('分析项目') && (body.includes('目标') || body.includes('分析计划') || body.includes('新建'));
results.newProjectBodyHead = body.slice(0, 600);
await page.screenshot({ path: 'lxreport1.0/ui/desktop-1440/analysis-new.png', fullPage: false });

// 输入目标
const goalInput = page.locator('textarea').first();
const goal = '分析 2025 年各地区销售表现，找出贡献最高的品类和异常月份';
results.goalInputCount = await goalInput.count();
if (await goalInput.count() > 0) {
  await goalInput.click();
  await goalInput.fill(goal);
  await page.waitForTimeout(400);
  // 找"生成分析计划"按钮
  const genBtn = page.locator('button').filter({ hasText: /生成分析计划|生成计划|生成/ }).first();
  results.genBtnCount = await genBtn.count();
  if (await genBtn.count() > 0) {
    await genBtn.click();
    results.genClicked = true;
    await page.waitForTimeout(3000);
  } else {
    results.genClicked = false;
  }
} else {
  results.goalInputCount = 0;
}

// 等待计划生成完成（最多 60 秒）
let planGenerated = false;
let planText = '';
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000);
  planText = await page.locator('body').innerText();
  if (planText.includes('确认并执行') || planText.includes('确认执行') || planText.includes('执行计划')) {
    planGenerated = true;
    break;
  }
  if (planText.includes('生成中') || planText.includes('生成分析计划')) continue;
}
results.planGenerated = planGenerated;
results.planHasSteps = (planText.match(/步骤/g) || []).length;
await page.screenshot({ path: 'lxreport1.0/ui/desktop-1440/analysis-plan.png', fullPage: true });

// 确认并执行
if (planGenerated) {
  const execBtn = page.locator('button').filter({ hasText: /确认并执行|确认执行|开始执行/ }).first();
  results.execBtnCount = await execBtn.count();
  if (await execBtn.count() > 0) {
    await execBtn.click();
    results.execClicked = true;
  } else {
    results.execClicked = false;
  }
}

// 等待执行完成（SSE 多步骤，最多 4 分钟）
let execDone = false;
let finalText = '';
for (let i = 0; i < 240; i++) {
  await page.waitForTimeout(1000);
  finalText = await page.locator('body').innerText();
  if (finalText.includes('综合分析报告') || finalText.includes('综合报告') || finalText.includes('总体结论')) {
    execDone = true;
    break;
  }
  if (i % 30 === 0) console.log('exec wait', i, 's');
}
results.execDone = execDone;
results.finalTextHead = finalText.slice(0, 2000);
results.apiCalls = apiCalls.filter((c) => c.method !== 'GET');
results.consoleErrors = consoleErrors;
fs.writeFileSync('lxreport1.0/ui/ui-analysis-flow.json', JSON.stringify(results, null, 2), 'utf-8');
await page.screenshot({ path: 'lxreport1.0/ui/desktop-1440/analysis-report.png', fullPage: true });
await browser.close();
console.log(JSON.stringify(results, null, 2));
