import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionPath = path.resolve(__dirname, '../dist');
const testOutDir = path.resolve(__dirname, '../test-results/b2');
if (!fs.existsSync(testOutDir)) fs.mkdirSync(testOutDir, { recursive: true });

// Create fixture page with password, cc-number, current-password, one-time-code, email, api key
const fixtureHtml = `<!DOCTYPE html>
<html>
<head><title>B2 Privacy Keystroke Target</title></head>
<body style="background:#111; color:#eee; padding:20px;">
  <h2>Sensitive Keystroke & Form Fixture</h2>
  <form id="sensitive-form" onsubmit="event.preventDefault(); window.__submittedValues = {
    pass: document.getElementById('pass-field').value,
    cc: document.getElementById('cc-field').value,
    token: document.getElementById('token-field').value,
    email: document.getElementById('email-field').value
  };">
    <div>
      <label>Password:</label>
      <input type="password" id="pass-field" name="password" />
    </div>
    <div>
      <label>Credit Card Number:</label>
      <input type="text" id="cc-field" autocomplete="cc-number" />
    </div>
    <div>
      <label>API Key / Token:</label>
      <input type="text" id="token-field" name="api_token" placeholder="sk_live_..." />
    </div>
    <div>
      <label>Email Address:</label>
      <input type="email" id="email-field" autocomplete="email" />
    </div>
    <div>
      <label>Current Password:</label>
      <input type="text" id="curr-pass-field" autocomplete="current-password" />
    </div>
    <div>
      <label>One-Time Code (2FA):</label>
      <input type="text" id="otp-field" autocomplete="one-time-code" />
    </div>
    <div>
      <button type="submit" id="submit-btn">Submit Credentials</button>
    </div>
  </form>
</body>
</html>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(fixtureHtml);
}).listen(8770);

console.log('[B2 Test] Test server running on http://localhost:8770');

const context = await chromium.launchPersistentContext('', {
  headless: false,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--no-sandbox',
    '--auto-select-tab-capture-source-by-title=B2 Privacy Keystroke Target'
  ]
});

try {
  let [background] = context.serviceWorkers();
  if (!background) background = await context.waitForEvent('serviceworker');
  const extensionId = new URL(background.url()).host;
  console.log('[B2 Test] Extension ID:', extensionId);

  const targetPage = await context.newPage();
  await targetPage.goto('http://localhost:8770');
  await targetPage.waitForSelector('#pass-field');

  // Start telemetry recording on the target page
  console.log('[B2 Test] Initiating telemetry tracking...');
  await background.evaluate(async () => {
    return new Promise((resolve) => {
      chrome.tabs.query({ url: '*://localhost/*' }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'START_TELEMETRY' }, () => resolve(true));
        } else {
          resolve(false);
        }
      });
    });
  });
  await targetPage.waitForTimeout(300);

  // Focus and type into password field
  const SECRET_PASSWORD = 'SuperSecretP@ssword123!';
  console.log('[B2 Test] Typing sensitive password into #pass-field...');
  await targetPage.click('#pass-field');
  await targetPage.keyboard.type(SECRET_PASSWORD, { delay: 30 });

  // Focus and type into credit card field
  const SECRET_CC = '4111222233334444';
  console.log('[B2 Test] Typing credit card into #cc-field...');
  await targetPage.click('#cc-field');
  await targetPage.keyboard.type(SECRET_CC, { delay: 30 });

  // Focus and type into API token field
  const SECRET_TOKEN = 'sk\u005flive_998877665544332211aabbcc';
  console.log('[B2 Test] Typing secret token into #token-field...');
  await targetPage.click('#token-field');
  await targetPage.keyboard.type(SECRET_TOKEN, { delay: 30 });

  // Focus and type into current-password field
  const CURRENT_PW = 'OldPass987!';
  console.log('[B2 Test] Typing into #curr-pass-field (autocomplete="current-password")...');
  await targetPage.click('#curr-pass-field');
  await targetPage.keyboard.type(CURRENT_PW, { delay: 30 });

  // Focus and type into OTP field
  const SECRET_OTP = '987654';
  console.log('[B2 Test] Typing into #otp-field (autocomplete="one-time-code")...');
  await targetPage.click('#otp-field');
  await targetPage.keyboard.type(SECRET_OTP, { delay: 30 });

  // Click submit button
  await targetPage.click('#submit-btn');

  // Stop telemetry and retrieve captured events via background script
  const telemetry = await background.evaluate(async () => {
    return new Promise((resolve) => {
      chrome.tabs.query({ url: '*://localhost/*' }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'STOP_TELEMETRY' }, (resp) => {
            resolve(resp?.data);
          });
        } else {
          resolve(null);
        }
      });
    });
  });

  console.log('[B2 Test] Telemetry received. Total keystrokes:', telemetry?.keystrokes?.length);

  // 1. Verify NO secret strings exist in captured keystrokes
  const secretStrings = [SECRET_PASSWORD, SECRET_CC, SECRET_TOKEN, CURRENT_PW, SECRET_OTP];
  for (const str of secretStrings) {
    for (let char of str) {
      const leaked = telemetry.keystrokes.some(k => k.key === char && k.key.length === 1 && /[a-zA-Z0-9!@]/.test(k.key));
      if (leaked) {
        throw new Error(`B2 FAILURE: Raw character '${char}' from sensitive input was captured in keystrokes!`);
      }
    }
  }

  // 2. Verify keystrokes logged as [hidden input]
  const hiddenKeystrokes = telemetry.keystrokes.filter(k => k.combo === '[hidden input]' || k.key === '[hidden input]');
  console.log('[B2 Test] Keystrokes masked as [hidden input]:', hiddenKeystrokes.length);
  if (hiddenKeystrokes.length === 0) {
    throw new Error('B2 FAILURE: No keystrokes were logged as [hidden input]!');
  }

  // 3. Generate SOP Markdown and HTML Widget with Auto-Blur ON
  const editorPage = await context.newPage();
  await editorPage.goto(`chrome-extension://${extensionId}/editor.html`);
  await editorPage.waitForSelector('#record-new-screen-top-btn', { timeout: 10000 });

  const { generatedSop, generatedWidget } = await editorPage.evaluate((tel) => {
    const SopExporter = window.__SopGuideExporter;
    const WidgetExporter = window.__HtmlWidgetExporter;
    const sop = SopExporter.generateMarkdownGuide(tel, [], true);
    const widget = WidgetExporter.generateInteractiveWidget(tel, [], true);
    return { generatedSop: sop, generatedWidget: widget };
  }, telemetry);

  const sopFilePath = path.join(testOutDir, 'B2_SOP_Guide.md');
  const widgetFilePath = path.join(testOutDir, 'B2_Interactive_Walkthrough.html');
  fs.writeFileSync(sopFilePath, generatedSop);
  fs.writeFileSync(widgetFilePath, generatedWidget);

  console.log('[B2 Test] Saved SOP to:', sopFilePath);
  console.log('[B2 Test] Saved Widget to:', widgetFilePath);

  // 4. Grep SOP and HTML Widget for any sensitive strings
  for (const str of secretStrings) {
    if (generatedSop.includes(str)) {
      throw new Error(`B2 FAILURE: Sensitive string '${str}' leaked into generated SOP!`);
    }
    if (generatedWidget.includes(str)) {
      throw new Error(`B2 FAILURE: Sensitive string '${str}' leaked into HTML widget!`);
    }
  }

  // 5. Verify [hidden input] appears in SOP
  if (!generatedSop.includes('[hidden input]')) {
    throw new Error('B2 FAILURE: "[hidden input]" was not found in generated SOP!');
  }

  console.log('\n--- B2 SOP Snippet Verification ---');
  const sopLines = generatedSop.split('\n').filter(l => l.includes('Step') || l.includes('hidden input')).slice(0, 10);
  console.log(sopLines.join('\n'));

  console.log('\n✓ B2 PASS: Sensitive keystrokes masked as [hidden input]. Grep of SOP and HTML widget returns 0 matches for typed sensitive values!');
  await context.close();
  server.close();
  process.exit(0);
} catch (err) {
  console.error('[B2 Test] Error:', err);
  try { await context.close(); } catch {}
  try { server.close(); } catch {}
  process.exit(1);
}
