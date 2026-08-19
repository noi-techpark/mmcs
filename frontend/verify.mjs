import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
let errCount = 0;
page.on('console', (msg) => { if (msg.type() === 'error') errCount++; });

async function run() {
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3000);
  const checkboxes = await page.locator('input[type=checkbox]').all();
  await checkboxes[1].click();
  await checkboxes[2].click();
  await page.waitForTimeout(500);
  const rects = await page.locator('[data-testid=label-overlay] rect').all();
  const box = await rects[0].boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(1500);
}
await run();
if (errCount > 0) {
  console.log('errors, retrying once');
  errCount = 0;
  await run();
}
await page.screenshot({ path: '/home/cz/odh/open-mmc/frontend/live1.png' });
console.log('error count:', errCount);
await browser.close();
