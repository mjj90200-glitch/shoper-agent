import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(1500);
const out = {
  title: await page.title(),
  url: page.url(),
  text: (await page.locator("body").innerText()).slice(0, 1500),
  inputs: await page.locator("input, textarea, button").evaluateAll((els) =>
    els.map((el) => ({
      tag: el.tagName,
      type: el.getAttribute("type"),
      placeholder: el.getAttribute("placeholder"),
      text: el.textContent?.trim().slice(0, 40) ?? null,
      aria: el.getAttribute("aria-label"),
    }))
  ),
};
writeFileSync("lxreport/frontend/probe-login.txt", JSON.stringify(out, null, 2), "utf-8");
console.log(JSON.stringify(out, null, 2).slice(0, 3000));
await browser.close();
