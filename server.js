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
  '--disable-accelerated-2d-canvas',
  '--disable-gpu',
  '--window-size=1920,1080',
  '--disable-web-security',
  '--disable-features=IsolateOrigins,site-per-process'
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

    // Remove popups/modals first
    await page.evaluate(() => {
      document.querySelectorAll('[class*="modal"], [class*="popup"], [class*="overlay"], [class*="cookie"], [role="dialog"]').forEach(el => el.remove());
      document.querySelectorAll('*').forEach(el => {
        const style = window.getComputedStyle(el);
        if ((style.position === 'fixed' || style.position === 'sticky') && parseInt(style.zIndex || 0) > 1000) {
          el.remove();
        }
      });
    });

    // Inject Readability
    await page.addScriptTag({ content: READABILITY_JS });

    // Apply reader mode - DON'T replace innerHTML, just hide non-article content
    const articleFound = await page.evaluate(() => {
      if (typeof Readability === 'undefined') {
        return false;
      }

      // Parse with Readability using CLONED document (don't modify original)
      const documentClone = document.cloneNode(true);
      const reader = new Readability(documentClone);
      const article = reader.parse();

      if (!article) {
        return false;
      }

      // Find the article element in the ACTUAL DOM (not the clone)
      // We'll use a simple heuristic: find the element with most paragraph text
      let articleElement = null;
      let maxTextLength = 0;

      document.querySelectorAll('article, main, [role="main"], div').forEach(el => {
        const paragraphs = el.querySelectorAll('p');
        const textLength = Array.from(paragraphs).reduce((sum, p) => sum + (p.textContent?.length || 0), 0);

        if (textLength > maxTextLength && textLength > 200) {
          maxTextLength = textLength;
          articleElement = el;
        }
      });

      if (!articleElement) {
        return false;
      }

      // Hide EVERYTHING except the article
      document.body.style.cssText = 'margin: 0 !important; padding: 40px 20px !important; background: #fff !important; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important; line-height: 1.6 !important; color: #333 !important;';

      // Hide all top-level body children except the one containing the article
      Array.from(document.body.children).forEach(child => {
        if (!child.contains(articleElement) && child !== articleElement) {
          child.style.display = 'none';
        }
      });

      // Create wrapper for article
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'max-width: 800px !important; margin: 0 auto !important; padding: 0 !important;';

      // Add title from Readability
      const title = document.createElement('h1');
      title.textContent = article.title;
      title.style.cssText = 'font-size: 2em; margin-bottom: 0.5em; color: #333;';
      wrapper.appendChild(title);

      // Add byline if available
      if (article.byline) {
        const byline = document.createElement('div');
        byline.textContent = article.byline;
        byline.style.cssText = 'color: #666; font-style: italic; margin-bottom: 1em;';
        wrapper.appendChild(byline);
      }

      // Move article element into wrapper
      const articleParent = articleElement.parentNode;
      articleParent.insertBefore(wrapper, articleElement);
      wrapper.appendChild(articleElement);

      // Style the article content
      articleElement.style.cssText = 'background: transparent !important; max-width: 100% !important;';

      // Remove unwanted elements from WITHIN the article
      articleElement.querySelectorAll('nav, header, footer, aside, [role="navigation"], [role="banner"], [class*="related"], [class*="comment"], [class*="social"], [class*="share"], [class*="newsletter"]').forEach(el => el.remove());

      // Style images - DON'T change src, just style them
      articleElement.querySelectorAll('img').forEach(img => {
        img.style.cssText = 'max-width: 100% !important; height: auto !important; display: block !important; margin: 1em auto !important;';
      });

      // Style paragraphs
      articleElement.querySelectorAll('p').forEach(p => {
        p.style.cssText = 'margin: 1em 0; font-size: 1.1em;';
      });

      return true;
    });

    if (!articleFound) {
      console.warn('Could not parse article with Readability');
    }

    // Wait for any remaining images to load
    await page.waitForTimeout(2000);

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

    await page.evaluate(() => {
      document.querySelectorAll('[class*="modal"], [class*="popup"], [role="dialog"]').forEach(el => el.remove());
    });

    await page.addScriptTag({ content: READABILITY_JS });

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

      // Find article element in actual DOM
      let articleElement = null;
      let maxTextLength = 0;

      document.querySelectorAll('article, main, [role="main"], div').forEach(el => {
        const paragraphs = el.querySelectorAll('p');
        const textLength = Array.from(paragraphs).reduce((sum, p) => sum + (p.textContent?.length || 0), 0);

        if (textLength > maxTextLength && textLength > 200) {
          maxTextLength = textLength;
          articleElement = el;
        }
      });

      if (!articleElement) {
        return { success: false, images: [] };
      }

      // Get images from the ACTUAL article element in DOM
      const images = Array.from(articleElement.querySelectorAll('img')).filter(img => {
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        return w >= 200 && h >= 100;
      });

      return {
        success: true,
        images: images.map((img, idx) => ({
          index: idx,
          src: img.src,
          alt: img.alt || '',
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height
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
    console.log(`Persistent Chrome browser instance is running`);
    console.log(`Endpoints:`);
    console.log(`  GET /screenshot?url=<URL> - Takes full page screenshot in Reader Mode`);
    console.log(`  GET /screenshot/images?url=<URL> - Takes screenshots of article images in Reader Mode`);
  });
});
