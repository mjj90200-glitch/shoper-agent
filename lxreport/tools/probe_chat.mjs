import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(1000);
await page.locator("input").first().fill("admin");
await page.locator('input[type="password"]').fill("admin123");
await page.getByRole("button", { name: "登录", exact: true }).click();
await page.waitForTimeout(2500);
const out = {
  url: page.url(),
  text: (await page.locator("body").innerText()).slice(0, 2500),
  inputs: await page.locator("input, textarea, button").evaluateAll((els) =>
    els.map((el) => ({
      tag: el.tagName,
      type: el.getAttribute("type"),
      placeholder: el.getAttribute("placeholder"),
      text: el.textContent?.trim().slice(0, 60) ?? null,
      aria: el.getAttribute("aria-label"),
    }))
  ),
};
writeFileSync("lxreport/frontend/probe-chat.txt", JSON.stringify(out, null, 2), "utf-8");
console.log(JSON.stringify(out, null, 2).slice(0, 4000));
await browser.close();
