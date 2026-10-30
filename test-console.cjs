const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu']
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push('PAGE: ' + err.message));
  page.on('response', res => { if (res.status() >= 400) errors.push(res.url() + ' -> ' + res.status()); });
  try {
    await page.goto('http://localhost:3456/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise(r => setTimeout(r, 6000));
  } catch(e) { errors.push('NAV: ' + e.message); }
  console.log('ERRORS:', errors.length);
  errors.forEach(e => console.log('  ❌', e));
  if (!errors.length) console.log('✅ ZERO ERRORS');
  await browser.close();
})();
