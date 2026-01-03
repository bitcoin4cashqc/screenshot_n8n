const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3003;

// Read Readability.js once at startup
const READABILITY_JS = fs.readFileSync(path.join(__dirname, 'readability.js'), 'utf8');

// Global browser instance
let browser = null;

const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-blink-features=AutomationControlled',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--window-size=1920,1080'
];

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

async function configurePage(page) {
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1920, height: 1080 });
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

    // Load page
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for content
    await page.waitForTimeout(2000);

    // Inject Readability
    await page.addScriptTag({ content: READABILITY_JS });

    // Parse article and render reader view (following the Gist pattern)
    await page.evaluate(() => {
      // Parse article using Readability
      const documentClone = document.cloneNode(true);
      const article = new Readability(documentClone).parse();

      if (!article) {
        return;
      }

      // Replace body with clean reader view
      document.body.innerHTML = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
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
            h1 {
              font-size: 2.5em;
              margin-bottom: 0.3em;
              line-height: 1.2;
            }
            .byline {
              color: #666;
              font-style: italic;
              margin-bottom: 1.5em;
              font-size: 0.95em;
            }
            .content {
              font-size: 1.1em;
            }
            .content p {
              margin: 1.2em 0;
            }
            .content img {
              max-width: 100%;
              height: auto;
              display: block;
              margin: 1.5em auto;
            }
            .content h2 {
              margin-top: 1.5em;
              margin-bottom: 0.5em;
            }
            .content ul, .content ol {
              margin: 1em 0;
              padding-left: 2em;
            }
            .content blockquote {
              border-left: 3px solid #ddd;
              margin: 1.5em 0;
              padding-left: 1em;
              color: #666;
            }
          </style>
        </head>
        <body>
          <h1>${article.title}</h1>
          ${article.byline ? `<div class="byline">${article.byline}</div>` : ''}
          <div class="content">
            ${article.content}
          </div>
        </body>
        </html>
      `;
    });

    // Wait for images to load
    await page.waitForTimeout(2000);

    // Take screenshot
    const screenshot = await page.screenshot({
      fullPage: true,
      type: 'png'
    });

    await page.close();

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'attachment; filename="screenshot.png"');
    res.send(screenshot);

  } catch (error) {
    console.error('Screenshot error:', error);
    if (page) await page.close();
    res.status(500).json({
      error: 'Failed to capture screenshot',
      message: error.message
    });
  }
});

async function shutdown() {
  console.log('\nShutting down gracefully...');
  if (browser) {
    await browser.close();
    console.log('Browser closed');
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);

initBrowser().then(() => {
  app.listen(PORT, () => {
    console.log(`Screenshot server running on port ${PORT}`);
    console.log(`Endpoint: GET /screenshot?url=<URL>`);
  });
});
