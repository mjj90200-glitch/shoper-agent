import { chromium } from 'playwright-core';

const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: edgePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.locator('input').nth(0).fill('admin');
await page.locator('input').nth(1).fill('admin123');
await page.getByRole('button', { name: '登录', exact: true }).click();
await page.waitForTimeout(2000);

// 新建会话并发问数
await page.locator('button').filter({ hasText: '新问数' }).first().click();
await page.waitForTimeout(800);
await page.locator('textarea').first().fill('按会员等级统计销售额和订单数');
await page.locator('textarea').first().press('Enter');

let ready = false;
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(1000);
  const txt = await page.locator('body').innerText();
  if (txt.includes('就绪') && txt.includes('查询结果')) { ready = true; break; }
}
console.log('ready:', ready);

// 搜索 CSV 文本
const csvTexts = await page.locator('text=CSV').count();
console.log('text=CSV count:', csvTexts);
const csvButtons = await page.locator('button').filter({ hasText: 'CSV' }).count();
console.log('buttons with CSV:', csvButtons);

// 列出所有按钮文本
const allBtnTexts = await page.locator('button').evaluateAll((els) => els.map((e) => (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 30)).filter(Boolean));
console.log('buttons:', JSON.stringify(allBtnTexts.slice(-20)));

// body 尾部
const body = await page.locator('body').innerText();
console.log('has 查询结果:', body.includes('查询结果'));
console.log('has 会员等级:', body.includes('会员等级'));
console.log('body tail:', body.slice(-900));

await browser.close();
