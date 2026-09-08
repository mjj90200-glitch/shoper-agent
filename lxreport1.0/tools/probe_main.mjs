import { chromium } from 'playwright-core';
import fs from 'node:fs';

const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: edgePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));

// 登录
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.locator('input').nth(0).fill('admin');
await page.locator('input').nth(1).fill('admin123');
await page.getByRole('button', { name: '登录', exact: true }).click();
await page.waitForTimeout(2000);

// 全量按钮 + 可交互元素探测
const allButtons = await page.locator('button').evaluateAll((els) => els.map((e) => ({
  text: (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 50),
  title: e.getAttribute('title'),
  aria: e.getAttribute('aria-label'),
}))).catch(() => []);

// 是否有重命名/删除控件
const bodyText = await page.locator('body').innerText();
const hasRename = bodyText.includes('重命名');
const hasDelete = bodyText.includes('删除');

// 检查 hover 后是否出现删除（侧边会话条目）
const sessionItems = page.locator('[class*="session"], [class*="conversation"], li').count();
const hoverResult = {};
try {
  const firstItem = page.locator('button, div').filter({ hasText: /统计华北地区的销售总额/ }).first();
  if (await firstItem.count() > 0) {
    await firstItem.hover();
    await page.waitForTimeout(800);
    const afterHover = await page.locator('body').innerText();
    hoverResult.afterHoverHasDelete = afterHover.includes('删除');
    hoverResult.afterHoverHasRename = afterHover.includes('重命名');
    await page.screenshot({ path: 'lxreport1.0/ui/desktop-1440/hover-session.png', fullPage: false });
  } else {
    hoverResult.afterHoverHasDelete = false;
    hoverResult.afterHoverHasRename = false;
  }
} catch (e) {
  hoverResult.error = String(e);
}

fs.writeFileSync('lxreport1.0/ui/probe-main.json', JSON.stringify({
  allButtons,
  hasRename, hasDelete,
  sessionItems,
  hoverResult,
  consoleErrors,
}, null, 2), 'utf-8');
await browser.close();
console.log('DONE');
