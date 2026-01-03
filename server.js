const express = require('express');
const puppeteer = require('puppeteer');
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');

const app = express();
const PORT = process.env.PORT || 3003;

// Global browser instance
let browser = null;

// Browser configuration
const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-blink-features=AutomationControlled',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--disable-gpu',
  '--window-size=1920,1080',
  '--disable-web-security',
  '--disable-features=IsolateOrigins,site-per-process'
];

// Initialize browser on startup
async function initBrowser() {
  try {
    console.log('Launching Chrome browser...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: BROWSER_ARGS
    });
    console.log('Chrome browser launched successfully');
  } catch (error) {
    console.error('Failed to launch browser:', error);
    process.exit(1);
  }
}

// Helper function to configure a new page
async function configurePage(page) {
  // Set realistic user agent
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  // Set extra headers
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
  });

  // Override navigator properties to hide automation
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    window.chrome = { runtime: {} };
  });

  await page.setViewport({ width: 1920, height: 1080 });
}

// Helper function to scroll and load content
async function scrollAndLoad(page) {
  // Additional wait for dynamic content
  await page.waitForTimeout(3000);

  // Scroll to bottom to trigger lazy loading
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });

  // Wait a bit more after scrolling
  await page.waitForTimeout(2000);

  // Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
}

app.get('/screenshot', async (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  let page;
  try {
    page = await browser.newPage();
    await configurePage(page);

    // Load the original page to extract content
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await scrollAndLoad(page);

    // Extract readable content with Readability
    const html = await page.content();
    const baseUrl = page.url();

    const dom = new JSDOM(html, { url: baseUrl });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) {
      console.warn('Readability could not parse article, falling back to full page screenshot');
      const fullScreenshotBuffer = await page.screenshot({ fullPage: true });
      await page.close();
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', 'attachment; filename="screenshot.png"');
      return res.send(fullScreenshotBuffer);
    }

    // Create a clean HTML page with the article content
    const cleanHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${article.title || 'Article'}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.6;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
      background: #fff;
      color: #333;
    }
    h1 { font-size: 2em; margin-bottom: 0.5em; }
    .byline { color: #666; font-style: italic; margin-bottom: 1em; }
    img { max-width: 100%; height: auto; }
    p { margin: 1em 0; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>${article.title || 'Article'}</h1>
  ${article.byline ? `<div class="byline">${article.byline}</div>` : ''}
  <div class="content">
    ${article.content}
  </div>
</body>
</html>`;

    // Navigate to the clean HTML
    await page.setContent(cleanHTML, { waitUntil: 'networkidle2' });
    await page.waitForTimeout(1000);

    // Take screenshot of clean content
    const fullScreenshotBuffer = await page.screenshot({
      fullPage: true
    });

    await page.close();

    // Set response headers for binary data
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'attachment; filename="screenshot.png"');
    res.setHeader('X-Article-Title', encodeURIComponent(article.title || ''));

    // Send the binary data
    res.send(fullScreenshotBuffer);

  } catch (error) {
    console.error('Screenshot error:', error);
    if (page) await page.close();
    res.status(500).json({
      error: 'Failed to capture screenshot',
      message: error.message
    });
  }
});

app.get('/screenshot/images', async (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  let page;
  try {
    page = await browser.newPage();
    await configurePage(page);

    // Load the original page to extract content
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await scrollAndLoad(page);

    // Extract readable content with Readability
    const html = await page.content();
    const baseUrl = page.url();

    const dom = new JSDOM(html, { url: baseUrl });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) {
      console.warn('Readability could not parse article, falling back to all page images');
      const imageElements = await page.$$('body img');
      const imageBuffers = [];
      for (let i = 0; i < imageElements.length; i++) {
        try {
          const screenshotBuffer = await imageElements[i].screenshot();
          imageBuffers.push(screenshotBuffer);
        } catch (err) {
          console.error(`Failed to screenshot image ${i}:`, err.message);
        }
      }
      await page.close();

      if (imageBuffers.length === 0) {
        return res.status(404).json({ error: 'No images found on the page' });
      }

      const imagesBase64 = imageBuffers.map((buffer, index) => ({
        index: index,
        filename: `image-${index}.png`,
        mimeType: 'image/png',
        data: buffer.toString('base64')
      }));

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('X-Total-Images', imageBuffers.length.toString());
      return res.json({
        totalImages: imageBuffers.length,
        images: imagesBase64
      });
    }

    // Create a clean HTML page with the article content
    const cleanHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${article.title || 'Article'}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.6;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
      background: #fff;
      color: #333;
    }
    h1 { font-size: 2em; margin-bottom: 0.5em; }
    .byline { color: #666; font-style: italic; margin-bottom: 1em; }
    img { max-width: 100%; height: auto; }
    p { margin: 1em 0; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>${article.title || 'Article'}</h1>
  ${article.byline ? `<div class="byline">${article.byline}</div>` : ''}
  <div class="content">
    ${article.content}
  </div>
</body>
</html>`;

    // Navigate to the clean HTML
    await page.setContent(cleanHTML, { waitUntil: 'networkidle2' });
    await page.waitForTimeout(1000);

    // Get all images from the cleaned content
    const imageElements = await page.$$('body img');
    const imageBuffers = [];

    for (let i = 0; i < imageElements.length; i++) {
      try {
        const screenshotBuffer = await imageElements[i].screenshot();
        imageBuffers.push(screenshotBuffer);
      } catch (err) {
        console.error(`Failed to screenshot image ${i}:`, err.message);
      }
    }

    await page.close();

    if (imageBuffers.length === 0) {
      return res.status(404).json({ error: 'No images found in the article content' });
    }

    // Return all images as array of base64 encoded binaries
    const imagesBase64 = imageBuffers.map((buffer, index) => ({
      index: index,
      filename: `image-${index}.png`,
      mimeType: 'image/png',
      data: buffer.toString('base64')
    }));

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Total-Images', imageBuffers.length.toString());

    res.json({
      totalImages: imageBuffers.length,
      images: imagesBase64
    });

  } catch (error) {
    console.error('Screenshot error:', error);
    if (page) await page.close();
    res.status(500).json({
      error: 'Failed to capture image screenshots',
      message: error.message
    });
  }
});

// Graceful shutdown
async function shutdown() {
  console.log('\nShutting down gracefully...');
  if (browser) {
    await browser.close();
    console.log('Browser closed');
  }
  process.exit(0);
}

// Handle various shutdown signals
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);

// Start server after browser initialization
initBrowser().then(() => {
  app.listen(PORT, () => {
    console.log(`Screenshot server running on port ${PORT}`);
    console.log(`Persistent Chrome browser instance is running`);
    console.log(`Endpoints:`);
    console.log(`  GET /screenshot?url=<URL> - Takes full page screenshot in Reader Mode`);
    console.log(`  GET /screenshot/images?url=<URL> - Takes screenshots of article images in Reader Mode`);
  });
});
