import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(800);
await page.locator("input").first().fill("admin");
await page.locator('input[type="password"]').fill("admin123");
await page.getByRole("button", { name: "登录", exact: true }).click();
await page.waitForTimeout(2000);
await page.getByRole("button", { name: "历史", exact: true }).click();
await page.waitForTimeout(1500);

const before = await page.locator("[aria-label]").evaluateAll((els) =>
  els.map((e) => e.getAttribute("aria-label")).filter(Boolean)
);
const item = page.locator("button").filter({ hasText: "华东华北对比分析-改名测试" }).last();
await item.hover();
await page.waitForTimeout(1000);
const after = await page.locator("[aria-label]").evaluateAll((els) =>
  els.map((e) => e.getAttribute("aria-label")).filter(Boolean)
);
writeFileSync(
  "lxreport/frontend/hover-labels.json",
  JSON.stringify({ before, after }, null, 2),
  "utf-8"
);
await page.screenshot({ path: "lxreport/frontend/c1-history-hover.png" });
console.log(JSON.stringify({ before, after }, null, 2));
await browser.close();
