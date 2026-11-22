import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const svgPath = path.resolve(__dirname, 'icon.svg');
const svgContent = fs.readFileSync(svgPath, 'utf8');

const targets = [
  { size: 16, out: path.resolve(__dirname, '../public/icon16.png') },
  { size: 48, out: path.resolve(__dirname, '../public/icon48.png') },
  { size: 128, out: path.resolve(__dirname, '../public/icon128.png') },
];

async function generate() {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const target of targets) {
      const page = await browser.newPage({
        viewport: { width: target.size, height: target.size },
        deviceScaleFactor: 1,
      });

      const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${target.size}px; height: ${target.size}px; background: transparent; overflow: hidden; }
  svg { display: block; width: ${target.size}px; height: ${target.size}px; }
</style>
</head>
<body>
${svgContent}
</body>
</html>`;

      await page.setContent(html, { waitUntil: 'load' });
      await page.screenshot({
        path: target.out,
        omitBackground: true,
        type: 'png',
      });
      await page.close();

      const buf = fs.readFileSync(target.out);
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      const colorType = buf[25];
      console.log(`Rendered ${path.basename(target.out)}: ${w}x${h}, size ${buf.length} bytes, colorType=${colorType}`);
    }
  } finally {
    await browser.close();
  }
}

generate().catch(err => {
  console.error(err);
  process.exit(1);
});
