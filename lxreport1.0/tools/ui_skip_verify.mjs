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

// 切到数据分析，打开"2025年各地区销售表现分析"（error 状态）
await page.locator('button, a, [role="tab"]').filter({ hasText: '数据分析' }).first().click();
await page.waitForTimeout(1500);

// 点击标题为"2025年各地区销售表现分析"的项目
const projectBtn = page.locator('button').filter({ hasText: '2025年各地区销售表现分析' }).first();
console.log('project button count:', await projectBtn.count());
if (await projectBtn.count() > 0) {
  await projectBtn.click();
  await page.waitForTimeout(1500);
}

const body = await page.locator('body').innerText();
console.log('has error:', body.includes('Can'));
console.log('has 单独重试:', body.includes('单独重试'));
console.log('has 跳过:', body.includes('跳过'));

const results = {
  openedErrorProject: body.includes('Can'),
  retryBtnVisible: body.includes('单独重试'),
  skipBtnVisible: body.includes('跳过'),
};

// 点击第一个"跳过"
const skipBtn = page.locator('button').filter({ hasText: '跳过' }).first();
if (await skipBtn.count() > 0) {
  await skipBtn.click();
  await page.waitForTimeout(2500);
  const after = await page.locator('body').innerText();
  results.skipClicked = true;
  // 检查是否有"综合报告"或"重新执行"（跳过全部失败后）
  results.afterSkipHasReport = after.includes('综合分析报告') || after.includes('综合报告');
  results.afterSkipHasRerun = after.includes('重新执行');
  // 检查错误信息是否减少（跳过了一步）
  results.errorCountBefore = (body.match(/Can't connect/g) || []).length;
  results.errorCountAfter = (after.match(/Can't connect/g) || []).length;
} else {
  results.skipClicked = false;
}

fs.writeFileSync('lxreport1.0/ui/ui-skip-verify.json', JSON.stringify(results, null, 2), 'utf-8');
await page.screenshot({ path: 'lxreport1.0/ui/desktop-1440/skip-verify.png', fullPage: false });
await browser.close();
console.log(JSON.stringify(results, null, 2));
