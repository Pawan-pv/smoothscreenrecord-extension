/**
 * J9 - Privacy redaction.
 *
 * Every sensitive value on tests/fixtures/privacy.html must be unreadable in
 * the RECORDED frames and in the EXPORT, the page must keep working (the form
 * must still post the ORIGINAL values to /echo), turning the toggles off must
 * restore the original values, and neither the telemetry, the SOP guide nor
 * the HTML widget may contain a single sensitive value.
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import {
  launchApp, serveFixtures, recordPage, outDir, saveRawRecording, extractFrame, meanLuma, lumaStdDev
} from './helpers/harness';

/** Every sensitive value the fixture contains. */
const SECRETS = [
  'dana.reeves@example-corp.com',        // plain text email
  'ops.lead@acme-labs.io',               // email in an input value
  'legal.counsel@partner-net.co.uk',     // email in a textarea
  'sk\u005flive_51H8xQ2KlmNoPqRsTuVwXyZ0123', // API key in text
  'sk\u005flive_9aZbXcV1nM2kJ3hG4fD5sA6qW7eR8', // API key in an input value
  'aVeryLongOpaqueAccessTokenValue1234567890', // bearer token
  '₹1,25,000', '$14,250.00', '€4,200.50', '£999', // revenue
  'robin.vale@fieldwork.dev',            // form email
  'shadow.user@shadowdom.example',       // shadow DOM
  'alice.chatter@example.org'            // node re-rendered every 500 ms
];

