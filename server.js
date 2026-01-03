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

    // Inject Readability and apply reader mode directly on the page
    const readerModeApplied = await page.evaluate(() => {
      try {
        // Clone the document to avoid modifying the original
        const documentClone = document.cloneNode(true);

        // Use Readability to parse (we need to inject it first)
        // For now, let's use a simpler approach: find the main content area

        // Common article selectors
        const articleSelectors = [
          'article',
          '[role="main"]',
          'main',
          '.article-content',
          '.post-content',
          '.entry-content',
          '#content',
          '.content'
        ];

        let articleElement = null;
        for (const selector of articleSelectors) {
          articleElement = document.querySelector(selector);
          if (articleElement) break;
        }

        if (!articleElement) {
          // If no article found, try to find the element with most text content
          const allElements = document.querySelectorAll('div, section, article');
          let maxTextLength = 0;

          allElements.forEach(el => {
            const textLength = el.innerText?.length || 0;
            if (textLength > maxTextLength) {
              maxTextLength = textLength;
              articleElement = el;
            }
          });
        }

        if (!articleElement) {
          return false;
        }

        // Hide everything in body
        document.body.style.cssText = `
          margin: 0 !important;
          padding: 40px 20px !important;
          background: #fff !important;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif !important;
          line-height: 1.6 !important;
          color: #333 !important;
        `;

        // Hide all direct children of body
        Array.from(document.body.children).forEach(child => {
          if (!child.contains(articleElement)) {
            child.style.display = 'none';
          }
        });

        // Create a wrapper for the article
        const wrapper = document.createElement('div');
        wrapper.style.cssText = `
          max-width: 800px !important;
          margin: 0 auto !important;
          padding: 0 !important;
        `;

        // Move article into wrapper
        const articleParent = articleElement.parentNode;
        articleParent.insertBefore(wrapper, articleElement);
        wrapper.appendChild(articleElement);

        // Clean up article styling
        articleElement.style.cssText = `
          background: transparent !important;
          max-width: 100% !important;
        `;

        // Style images
        const images = articleElement.querySelectorAll('img');
        images.forEach(img => {
          img.style.cssText = `
            max-width: 100% !important;
            height: auto !important;
            display: block !important;
            margin: 1em 0 !important;
          `;
        });

        // Style paragraphs
        const paragraphs = articleElement.querySelectorAll('p');
        paragraphs.forEach(p => {
          p.style.margin = '1em 0';
        });

        // Hide navigation, headers, footers, sidebars, ads
        const hideSelectors = [
          'nav', 'header', 'footer', 'aside',
          '[role="navigation"]', '[role="banner"]', '[role="complementary"]',
          '.nav', '.navigation', '.menu', '.sidebar', '.ads', '.advertisement',
          '.social-share', '.comments', '.related-posts'
        ];

        hideSelectors.forEach(selector => {
          document.querySelectorAll(selector).forEach(el => {
            if (!articleElement.contains(el) || el.contains(articleElement)) {
              el.style.display = 'none';
            }
          });
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

    // Find article images on the actual page (don't rebuild)
    const articleImageSelectors = await page.evaluate(() => {
      // Common article selectors
      const articleSelectors = [
        'article',
        '[role="main"]',
        'main',
        '.article-content',
        '.post-content',
        '.entry-content',
        '#content',
        '.content'
      ];

      let articleElement = null;
      for (const selector of articleSelectors) {
        articleElement = document.querySelector(selector);
        if (articleElement) break;
      }

      if (!articleElement) {
        // If no article found, try to find the element with most text content
        const allElements = document.querySelectorAll('div, section, article');
        let maxTextLength = 0;

        allElements.forEach(el => {
          const textLength = el.innerText?.length || 0;
          if (textLength > maxTextLength) {
            maxTextLength = textLength;
            articleElement = el;
          }
        });
      }

      // Get images from article only
      if (articleElement) {
        const images = Array.from(articleElement.querySelectorAll('img'));
        return images.map(img => ({
          src: img.src,
          alt: img.alt || '',
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height
        }));
      }

      return [];
    });

    // Screenshot each image element
    const imageElements = await page.$$('article img, [role="main"] img, main img, .article-content img, .post-content img, .entry-content img');
    const imageBuffers = [];

    for (let i = 0; i < imageElements.length; i++) {
      try {
        const screenshotBuffer = await imageElements[i].screenshot();
        imageBuffers.push({
          buffer: screenshotBuffer,
          info: articleImageSelectors[i] || {}
        });
      } catch (err) {
        console.error(`Failed to screenshot image ${i}:`, err.message);
      }
    }

    await page.close();

    if (imageBuffers.length === 0) {
      return res.status(404).json({ error: 'No images found in the article content' });
    }

    // Return all images as array of base64 encoded binaries
    const imagesBase64 = imageBuffers.map((item, index) => ({
      index: index,
      filename: `image-${index}.png`,
      mimeType: 'image/png',
      data: item.buffer.toString('base64'),
      src: item.info.src || '',
      alt: item.info.alt || ''
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
