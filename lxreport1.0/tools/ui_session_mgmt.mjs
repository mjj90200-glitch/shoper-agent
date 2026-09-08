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
await page.waitForTimeout(1000);
await page.locator('input').nth(0).fill('admin');
await page.locator('input').nth(1).fill('admin123');
await page.getByRole('button', { name: '登录', exact: true }).click();
await page.waitForTimeout(2000);

// 找到第一个历史会话的重命名按钮（"统计华北地区的销售总额" 09:59 那条）
const renameBtn = page.locator('button[title="重命名"]').first();
if (await renameBtn.count() > 0) {
  await renameBtn.click();
  await page.waitForTimeout(800);
  // 可能出现输入框或 prompt
  const dialog = page.locator('input, textarea').last();
  if (await dialog.count() > 0) {
    await dialog.fill('重命名后的会话-自动化');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1200);
    results.renameDone = true;
  } else {
    results.renameDone = false;
    results.renameReason = 'no input appeared';
  }
  const body = await page.locator('body').innerText();
  results.renameVisible = body.includes('重命名后的会话-自动化');
  await page.screenshot({ path: 'lxreport1.0/ui/desktop-1440/session-renamed.png', fullPage: false });
} else {
  results.renameDone = false;
  results.renameVisible = false;
}

// 刷新确认重命名持久化
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
const bodyAfterReload = await page.locator('body').innerText();
results.renamePersisted = bodyAfterReload.includes('重命名后的会话-自动化');

// 删除会话：先记录目标会话名（第二个删除按钮对应第一个历史会话）
const targetBtn = page.locator('button[title="删除会话"]').nth(1);
let targetName = '';
if (await targetBtn.count() > 0) {
  targetName = (await targetBtn.getAttribute('aria-label') || '').replace('删除', '');
}
const bodyBeforeDelete = await page.locator('body').innerText();
results.deleteTarget = targetName;
results.targetExistsBefore = targetName ? bodyBeforeDelete.includes(targetName) : false;

const deleteBtn = page.locator('button[title="删除会话"]').nth(1);
if (await deleteBtn.count() > 0) {
  const aria = await deleteBtn.getAttribute('aria-label');
  results.deleteTargetAria = aria;
  await deleteBtn.click();
  await page.waitForTimeout(800);
  // 捕获原生 confirm
  let dialogSeen = null;
  page.once('dialog', async (d) => { dialogSeen = d.type(); await d.accept(); });
  await page.waitForTimeout(1200);
  const bodyAfter = await page.locator('body').innerText();
  results.dialogSeen = dialogSeen;
  results.deleteUiWorked = targetName ? !bodyAfter.includes(targetName) : false;
  results.deleteTargetRemoved = targetName ? !bodyAfter.includes(targetName) : false;
  await page.screenshot({ path: 'lxreport1.0/ui/desktop-1440/session-deleted.png', fullPage: false });
} else {
  results.deleteUiWorked = false;
}

results.consoleErrors = consoleErrors;
fs.writeFileSync('lxreport1.0/ui/ui-session-mgmt.json', JSON.stringify(results, null, 2), 'utf-8');
await browser.close();
console.log(JSON.stringify(results, null, 2));
