import { chromium } from 'playwright-core';
import fs from 'node:fs';

const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: edgePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const result = {
  url: page.url(),
  title: await page.title(),
  inputs: await page.locator('input').evaluateAll((els) => els.map((e) => ({
    placeholder: e.placeholder, type: e.type, name: e.name, id: e.id,
  }))),
  buttons: await page.locator('button').evaluateAll((els) => els.map((e) => ({
    text: (e.innerText || '').trim().slice(0, 30),
    ariaLabel: e.getAttribute('aria-label'),
    title: e.getAttribute('title'),
  }))),
  bodyText: (await page.locator('body').innerText()).slice(0, 800),
};
await page.screenshot({ path: 'lxreport1.0/ui/desktop-1440/login.png', fullPage: true });
fs.writeFileSync('lxreport1.0/ui/probe-login.json', JSON.stringify(result, null, 2), 'utf-8');
fs.writeFileSync('lxreport1.0/ui/console-errors-login.json', JSON.stringify(logs, null, 2), 'utf-8');
await browser.close();
console.log('DONE');
