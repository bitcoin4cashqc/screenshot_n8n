const express = require('express');
const puppeteer = require('puppeteer');

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

    // Load the original page
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await scrollAndLoad(page);

    // Inject Readability.js from CDN
    await page.addScriptTag({
      url: 'https://cdn.jsdelivr.net/npm/@mozilla/readability@0.5.0/Readability.min.js'
    });

    await page.waitForTimeout(500);

    // Apply reader mode using actual Readability
    const readerModeApplied = await page.evaluate(() => {
      try {
        // First, remove all popups, modals, overlays, cookie banners
        const popupSelectors = [
          '[class*="modal"]', '[id*="modal"]',
          '[class*="popup"]', '[id*="popup"]',
          '[class*="overlay"]', '[id*="overlay"]',
          '[class*="cookie"]', '[id*="cookie"]',
          '[class*="consent"]', '[id*="consent"]',
          '[class*="banner"]', '[id*="banner"]',
          '[class*="dialog"]', '[id*="dialog"]',
          '[role="dialog"]', '[role="alertdialog"]',
          '.fancybox-overlay', '.fancybox-wrap',
          '#onetrust-consent-sdk',
          '[class*="lightbox"]',
          '[class*="subscribe"]',
          '[class*="newsletter"]'
        ];

        popupSelectors.forEach(selector => {
          try {
            document.querySelectorAll(selector).forEach(el => {
              el.remove();
            });
          } catch (e) {}
        });

        // Remove fixed/sticky elements that might overlay content
        document.querySelectorAll('*').forEach(el => {
          const style = window.getComputedStyle(el);
          if (style.position === 'fixed' || style.position === 'sticky') {
            const zIndex = parseInt(style.zIndex) || 0;
            // Only remove high z-index elements (likely popups/modals)
            if (zIndex > 1000) {
              el.remove();
            }
          }
        });

        // Clone the document for Readability
        const documentClone = document.cloneNode(true);

        // Check if Readability is available
        if (typeof Readability === 'undefined') {
          console.error('Readability not loaded');
          return false;
        }

        // Parse with Readability
        const reader = new Readability(documentClone);
        const article = reader.parse();

        if (!article) {
          console.error('Readability could not parse article');
          return false;
        }

        // Find the original article element in the actual DOM
        // We'll use the title to help identify it
        let articleElement = null;

        // Try to find by article tag first
        const articles = document.querySelectorAll('article, [role="main"], main');
        for (const el of articles) {
          if (el.innerText && el.innerText.length > 500) {
            articleElement = el;
            break;
          }
        }

        // If not found, find the element with the most matching text
        if (!articleElement) {
          const allElements = document.querySelectorAll('div, section, article');
          let bestMatch = null;
          let maxScore = 0;

          allElements.forEach(el => {
            const text = el.innerText || '';
            const textLength = text.length;

            // Calculate score based on text length and presence of paragraphs
            const paragraphs = el.querySelectorAll('p').length;
            const score = textLength + (paragraphs * 100);

            if (score > maxScore && textLength > 500) {
              maxScore = score;
              bestMatch = el;
            }
          });

          articleElement = bestMatch;
        }

        if (!articleElement) {
          return false;
        }

        // Get all images in the article
        const articleImages = Array.from(articleElement.querySelectorAll('img'));
        const articleImageSrcs = articleImages.map(img => img.src);

        // Style the body
        document.body.style.cssText = `
          margin: 0 !important;
          padding: 40px 20px !important;
          background: #fff !important;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif !important;
          line-height: 1.6 !important;
          color: #333 !important;
        `;

        // Remove ALL body children
        Array.from(document.body.children).forEach(child => {
          child.remove();
        });

        // Create a clean wrapper
        const wrapper = document.createElement('div');
        wrapper.style.cssText = `
          max-width: 800px !important;
          margin: 0 auto !important;
          padding: 0 !important;
        `;

        // Add title
        const titleEl = document.createElement('h1');
        titleEl.textContent = article.title;
        titleEl.style.cssText = 'font-size: 2em; margin-bottom: 0.5em;';
        wrapper.appendChild(titleEl);

        // Add byline if exists
        if (article.byline) {
          const bylineEl = document.createElement('div');
          bylineEl.textContent = article.byline;
          bylineEl.style.cssText = 'color: #666; font-style: italic; margin-bottom: 1em;';
          wrapper.appendChild(bylineEl);
        }

        // Add article element back
        wrapper.appendChild(articleElement);
        document.body.appendChild(wrapper);

        // Clean article styling
        articleElement.style.cssText = `
          background: transparent !important;
          max-width: 100% !important;
        `;

        // Remove all images that are NOT in the article
        document.querySelectorAll('img').forEach(img => {
          if (!articleImageSrcs.includes(img.src)) {
            img.remove();
          } else {
            // Style article images
            img.style.cssText = `
              max-width: 100% !important;
              height: auto !important;
              display: block !important;
              margin: 1em auto !important;
            `;
          }
        });

        // Style paragraphs
        articleElement.querySelectorAll('p').forEach(p => {
          p.style.margin = '1em 0';
        });

        // Remove navigation, ads, etc. that might still be in the article
        const hideSelectors = [
          'nav', 'header', 'footer', 'aside',
          '[role="navigation"]', '[role="banner"]', '[role="complementary"]',
          '.nav', '.navigation', '.menu', '.sidebar', '.ads', '.advertisement',
          '.social-share', '.comments', '.related-posts', '.newsletter'
        ];

        hideSelectors.forEach(selector => {
          articleElement.querySelectorAll(selector).forEach(el => el.remove());
        });

        return true;
      } catch (e) {
        console.error('Reader mode error:', e);
        return false;
      }
    });

    if (!readerModeApplied) {
      console.warn('Could not apply reader mode, taking full page screenshot');
    }

    await page.waitForTimeout(1000);

    // Take screenshot
    const fullScreenshotBuffer = await page.screenshot({
      fullPage: true
    });

    await page.close();

    // Set response headers
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'attachment; filename="screenshot.png"');

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

    // Load the original page
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await scrollAndLoad(page);

    // Inject Readability.js from CDN
    await page.addScriptTag({
      url: 'https://cdn.jsdelivr.net/npm/@mozilla/readability@0.5.0/Readability.min.js'
    });

    await page.waitForTimeout(500);

    // Get article images using Readability
    const articleImageInfo = await page.evaluate(() => {
      try {
        // Remove popups first
        const popupSelectors = [
          '[class*="modal"]', '[id*="modal"]',
          '[class*="popup"]', '[id*="popup"]',
          '[class*="overlay"]', '[id*="overlay"]',
          '[class*="cookie"]', '[id*="cookie"]',
          '[class*="consent"]', '[id*="consent"]',
          '[role="dialog"]', '[role="alertdialog"]'
        ];

        popupSelectors.forEach(selector => {
          try {
            document.querySelectorAll(selector).forEach(el => el.remove());
          } catch (e) {}
        });

        // Clone and parse with Readability
        const documentClone = document.cloneNode(true);

        if (typeof Readability === 'undefined') {
          return { success: false, images: [] };
        }

        const reader = new Readability(documentClone);
        const article = reader.parse();

        if (!article) {
          return { success: false, images: [] };
        }

        // Find the article element in the actual DOM
        let articleElement = null;
        const articles = document.querySelectorAll('article, [role="main"], main');

        for (const el of articles) {
          if (el.innerText && el.innerText.length > 500) {
            articleElement = el;
            break;
          }
        }

        if (!articleElement) {
          const allElements = document.querySelectorAll('div, section, article');
          let bestMatch = null;
          let maxScore = 0;

          allElements.forEach(el => {
            const text = el.innerText || '';
            const textLength = text.length;
            const paragraphs = el.querySelectorAll('p').length;
            const score = textLength + (paragraphs * 100);

            if (score > maxScore && textLength > 500) {
              maxScore = score;
              bestMatch = el;
            }
          });

          articleElement = bestMatch;
        }

        if (!articleElement) {
          return { success: false, images: [] };
        }

        // Get all images in the article
        const images = Array.from(articleElement.querySelectorAll('img'));

        // Filter out small images (likely icons, logos, etc.)
        const contentImages = images.filter(img => {
          const width = img.naturalWidth || img.width || 0;
          const height = img.naturalHeight || img.height || 0;
          // Only include images that are at least 200x100 pixels
          return width >= 200 && height >= 100;
        });

        return {
          success: true,
          images: contentImages.map((img, idx) => ({
            index: idx,
            src: img.src,
            alt: img.alt || '',
            width: img.naturalWidth || img.width,
            height: img.naturalHeight || img.height
          }))
        };

      } catch (e) {
        console.error('Image extraction error:', e);
        return { success: false, images: [] };
      }
    });

    if (!articleImageInfo.success || articleImageInfo.images.length === 0) {
      await page.close();
      return res.status(404).json({ error: 'No images found in the article content' });
    }

    // Now screenshot each image by index
    const imageBuffers = [];

    for (let i = 0; i < articleImageInfo.images.length; i++) {
      try {
        const imgInfo = articleImageInfo.images[i];

        // Find the image element by src
        const imageElement = await page.$(`img[src="${imgInfo.src}"]`);

        if (imageElement) {
          const screenshotBuffer = await imageElement.screenshot();
          imageBuffers.push({
            buffer: screenshotBuffer,
            info: imgInfo
          });
        }
      } catch (err) {
        console.error(`Failed to screenshot image ${i}:`, err.message);
      }
    }

    await page.close();

    if (imageBuffers.length === 0) {
      return res.status(404).json({ error: 'Failed to capture image screenshots' });
    }

    // Return all images as array of base64 encoded binaries
    const imagesBase64 = imageBuffers.map((item, index) => ({
      index: index,
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
