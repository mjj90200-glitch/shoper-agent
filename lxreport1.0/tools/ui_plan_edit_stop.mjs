import { chromium } from 'playwright-core';
import fs from 'node:fs';

const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: edgePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });

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
await page.waitForTimeout(1200);

// 输入目标并生成计划
await page.locator('textarea').first().fill('分析 2025 年各地区销售表现，找出贡献最高的品类和异常月份');
await page.locator('button').filter({ hasText: /生成分析计划|生成计划/ }).first().click();

// 等待计划出现（2-6 个步骤 + 确认执行按钮）
let planReady = false;
for (let i = 0; i < 180; i++) {
  await page.waitForTimeout(1000);
  const txt = await page.locator('body').innerText();
  if (txt.includes('确认并执行') || txt.includes('确认执行')) { planReady = true; break; }
}
const results = { planReady };

if (planReady) {
  // TC-PLAN-001: 修改第一个步骤标题
  const titleInputs = page.locator('input[aria-label^="步骤"]');
  const stepCountBefore = await titleInputs.count();
  results.stepCountBefore = stepCountBefore;
  if (stepCountBefore >= 2) {
    await titleInputs.nth(0).fill('修改后的步骤标题-自动化');
    await page.waitForTimeout(500);
    const titleValue = await titleInputs.nth(0).inputValue();
    results.renameStep = titleValue === '修改后的步骤标题-自动化';
  } else {
    results.renameStep = false;
  }

  // 修改第一个步骤的查询问题
  const questionAreas = page.locator('textarea');
  if (await questionAreas.count() >= 1) {
    await questionAreas.nth(0).fill('修改后的查询：按地区统计 2025 年销售额');
    await page.waitForTimeout(500);
    const qValue = await questionAreas.nth(0).inputValue();
    results.renameQuestion = qValue.includes('修改后的查询');
  } else {
    results.renameQuestion = false;
  }

  // 添加一个步骤
  const addBtn = page.locator('button').filter({ hasText: '添加分析步骤' }).first();
  if (await addBtn.count() > 0) {
    await addBtn.click();
    await page.waitForTimeout(800);
    results.addStep = (await page.locator('input[aria-label^="步骤"]').count()) === stepCountBefore + 1;
  } else {
    results.addStep = false;
  }

  // 删除一个步骤（删除最后一个步骤）
  const delBtn = page.locator('button[aria-label="删除步骤"]').last();
  if (await delBtn.count() > 0) {
    await delBtn.click();
    await page.waitForTimeout(800);
    results.deleteStep = (await page.locator('input[aria-label^="步骤"]').count()) === stepCountBefore;
  } else {
    results.deleteStep = false;
  }

  // TC-RUN-001: 点击确认并执行，然后点停止分析
  const execBtn = page.locator('button').filter({ hasText: /确认并执行|确认执行|开始执行/ }).first();
  if (await execBtn.count() > 0) {
    await execBtn.click();
    // 等待"停止分析"按钮出现
    let stopShown = false;
    for (let i = 0; i < 120; i++) {
      await page.waitForTimeout(1000);
      const txt = await page.locator('body').innerText();
      if (txt.includes('停止分析')) { stopShown = true; break; }
    }
    results.stopButtonShown = stopShown;
    const stopBtn = page.locator('button').filter({ hasText: '停止分析' }).first();
    if (await stopBtn.count() > 0) {
      await stopBtn.click();
      await page.waitForTimeout(2000);
      const after = await page.locator('body').innerText();
      results.stopped = !after.includes('停止分析');
      results.backToReview = after.includes('分析计划待审核') || after.includes('重试失败步骤') || after.includes('确认并执行');
      results.notPermanentRunning = !after.includes('正在执行');
    } else {
      results.stopped = false;
    }
  } else {
    results.execBtn = false;
  }
} else {
  results.planReady = false;
}

results.pageErrors = pageErrors;
fs.writeFileSync('lxreport1.0/ui/ui-plan-edit-stop.json', JSON.stringify(results, null, 2), 'utf-8');
await page.screenshot({ path: 'lxreport1.0/ui/desktop-1440/plan-edit-stop.png', fullPage: false });
await browser.close();
console.log(JSON.stringify(results, null, 2));
