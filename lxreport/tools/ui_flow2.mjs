import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const shots = "lxreport/frontend";
const out = {};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(1000);
await page.locator("input").first().fill("admin");
await page.locator('input[type="password"]').fill("admin123");
await page.getByRole("button", { name: "登录", exact: true }).click();
await page.waitForTimeout(2500);

await page.getByRole("button", { name: "历史", exact: true }).click();
await page.waitForTimeout(1800);
const dialog = page.getByRole("dialog", { name: /历史|会话/i }).or(page.locator("body"));
out.dialog_buttons = await page
  .locator("button")
  .evaluateAll((els) => els.map((el) => (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 60)).filter(Boolean));
await page.screenshot({ path: `${shots}/c1-history-panel2.png` });

// 找历史会话条目按钮（对话框内文本匹配会话标题）
const items = page.locator("button").filter({ hasText: /统计华东地区 2025 年第一季度销售额/ });
out.item_count = await items.count();
if (await items.count()) {
  await items.last().click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${shots}/c1-session-detail2.png` });
  out.detail_tail = (await page.locator("body").innerText()).slice(-1500);
  out.detail_buttons = await page
    .locator("button")
    .evaluateAll((els) => els.map((el) => (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 40)).filter(Boolean));

  // 尝试删除当前会话（对话框内按钮文本含“删除”）
  const del = page.locator("button").filter({ hasText: "删除" });
  out.delete_buttons = await del.count();
  if (await del.count()) {
    await del.first().click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${shots}/c1-delete-confirm.png` });
    out.after_delete_tail = (await page.locator("body").innerText()).slice(-1000);
  }
}

writeFileSync("lxreport/frontend/ui-results2.json", JSON.stringify(out, null, 2), "utf-8");
console.log(JSON.stringify(out, null, 2));
await browser.close();
