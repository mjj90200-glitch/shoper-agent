import { chromium } from 'playwright-core';
import fs from 'node:fs';

const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: edgePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const apiCalls = [];
page.on('request', (r) => { if (r.url().includes('/api/')) apiCalls.push({ method: r.method(), url: r.url() }); });
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) console.log('API ERR', r.status(), r.request().method(), r.url()); });

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.locator('input').nth(0).fill('admin');
await page.locator('input').nth(1).fill('admin123');
await page.getByRole('button', { name: '登录', exact: true }).click();
await page.waitForTimeout(2000);

// 找到目标会话条目按钮（点击切换会话的按钮）
const sessionItemBtn = page.getByRole('button', { name: '重命名后的会话-自动化' }).first();
console.log('session item count:', await sessionItemBtn.count());
await sessionItemBtn.hover();
await page.waitForTimeout(500);

// 该条目容器内找到删除按钮（同级的 aria-label 以"删除重命名"开头）
const delBtn = page.locator('button[aria-label="删除重命名后的会话-自动化"]').first();
console.log('del btn count:', await delBtn.count());
await delBtn.click();
await page.waitForTimeout(800);

// 确认进入确认态
const confirmText = await page.locator('body').innerText();
const enteredConfirm = confirmText.includes('删除“重命名后的会话-自动化”');
console.log('entered confirm:', enteredConfirm);

// 第二步：点击红色"删除"确认按钮
const confirmDel = page.locator('button').filter({ hasText: /^删除$/ }).last();
console.log('confirm btn count:', await confirmDel.count());
if (await confirmDel.count() > 0) {
  await confirmDel.click();
  console.log('confirm clicked');
  await page.waitForTimeout(2500);
}

const body = await page.locator('body').innerText();
console.log('still visible:', body.includes('重命名后的会话-自动化'));
console.log('has notice 删除失败:', body.includes('删除失败'));
console.log('has notice 会话已删除:', body.includes('会话已删除'));
console.log('API calls:', JSON.stringify(apiCalls.filter((c) => c.method !== 'GET')));
fs.writeFileSync('lxreport1.0/ui/ui-delete-verify.json', JSON.stringify({
  enteredConfirm,
  stillVisible: body.includes('重命名后的会话-自动化'),
  noticeDeleteFailed: body.includes('删除失败'),
  noticeDeleted: body.includes('会话已删除'),
  apiCalls,
}, null, 2), 'utf-8');
await page.screenshot({ path: 'lxreport1.0/ui/desktop-1440/delete-final-state.png', fullPage: true });
await browser.close();
