const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3003;

app.get('/screenshot', async (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Take full page screenshot and get buffer directly
    const fullScreenshotBuffer = await page.screenshot({
      fullPage: true
    });

    // Get all images in the body
    const imageElements = await page.$$('body img');

    await browser.close();

    // Set response headers for binary data
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'attachment; filename="screenshot.png"');
    res.setHeader('X-Total-Images', imageElements.length.toString());

    // Send the binary data
    res.send(fullScreenshotBuffer);

  } catch (error) {
    console.error('Screenshot error:', error);
    if (browser) await browser.close();
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

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Get all images in the body
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

    await browser.close();

    if (imageBuffers.length === 0) {
      return res.status(404).json({ error: 'No images found on the page' });
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
    if (browser) await browser.close();
    res.status(500).json({
      error: 'Failed to capture image screenshots',
      message: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Screenshot server running on port ${PORT}`);
  console.log(`Endpoints:`);
  console.log(`  GET /screenshot?url=<URL> - Takes full page screenshot`);
  console.log(`  GET /screenshot/images?url=<URL> - Takes screenshots of all images`);
});