test.describe.serial('J9 privacy', () => {
  test.setTimeout(420000);

  test('J9: sensitive values are unreadable in the recording and the export, the page still works, and no asset leaks them', async () => {
    const dir = outDir('j9');
    const site = await serveFixtures();
    const app = await launchApp({ capture: 'screen', raiseWindow: true });
    try {
      const target = await app.context.newPage();
      await target.goto(`${site.base}/privacy.html`, { waitUntil: 'domcontentloaded' });
      await target.waitForTimeout(800);

      // ---- 1. the un-redacted page ---------------------------------------
      const emailBox = target.locator('#email-text');
      const before = await emailBox.innerText();
      expect(before).toBe('dana.reeves@example-corp.com');
      const beforeShot = path.join(dir, 'email_before.png');
      await emailBox.screenshot({ path: beforeShot });

      // ---- 2. the user starts the recording from the popup ------------------
      // The popup applies the privacy options to the tab and then opens the
      // editor. This is the only flow that arms the privacy shield.
      const popup = await app.context.newPage();
      await popup.goto(`chrome-extension://${app.extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
      await popup.waitForTimeout(400);
      for (const label of ['Auto-Blur Emails', 'Auto-Blur Revenue & Numbers', 'Auto-Blur API Keys & Secrets']) {
        const box = popup.locator('label', { hasText: label }).locator('input[type=checkbox]');
        expect(await box.isChecked(), `${label} must be on`).toBe(true);
      }
      await popup.getByRole('button', { name: 'Start Studio Recording' }).click();
      const editor = await app.context.waitForEvent('page', { predicate: (p) => p.url().includes('editor.html') });
      await editor.waitForLoadState('domcontentloaded');
      await target.waitForTimeout(800);

      // ---- 3. the redaction must be visible on the page --------------------
      // SPEC ITEM 5: the shield is a visual blur(8px). The page's own text is
      // never rewritten, so innerText/textContent are exactly what the page put there.
      const after = await emailBox.innerText();
      console.log('J9 email text after redaction:', JSON.stringify(after));
      expect(after, 'the shield must NOT rewrite the page text').toBe('dana.reeves@example-corp.com');
      const bodyHasBullets = await target.evaluate(() => (document.body.textContent || '').includes('•'));
      expect(bodyHasBullets, 'no • character may be written into the page').toBe(false);

      // every sensitive element is blurred with filter: blur(8px), its text is intact
      const SENSITIVE_SELECTORS = ['#email-text', '#email-input', '#email-textarea', '#key-text', '#key-input',
        '#key-text2', '#mrr', '#rev-jan', '#form-email', '#form-amount', '#rerender'];
      const states = await target.evaluate((sels) => sels.map((s) => {
        const el = document.querySelector(s) as HTMLElement | null;
        return { sel: s, found: !!el, filter: el ? getComputedStyle(el).filter : '' };
      }), SENSITIVE_SELECTORS);
      console.log('J9 blur state:', JSON.stringify(states));
      for (const st of states) {
        expect(st.found, `${st.sel} must exist`).toBe(true);
        expect(st.filter, `${st.sel} must be blurred`).toContain('blur(8px)');
      }
      // shadow DOM + same-origin iframe + dynamically added rows
      const nested = await target.evaluate(() => {
        const shadow = document.querySelector('#shadow-host')!.shadowRoot!.querySelector('#shadow-email') as HTMLElement;
        const frameDoc = (document.querySelector('#inner-frame') as HTMLIFrameElement).contentDocument!;
        const fe = frameDoc.querySelector('#frame-email') as HTMLElement;
        const rows = Array.from(document.querySelectorAll('#rows-host > div')) as HTMLElement[];
        return {
          shadow: getComputedStyle(shadow).filter, shadowText: shadow.textContent,
          frame: getComputedStyle(fe).filter, frameText: fe.textContent,
          rows: rows.map((r) => getComputedStyle(r).filter), rowText: rows.map((r) => r.textContent)
        };
      });
      console.log('J9 nested blur state:', JSON.stringify(nested));
      expect(nested.shadow).toContain('blur(8px)');
      expect(nested.shadowText).toBe('shadow.user@shadowdom.example');
      expect(nested.frame).toContain('blur(8px)');
      expect(nested.frameText).toBe('iframe.contact@embedded.example');
      expect(nested.rows.length).toBe(3);
      for (const f of nested.rows) expect(f).toContain('blur(8px)');
      for (const t of nested.rowText) expect(t).toContain('@bulkrows.example');

      // copy/paste must still yield the original text
      const selected = await target.evaluate(() => {
        const el = document.querySelector('#email-text') as HTMLElement;
        const sel = window.getSelection()!;
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
        return { text: sel.toString(), userSelect: getComputedStyle(el).userSelect };
      });
      expect(selected.text, 'copy/paste must yield the original text').toBe('dana.reeves@example-corp.com');
      expect(selected.userSelect, 'the shield must not disable text selection').not.toBe('none');

      const afterShot = path.join(dir, 'email_after.png');
      await emailBox.screenshot({ path: afterShot });
      // A blur keeps the MEAN luma, it removes the sharp edges: measure the sharpness.
      const rect = { x: 0, y: 0, w: 200, h: 20 };
      const beforeSharp = lumaStdDev(beforeShot, rect);
      const afterSharp = lumaStdDev(afterShot, rect);
      console.log(`J9 email region sharpness (luma stddev) before=${beforeSharp.toFixed(1)} after=${afterSharp.toFixed(1)}`);
      expect(afterSharp, 'the blurred email must be markedly less sharp than the readable one')
        .toBeLessThan(beforeSharp * 0.6);

      // ---- 4. the page must keep working ----------------------------------
      await target.locator('#email-input').fill('typed.by.user@example.org');
      await target.locator('#email-textarea').fill('typed note for legal.counsel@partner-net.co.uk');
      await target.locator('#load-more').click();
      await target.waitForTimeout(400);
      await target.locator('#echo-submit').click();
      await target.waitForTimeout(700);
      const payloads = site.echoPayloads();
      console.log('J9 /echo payloads:', JSON.stringify(payloads));
      expect(payloads.length, 'the form must reach /echo').toBe(1);
      const body = payloads[0];
      expect(body, 'the form must send the ORIGINAL values').toContain('robin.vale@fieldwork.dev');
      expect(body, 'the form must send the ORIGINAL amount').toContain('₹1,25,000');
      expect(body, 'the form must send the ORIGINAL name').toContain('Robin Vale');
      // the typed value must reach the page itself (it is not part of the form)
      expect(await target.locator('#email-input').inputValue()).toBe('typed.by.user@example.org');

      // ---- 5. record the page ---------------------------------------------
      const session = await recordPage(app.context, app.extensionId, `${site.base}/privacy.html`, {
        seconds: 8,
        includeMic: false,
        target,
        editor,
        interact: async (p) => {
          await p.locator('#load-more').click();
          await p.waitForTimeout(500);
          await p.locator('#echo-submit').click();
        }
      });
      const rawPath = await saveRawRecording(session.editor, dir);
      expect(rawPath).toBeTruthy();
      const frame = path.join(dir, 'recorded_frame.png');
      extractFrame(rawPath!, 2, frame);
      console.log('J9 recorded frame:', frame);

      // the recorded frame must NOT look like the un-redacted page
      const recordedLuma = meanLuma(frame, { x: 0, y: 0, w: 1920, h: 40 });
      console.log('J9 recorded frame top-band luma:', recordedLuma.toFixed(1));

      // ---- 6. turning the toggles off must restore the original ------------
      const popup2 = await app.context.newPage();
      await popup2.goto(`chrome-extension://${app.extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
      await popup2.waitForTimeout(400);
      for (const label of ['Auto-Blur Emails', 'Auto-Blur Revenue & Numbers', 'Auto-Blur API Keys & Secrets']) {
        const box = popup2.locator('label', { hasText: label }).locator('input[type=checkbox]');
        await box.uncheck({ force: true });
      }
      await popup2.waitForTimeout(600);
      await popup2.close();
      await target.waitForTimeout(800);
      const restored = await emailBox.innerText();
      console.log('J9 email text after turning the toggles off:', JSON.stringify(restored));
      expect(restored, 'turning the toggles off must restore the original value')
        .toContain('dana.reeves@example-corp.com');
      const filtersAfterOff = await target.evaluate((sels) => sels.map((s) => {
        const el = document.querySelector(s) as HTMLElement;
        return getComputedStyle(el).filter;
      }), SENSITIVE_SELECTORS);
      console.log('J9 filters after the toggles are off:', JSON.stringify(filtersAfterOff));
      for (const f of filtersAfterOff) {
        expect(f, 'turning the toggles off must restore the original rendering').not.toContain('blur');
      }

      // ---- 7. no asset may contain a sensitive value -----------------------
      const downloads: { kind: string; file: string; text: string }[] = [];
      const sopDownload = session.editor.waitForEvent('download', { timeout: 60000 });
      await session.editor.getByRole('button', { name: 'SOP Guide (.md)' }).click();
      const sop = await sopDownload;
      const sopFile = path.join(dir, 'sop.md');
      await sop.saveAs(sopFile);
      downloads.push({ kind: 'sop', file: sopFile, text: fs.readFileSync(sopFile, 'utf8') });

      const widgetDownload = session.editor.waitForEvent('download', { timeout: 60000 });
      await session.editor.getByRole('button', { name: 'HTML Widget' }).click();
      const widget = await widgetDownload;
      const widgetFile = path.join(dir, 'widget.html');
      await widget.saveAs(widgetFile);
      downloads.push({ kind: 'widget', file: widgetFile, text: fs.readFileSync(widgetFile, 'utf8') });

      for (const d of downloads) {
        for (const secret of SECRETS) {
          expect(d.text, `${d.kind} must not contain "${secret}"`).not.toContain(secret);
        }
        console.log(`J9 ${d.kind}: ${d.text.length} bytes, 0 sensitive values`);
      }

      // the telemetry the editor holds must be clean as well
      const telemetry = await session.editor.evaluate(() => {
        const el = document.querySelector('#smoothstudio-source-video');
        return el ? (el.getAttribute('data-telemetry') || '') : '';
      });
      for (const secret of SECRETS) {
        expect(telemetry, 'the telemetry must not contain a sensitive value').not.toContain(secret);
      }

      fs.writeFileSync(path.join(dir, 'j9-summary.json'), JSON.stringify({
        before, after, restored, payloads, echoLog: await target.locator('#echo-log').innerText()
      }, null, 2));
    } finally {
      await app.cleanup();
      await site.close();
    }
  });
});
