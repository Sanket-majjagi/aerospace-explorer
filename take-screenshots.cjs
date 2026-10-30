const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const DIR = path.join(__dirname, 'screenshots_after');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR);
(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--window-size=1920,1080'],
    defaultViewport: { width: 1920, height: 1080 }
  });
  const page = await browser.newPage();
  await page.goto('http://localhost:3456/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: path.join(DIR, '01_intro.png') });
  await page.evaluate(() => document.getElementById('loading-screen').click());
  await new Promise(r => setTimeout(r, 5000));
  await page.screenshot({ path: path.join(DIR, '02_overview.png') });
  // Earth
  await page.evaluate(() => document.querySelectorAll('.body-item').forEach(e => { if(e.dataset.id==='earth') e.click(); }));
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: path.join(DIR, '03_earth.png') });
  // Sun
  await page.evaluate(() => document.querySelectorAll('.body-item').forEach(e => { if(e.dataset.id==='sun') e.click(); }));
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: path.join(DIR, '04_sun.png') });
  // Jupiter
  await page.evaluate(() => document.querySelectorAll('.body-item').forEach(e => { if(e.dataset.id==='jupiter') e.click(); }));
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: path.join(DIR, '05_jupiter.png') });
  // Saturn
  await page.evaluate(() => document.querySelectorAll('.body-item').forEach(e => { if(e.dataset.id==='saturn') e.click(); }));
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: path.join(DIR, '06_saturn.png') });
  // Compare
  await page.evaluate(() => document.getElementById('btn-compare')?.click());
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(DIR, '07_compare.png') });
  // Black hole
  await page.evaluate(() => document.getElementById('compare-close')?.click());
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => document.querySelectorAll('.body-item').forEach(e => { if(e.dataset.id==='blackhole') e.click(); }));
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: path.join(DIR, '08_blackhole.png') });
  console.log('Done - screenshots in', DIR);
  await browser.close();
})();
