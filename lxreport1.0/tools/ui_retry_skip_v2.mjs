import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

// 先停 MySQL，制造步骤执行失败
try { execSync('docker stop mysql 2>&1', { shell: 'cmd' }); } catch {}

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

await page.locator('button, a, [role="tab"]').filter({ hasText: '数据分析' }).first().click();
await page.waitForTimeout(1200);
await page.locator('button').filter({ hasText: '新建分析' }).first().click();
await page.waitForTimeout(1200);
await page.locator('textarea').first().fill('分析 2025 年各地区销售表现');
await page.locator('button').filter({ hasText: /生成分析计划|生成计划/ }).first().click();

let planReady = false;
for (let i = 0; i < 180; i++) {
  await page.waitForTimeout(1000);
  const txt = await page.locator('body').innerText();
  if (txt.includes('确认并执行') || txt.includes('确认执行')) { planReady = true; break; }
}
const results = { planReady };

if (planReady) {
  // 执行计划（MySQL 已停，步骤应失败）
  const execBtn = page.locator('button').filter({ hasText: /确认并执行|确认执行|开始执行/ }).first();
  await execBtn.click();

  // 等待失败提示（单独重试/跳过出现）
  let failed = false;
  for (let i = 0; i < 180; i++) {
    await page.waitForTimeout(1000);
    const txt = await page.locator('body').innerText();
    if (txt.includes('单独重试') || txt.includes('跳过')) { failed = true; break; }
  }
  results.stepFailed = failed;
  await page.screenshot({ path: 'lxreport1.0/ui/desktop-1440/step-failed.png', fullPage: false });

  if (failed) {
    // 记录失败步骤错误信息
    const bodyText = await page.locator('body').innerText();
    const errIdx = bodyText.indexOf('Can');
    results.errorSnippet = errIdx >= 0 ? bodyText.slice(errIdx, errIdx + 120) : null;

    // TC-RUN-003: 点击跳过
    const skipBtn = page.locator('button').filter({ hasText: '跳过' }).first();
    if (await skipBtn.count() > 0) {
      await skipBtn.click();
      await page.waitForTimeout(2000);
      const afterSkip = await page.locator('body').innerText();
      results.skipClicked = true;
      results.skipWorked = !afterSkip.includes('单独重试') || afterSkip.includes('综合报告') || afterSkip.includes('分析已完成');
    } else {
      results.skipClicked = false;
    }
  }
} else {
  results.stepFailed = false;
}

results.pageErrors = pageErrors;
fs.writeFileSync('lxreport1.0/ui/ui-retry-skip.json', JSON.stringify(results, null, 2), 'utf-8');
await page.screenshot({ path: 'lxreport1.0/ui/desktop-1440/retry-skip-final.png', fullPage: false });
await browser.close();
console.log(JSON.stringify(results, null, 2));
