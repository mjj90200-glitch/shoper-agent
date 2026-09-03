import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const shots = "lxreport/frontend";
const results = {};

async function shot(page, name) {
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
}

async function reset(page) {
  await page.reload({ waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1500);
}

async function login(page, user, pass) {
  await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.locator("input").first().fill(user);
  await page.locator('input[type="password"]').fill(pass);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForTimeout(2500);
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

// ---------- admin 登录 + 问数 ----------
await login(page, "admin", "admin123");
await shot(page, "c0-admin-main");
await page.getByPlaceholder("问一个电商数据问题...").fill("统计华东地区 2025 年第一季度销售额");
await page.getByRole("button", { name: "发送" }).click();
try {
  await page.getByText("结果解读", { exact: false }).first().waitFor({ timeout: 240000 });
  results.query_result = "出现结果解读";
} catch {
  results.query_result = "未在 240s 内看到结果解读";
}
await page.waitForTimeout(2000);
await shot(page, "c1-query-result");
results.result_tail = (await page.locator("body").innerText()).slice(-1200);

// ---------- C1 历史面板 ----------
await page.getByRole("button", { name: "历史", exact: true }).click();
await page.waitForTimeout(1500);
await shot(page, "c1-history-panel");
results.history_tail = (await page.locator("body").innerText()).slice(-1800);

const sessionItems = page.locator('div[role="dialog"] button, aside button').filter({
  hasText: /统计华东|华东华北对比分析|按大区/,
});
results.session_items = await sessionItems.count();
if (await sessionItems.count()) {
  await sessionItems.first().click();
  await page.waitForTimeout(1800);
  await shot(page, "c1-session-detail");
  results.session_detail_tail = (await page.locator("body").innerText()).slice(-1600);
}
await reset(page);

// ---------- C2 管理员质量指标 ----------
await page.getByRole("button", { name: "查询审计" }).click();
await page.waitForTimeout(2500);
await shot(page, "c2-quality-admin");
results.audit_admin_tail = (await page.locator("body").innerText()).slice(-1800);
await reset(page);

// ---------- C2 窄屏 ----------
await page.setViewportSize({ width: 420, height: 900 });
await page.waitForTimeout(1000);
await shot(page, "c2-narrow-main");
await page.getByRole("button", { name: "查询审计" }).click();
await page.waitForTimeout(2000);
await shot(page, "c2-narrow-audit");
results.narrow_tail = (await page.locator("body").innerText()).slice(-1200);
await reset(page);
await page.setViewportSize({ width: 1280, height: 800 });

// ---------- C2 analyst 视角 ----------
const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page2 = await ctx2.newPage();
await login(page2, "analyst", "analyst123");
await page2.getByRole("button", { name: "查询审计" }).click();
await page2.waitForTimeout(2000);
await shot(page2, "c2-quality-analyst");
results.audit_analyst_tail = (await page2.locator("body").innerText()).slice(-1600);

writeFileSync("lxreport/frontend/ui-results.json", JSON.stringify(results, null, 2), "utf-8");
console.log(JSON.stringify(results, null, 2));
await browser.close();
