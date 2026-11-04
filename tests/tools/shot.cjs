// Screenshot of a page of the app (dev tool).
// usage: node tests/tools/shot.cjs <url> <out.png> [phone|desktop] [light|dark] [full]
// French by default; LOCALE=en-CA for English. Prints the page errors (or "no errors").
const { chromium, devices } = require('playwright');
(async () => {
  const [url, out, kind = 'phone', scheme = 'light', full] = process.argv.slice(2);
  const locale = process.env.LOCALE || 'fr-CA';
  const browser = await chromium.launch();
  const base = kind === 'phone' ? { ...devices['iPhone 13'] } : { viewport: { width: 1366, height: 860 } };
  const ctx = await browser.newContext({ ...base, colorScheme: scheme, locale });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|ERR_NAME|tile\.openstreetmap|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: out, fullPage: !!full });
  console.log(out, errors.join('\n') || 'no errors');
  await browser.close();
})();
