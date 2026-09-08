import { chromium } from 'playwright-core';
import fs from 'node:fs';

const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: edgePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE_ERR:', m.text()); });
page.on('pageerror', (e) => console.log('PAGE_ERR:', e.message));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.locator('input').nth(0).fill('admin');
await page.locator('input').nth(1).fill('admin123');
await page.getByRole('button', { name: '登录', exact: true }).click();
await page.waitForTimeout(2000);

// 点击"重命名后的会话-自动化"对应的删除按钮
const sessionRow = page.locator('button[title="删除会话"]').filter({ has: page.locator('xpath=..') });
const delBtn = page.locator('button[aria-label^="删除重命名后的会话"]').first();
console.log('delete buttons:', await page.locator('button[title="删除会话"]').count());
console.log('target delete count:', await delBtn.count());
if (await delBtn.count() > 0) {
  console.log('aria:', await delBtn.getAttribute('aria-label'));
  page.once('dialog', (d) => { console.log('DIALOG:', d.type(), d.message()); d.accept().catch(() => {}); });
  // hover 父级让按钮可见
  await delBtn.locator('xpath=..').hover();
  await page.waitForTimeout(300);
  await delBtn.click();
  console.log('clicked');
} else {
  console.log('target delete button NOT FOUND');
}
await page.waitForTimeout(1000);

// 页面状态
const body = await page.locator('body').innerText();
console.log('target still visible:', body.includes('重命名后的会话-自动化'));
console.log('---BODY TAIL---');
console.log(body.slice(-500));
console.log('---DIALOGS---');
const dialogs = await page.locator('[role="dialog"], [class*="modal"], [class*="dialog"], [class*="confirm"]').count();
console.log('dialog-ish elements:', dialogs);

// 所有可见按钮（点击后）
const btns = await page.locator('button:visible').evaluateAll((els) => els.map((e) => ({
  text: (e.innerText || '').trim().slice(0, 40),
  title: e.getAttribute('title'),
  aria: e.getAttribute('aria-label'),
})));
console.log('VISIBLE BUTTONS:', JSON.stringify(btns.slice(-15), null, 2));

// 所有输入框
const inputs = await page.locator('input:visible, textarea:visible').evaluateAll((els) => els.map((e) => ({
  placeholder: e.placeholder, value: e.value,
})));
console.log('VISIBLE INPUTS:', JSON.stringify(inputs, null, 2));

await page.screenshot({ path: 'lxreport1.0/ui/desktop-1440/delete-click-state.png', fullPage: false });
await browser.close();
