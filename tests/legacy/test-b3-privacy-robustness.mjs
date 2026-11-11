import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionPath = path.resolve(__dirname, '../dist');
const testOutDir = path.resolve(__dirname, '../test-results/b3');
if (!fs.existsSync(testOutDir)) fs.mkdirSync(testOutDir, { recursive: true });

const html = fs.readFileSync(path.resolve(__dirname, 'test-target.html'), 'utf8');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}).listen(8771);

console.log('[B3 Test] Test server running on http://localhost:8771');

const context = await chromium.launchPersistentContext('', {
  headless: false,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--no-sandbox',
    '--auto-select-tab-capture-source-by-title=SmoothStudio Autonomous Test Target App'
  ]
});

try {
  let [background] = context.serviceWorkers();
  if (!background) background = await context.waitForEvent('serviceworker');
  const extensionId = new URL(background.url()).host;
  console.log('[B3 Test] Extension ID:', extensionId);

  const targetPage = await context.newPage();
  await targetPage.goto('http://localhost:8771');
  await targetPage.waitForSelector('#b3-privacy-card');

  // Verify initial unredacted values before applying privacy
  const rawInputEmail = await targetPage.$eval('#b3-input-email', el => el.value);
  const rawTextarea = await targetPage.$eval('#b3-textarea-notes', el => el.value);
  const rawInr = await targetPage.$eval('#curr-inr', el => el.innerText);
  const rawEur = await targetPage.$eval('#curr-eur', el => el.innerText);
  const rawGbp = await targetPage.$eval('#curr-gbp', el => el.innerText);
  const rawRev1 = await targetPage.$eval('#rev-cell-1', el => el.innerText);
  console.log('[B3 Test] Initial unredacted values:');
  console.log(`  Input email: ${rawInputEmail}`);
  console.log(`  Textarea: ${rawTextarea}`);
  console.log(`  Currencies: INR=${rawInr}, EUR=${rawEur}, GBP=${rawGbp}, RevCell=${rawRev1}`);

  // APPLY AUTO REDACTION
  console.log('\n[B3 Test] Applying auto redaction via extension message...');
  const applyResp = await background.evaluate(async () => {
    return new Promise((resolve) => {
      chrome.tabs.query({ url: '*://localhost/*' }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'APPLY_PRIVACY_OPTIONS',
            options: { blurEmails: true, blurRevenue: true, blurApiKeys: true }
          }, (resp) => resolve(resp));
        } else {
          resolve(null);
        }
      });
    });
  });
  console.log('[B3 Test] Response from APPLY_PRIVACY_OPTIONS:', applyResp);

  // Give scanner 300ms to process DOM
  await targetPage.waitForTimeout(300);

  // --- CHECK (a): Email inside <input> and <textarea> ---
  console.log('\n--- Checking (a): Email inside <input> and <textarea> ---');
  const inputClass = await targetPage.$eval('#b3-input-email', el => el.className);
  const inputVal = await targetPage.$eval('#b3-input-email', el => el.value);
  const textareaClass = await targetPage.$eval('#b3-textarea-notes', el => el.className);
  const textareaVal = await targetPage.$eval('#b3-textarea-notes', el => el.value);

  console.log(`  #b3-input-email class: "${inputClass}", value preserved: "${inputVal}"`);
  console.log(`  #b3-textarea-notes class: "${textareaClass}", value preserved: "${textareaVal}"`);

  if (!inputClass.includes('smoothstudio-blur-redacted')) {
    throw new Error('Check (a) FAILED: #b3-input-email did not receive smoothstudio-blur-redacted class');
  }
  if (!textareaClass.includes('smoothstudio-blur-redacted')) {
    throw new Error('Check (a) FAILED: #b3-textarea-notes did not receive smoothstudio-blur-redacted class');
  }
  if (inputVal !== rawInputEmail || textareaVal !== rawTextarea) {
    throw new Error('Check (a) FAILED: input or textarea value was corrupted in the DOM!');
  }
  console.log('✓ Check (a) PASS: Visual blur attached to <input> and <textarea>, values 100% preserved intact!');

  // --- CHECK (b): Dynamic rows added after redaction enabled (MutationObserver) ---
  console.log('\n--- Checking (b): Dynamic rows added after redaction enabled ---');
  await targetPage.click('#b3-add-dynamic-row-btn');
  // Wait for MutationObserver debounced scan (150ms)
  await targetPage.waitForTimeout(200);

  const dynRowClass = await targetPage.$eval('#dynamic-row-1', el => el.className);
  console.log(`  Dynamically added #dynamic-row-1 class: "${dynRowClass}"`);
  if (!dynRowClass.includes('smoothstudio-blur-redacted')) {
    throw new Error('Check (b) FAILED: MutationObserver failed to blur dynamically added sensitive row');
  }
  console.log('✓ Check (b) PASS: Dynamically inserted row was automatically redacted by MutationObserver!');

  // --- CHECK (c): Continuous re-renders rewriting text nodes every 500ms ---
  console.log('\n--- Checking (c): Continuous 500ms re-renders ---');
  await targetPage.waitForTimeout(1100); // Wait through 2 full re-render intervals
  const rerenderClass = await targetPage.$eval('#b3-rerender-content', el => el.className);
  console.log(`  #b3-rerender-content class after interval ticks: "${rerenderClass}"`);
  if (!rerenderClass.includes('smoothstudio-blur-redacted')) {
    throw new Error('Check (c) FAILED: 500ms continuous re-renders dropped the visual blur');
  }
  console.log('✓ Check (c) PASS: Continuous 500ms re-renders remain actively redacted without dropping blur!');

  // --- CHECK (d): Currencies (₹1,25,000, €4,200.50, £999) and Revenue table plain numbers ---
  console.log('\n--- Checking (d): Currencies & plain revenue table numbers ---');
  const inrClass = await targetPage.$eval('#curr-inr', el => el.className);
  const eurClass = await targetPage.$eval('#curr-eur', el => el.className);
  const gbpClass = await targetPage.$eval('#curr-gbp', el => el.className);
  const rev1Class = await targetPage.$eval('#rev-cell-1', el => el.className);
  const rev2Class = await targetPage.$eval('#rev-cell-2', el => el.className);

  console.log(`  ₹1,25,000 class: "${inrClass}"`);
  console.log(`  €4,200.50 class: "${eurClass}"`);
  console.log(`  £999 class: "${gbpClass}"`);
  console.log(`  rev-cell-1 (125000) class: "${rev1Class}"`);
  console.log(`  rev-cell-2 (4200) class: "${rev2Class}"`);

  if (!inrClass.includes('smoothstudio-blur-redacted')) throw new Error('Check (d) FAILED: INR currency was not redacted');
  if (!eurClass.includes('smoothstudio-blur-redacted')) throw new Error('Check (d) FAILED: EUR currency was not redacted');
  if (!gbpClass.includes('smoothstudio-blur-redacted')) throw new Error('Check (d) FAILED: GBP currency was not redacted');
  if (!rev1Class.includes('smoothstudio-blur-redacted') || !rev2Class.includes('smoothstudio-blur-redacted')) {
    throw new Error('Check (d) FAILED: Plain numbers in revenue table cells were not redacted');
  }
  console.log('✓ Check (d) PASS: Multi-currencies (₹, €, £) and plain table numbers successfully redacted!');

  // --- CHECK (e): Shadow DOM & Same-origin iframe ---
  console.log('\n--- Checking (e): Shadow DOM and same-origin iframe ---');
  const shadowClass = await targetPage.evaluate(() => {
    const host = document.getElementById('b3-shadow-host');
    const sensitiveEl = host?.shadowRoot?.getElementById('shadow-sensitive');
    return sensitiveEl?.className || '';
  });
  console.log(`  Shadow DOM element class: "${shadowClass}"`);
  if (!shadowClass.includes('smoothstudio-blur-redacted')) {
    throw new Error('Check (e) FAILED: Shadow DOM content was not traversed or redacted');
  }

  const iframeClass = await targetPage.evaluate(() => {
    const frame = document.getElementById('b3-test-iframe');
    const doc = frame?.contentDocument;
    const sensitiveEl = doc?.getElementById('iframe-sensitive');
    return sensitiveEl?.className || '';
  });
  console.log(`  Iframe element class: "${iframeClass}"`);
  if (!iframeClass.includes('smoothstudio-blur-redacted')) {
    throw new Error('Check (e) FAILED: Same-origin iframe content was not traversed or redacted');
  }
  console.log('✓ Check (e) PASS: Shadow DOM and same-origin iframe contents successfully redacted!');

  // --- CHECK (f): Functional integrity: Clicking buttons, form submission sends original values, toggle-off restores original text ---
  console.log('\n--- Checking (f): Functional integrity and toggle-off restoration ---');
  // 1. Submit form
  await targetPage.click('#b3-form-submit-btn');
  const submittedValues = await targetPage.evaluate(() => window.__submittedValues);
  console.log('  Form submitted values captured by app handler:', submittedValues);

  if (submittedValues?.email !== 'executive-user@target-app.com') {
    throw new Error(`Check (f) FAILED: Form submission sent corrupted value: ${submittedValues?.email}`);
  }
  if (submittedValues?.token !== 'sk\u005flive_form_token_1122334455') {
    throw new Error(`Check (f) FAILED: Form submission sent corrupted token: ${submittedValues?.token}`);
  }
  console.log('  ✓ Form submission transmitted 100% genuine values (not "••••")!');

  // 2. Toggle-off (RESET_PRIVACY)
  console.log('  Testing toggle-off (RESET_PRIVACY)...');
  const resetResp = await background.evaluate(async () => {
    return new Promise((resolve) => {
      chrome.tabs.query({ url: '*://localhost/*' }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'RESET_PRIVACY' }, (resp) => resolve(resp));
        } else {
          resolve(null);
        }
      });
    });
  });
  console.log('[B3 Test] Response from RESET_PRIVACY:', resetResp);
  await targetPage.waitForTimeout(300);

  const resetInputClass = await targetPage.$eval('#b3-input-email', el => el.className);
  const resetInrClass = await targetPage.$eval('#curr-inr', el => el.className);
  const resetRev1Class = await targetPage.$eval('#rev-cell-1', el => el.className);
  console.log(`  After reset, #b3-input-email class: "${resetInputClass}", #curr-inr class: "${resetInrClass}", rev-cell-1 class: "${resetRev1Class}"`);

  if (resetInputClass.includes('smoothstudio-blur-redacted') || resetInrClass.includes('smoothstudio-blur-redacted')) {
    throw new Error('Check (f) FAILED: Reset failed to restore original unblurred state');
  }

  // Take screenshot of fixture for visual evidence
  const shotPath = path.join(testOutDir, 'b3_privacy_suite_restored.png');
  await targetPage.screenshot({ path: shotPath });
  console.log(`  Screenshot saved to: ${shotPath}`);

  console.log('✓ Check (f) PASS: Form submission sends original values, button clicks work, and toggle-off restores original text cleanly!');
  console.log('\n=== ALL B3 VERIFICATION CHECKS (a)-(f) PASSED ===');

  await context.close();
  server.close();
  process.exit(0);
} catch (err) {
  console.error('[B3 Test] Error:', err);
  try { await context.close(); } catch {}
  try { server.close(); } catch {}
  process.exit(1);
}
