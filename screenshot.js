const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  
  // Login first
  await page.goto('http://localhost:5000', { waitUntil: 'networkidle0', timeout: 15000 });
  await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 5000 });
  await page.type('input[type="email"], input[name="email"]', 'chad1964@gmail.com');
  await page.type('input[type="password"]', 'CmeeSoon3060!');
  await page.click('button[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 });
  
  // Screenshot dashboard
  await page.screenshot({ path: '/tmp/mc-dashboard.png', fullPage: false });
  console.log('Screenshot saved to /tmp/mc-dashboard.png');
  
  await browser.close();
})().catch(e => console.error(e.message));
