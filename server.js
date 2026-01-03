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
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
  });

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
  await page.waitForTimeout(3000);

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

  await page.waitForTimeout(2000);
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

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await scrollAndLoad(page);

    // Remove popups/modals first (before loading Readability)
    await page.evaluate(() => {
      document.querySelectorAll('[class*="modal"], [class*="popup"], [class*="overlay"], [class*="cookie"], [role="dialog"]').forEach(el => el.remove());
      document.querySelectorAll('*').forEach(el => {
        const style = window.getComputedStyle(el);
        if ((style.position === 'fixed' || style.position === 'sticky') && parseInt(style.zIndex || 0) > 1000) {
          el.remove();
        }
      });
    });

    // Inject Readability directly from local file
    await page.addScriptTag({ content: READABILITY_JS });

    // Apply Readability
    const articleParsed = await page.evaluate(() => {
      if (typeof Readability === 'undefined') {
        return { success: false };
      }

      // Parse with Readability
      const documentClone = document.cloneNode(true);
      const reader = new Readability(documentClone);
      const article = reader.parse();

      if (!article) {
        return { success: false };
      }

      // Replace entire body with clean article HTML
      document.body.innerHTML = `
        <div style="max-width: 800px; margin: 0 auto; padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; background: #fff; color: #333;">
          <h1 style="font-size: 2em; margin-bottom: 0.5em;">${article.title}</h1>
          ${article.byline ? `<div style="color: #666; font-style: italic; margin-bottom: 1em;">${article.byline}</div>` : ''}
          <div style="font-size: 1.1em;">
            ${article.content}
          </div>
        </div>
      `;

      // Fix lazy-loaded images and style them
      document.querySelectorAll('img').forEach(img => {
        // Try to find the real image source from various attributes
        const possibleSrc = img.src && !img.src.includes('data:') && !img.src.includes('placeholder') ? img.src :
                          img.getAttribute('data-src') ||
                          img.getAttribute('data-lazy-src') ||
                          img.getAttribute('data-original') ||
                          img.getAttribute('data-srcset')?.split(' ')[0] ||
                          img.getAttribute('srcset')?.split(' ')[0];

        if (possibleSrc && possibleSrc !== img.src) {
          img.src = possibleSrc;
          // Force image to load
          img.loading = 'eager';
        }

        // Remove lazy loading attributes
        img.removeAttribute('loading');
        img.removeAttribute('data-src');
        img.removeAttribute('data-lazy-src');
        img.removeAttribute('data-original');

        // Style images
        img.style.cssText = 'max-width: 100% !important; height: auto !important; display: block !important; margin: 1em auto !important;';
      });

      document.querySelectorAll('p').forEach(p => {
        p.style.margin = '1em 0';
      });

      return { success: true };
    });

    if (!articleParsed.success) {
      await page.close();
      return res.status(500).json({ error: 'Failed to parse article with Readability' });
    }

    // Wait for images to load
    await page.waitForTimeout(3000);

    // Wait for all images to actually load
    await page.evaluate(() => {
      return Promise.all(
        Array.from(document.images)
          .filter(img => !img.complete)
          .map(img => new Promise(resolve => {
            img.onload = img.onerror = resolve;
          }))
      );
    });

    await page.waitForTimeout(1000);

    const screenshot = await page.screenshot({ fullPage: true });
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

app.get('/screenshot/images', async (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  let page;
  try {
    page = await browser.newPage();
    await configurePage(page);

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await scrollAndLoad(page);

    // Remove popups first
    await page.evaluate(() => {
      document.querySelectorAll('[class*="modal"], [class*="popup"], [class*="overlay"], [class*="cookie"], [role="dialog"]').forEach(el => el.remove());
      document.querySelectorAll('*').forEach(el => {
        const style = window.getComputedStyle(el);
        if ((style.position === 'fixed' || style.position === 'sticky') && parseInt(style.zIndex || 0) > 1000) {
          el.remove();
        }
      });
    });

    // Inject Readability directly from local file
    await page.addScriptTag({ content: READABILITY_JS });

    // Get article images
    const imageInfo = await page.evaluate(() => {
      if (typeof Readability === 'undefined') {
        return { success: false, images: [] };
      }

      const documentClone = document.cloneNode(true);
      const reader = new Readability(documentClone);
      const article = reader.parse();

      if (!article) {
        return { success: false, images: [] };
      }

      // Create temp div to parse article HTML
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = article.content;

      const images = Array.from(tempDiv.querySelectorAll('img'));

      // Fix lazy-loaded images
      images.forEach(img => {
        if (!img.src || img.src.includes('data:image')) {
          const possibleSrc = img.getAttribute('data-src') ||
                            img.getAttribute('data-lazy-src') ||
                            img.getAttribute('data-original') ||
                            img.getAttribute('data-srcset')?.split(' ')[0];
          if (possibleSrc) {
            img.src = possibleSrc;
          }
        }
      });

      const contentImages = images.filter(img => {
        const src = img.src || img.getAttribute('data-src') || '';
        if (!src || src.includes('data:image')) return false;

        const w = img.naturalWidth || img.width || parseInt(img.getAttribute('width')) || 0;
        const h = img.naturalHeight || img.height || parseInt(img.getAttribute('height')) || 0;
        return w >= 200 && h >= 100;
      });

      return {
        success: true,
        images: contentImages.map((img, idx) => ({
          index: idx,
          src: img.src || img.getAttribute('data-src') || '',
          alt: img.alt || '',
          width: img.naturalWidth || img.width || parseInt(img.getAttribute('width')) || 0,
          height: img.naturalHeight || img.height || parseInt(img.getAttribute('height')) || 0
        }))
      };
    });

    if (!imageInfo.success || imageInfo.images.length === 0) {
      await page.close();
      return res.status(404).json({ error: 'No images found in article' });
    }

    const imageBuffers = [];
    for (let i = 0; i < imageInfo.images.length; i++) {
      try {
        const imgEl = await page.$(`img[src="${imageInfo.images[i].src}"]`);
        if (imgEl) {
          const buffer = await imgEl.screenshot();
          imageBuffers.push({
            buffer,
            info: imageInfo.images[i]
          });
        }
      } catch (err) {
        console.error(`Failed to screenshot image ${i}:`, err.message);
      }
    }

    await page.close();

    const imagesBase64 = imageBuffers.map((item, index) => ({
      index,
      filename: `image-${index}.png`,
      mimeType: 'image/png',
      data: item.buffer.toString('base64'),
      src: item.info.src || '',
      alt: item.info.alt || '',
      width: item.info.width || 0,
      height: item.info.height || 0
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
