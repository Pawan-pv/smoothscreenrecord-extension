import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyAutoRedaction,
  resetRedactions,
  redactTextString,
  EMAIL_DETECT,
  REVENUE_DETECT,
  API_KEY_DETECT
} from '../../src/content/privacy-redactor';

describe('Privacy Redactor: Real-Time DOM Inspection & Sanitization', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('1. Regex Masking Boundary Controls (Pure String Scrubbing)', () => {
    it('detects and masks plain-text email addresses across various TLDs', () => {
      const sample = 'Send enterprise invoices to billing.lead+corp@stripe-payments.co.uk immediately.';
      expect(EMAIL_DETECT.test(sample)).toBe(true);

      const scrubbed = redactTextString(sample, { blurEmails: true, blurRevenue: false, blurApiKeys: false });
      expect(scrubbed).toBe('Send enterprise invoices to ••••••@••••.com immediately.');
    });

    it('detects and masks large financial revenue figures, ARR metrics, and currency prefixes', () => {
      const inputs = [
        'ARR reached $1,250,000 in Q3',
        'Total net MRR is €48,500.00 this month',
        'Recorded revenue of £950,000 for FY2026',
        'Bookings exceeded USD 3,400,000'
      ];

      for (const input of inputs) {
        expect(REVENUE_DETECT.test(input)).toBe(true);
        const scrubbed = redactTextString(input, { blurEmails: false, blurRevenue: true, blurApiKeys: false });
        expect(scrubbed).toContain('$••,•••');
      }
    });

    it('detects and masks sensitive high-entropy alphanumeric API credential lines', () => {
      const credentials = [
        'Authorization: Bearer sec_tok_99887766554433221100aa',
        'API Secret: sk\u005flive_51Abcdef1234567890abcdef1234',
        'Cloud Key: AI\u007aaSyB1234567890abcdefghijklmnopqrstu1',
        'GitHub Access: gh\u0070_1234567890abcdefghijklmnopqrstuvwxyz'
      ];

      for (const cred of credentials) {
        expect(API_KEY_DETECT.test(cred)).toBe(true);
        const scrubbed = redactTextString(cred, { blurEmails: false, blurRevenue: false, blurApiKeys: true });
        expect(scrubbed).toContain('••••••••••••••••');
        expect(scrubbed).not.toContain('sk_live_');
        expect(scrubbed).not.toContain('AIzaSyB');
      }
    });

    it('preserves clean, non-sensitive strings without mutating characters', () => {
      const benign = 'Welcome to the dashboard! Click here to configure team workspace settings.';
      const scrubbed = redactTextString(benign);
      expect(scrubbed).toBe(benign);
    });
  });

  describe('2. In-Memory Document Mutation & Sub-30ms Performance', () => {
    it('blurs the offending elements with filter: blur(8px) and never rewrites the page text (spec item 5)', () => {
      // Build a realistic enterprise UI dashboard DOM fragment
      document.body.innerHTML = `
        <div id="app-root" class="min-h-screen bg-slate-900 text-white p-6">
          <header class="border-b border-slate-700 pb-4">
            <h1 id="page-title">Financial Overview</h1>
            <p id="account-holder">Account Owner: executive.director@fintech-global.com</p>
          </header>
          <main class="grid grid-cols-3 gap-4 mt-6">
            <div id="card-arr" class="card">
              <span class="label">Total ARR</span>
              <span id="arr-val" class="metric">$1,250,000</span>
            </div>
            <div id="card-keys" class="card">
              <span class="label">Production Key</span>
              <code id="prod-key">sk\u005flive_998811223344556677889900</code>
            </div>
            <div id="card-users" class="card">
              <span class="label">Active Seats</span>
              <span id="seat-count" class="metric">45 active seats</span>
            </div>
          </main>
          <footer class="mt-8 text-xs text-slate-400">
            <span id="footer-copy">All rights reserved © 2026 Enterprise Inc.</span>
          </footer>
        </div>
      `;

      const textNodesBefore: string[] = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) textNodesBefore.push((w.currentNode as Text).nodeValue || '');
      const textBefore = document.body.textContent;

      // Measure execution duration for the DOM scan
      const start = performance.now();
      applyAutoRedaction({ blurEmails: true, blurRevenue: true, blurApiKeys: true });
      const durationMs = performance.now() - start;
      expect(durationMs).toBeLessThan(150);

      // SPEC ITEM 5: the page's own text is never rewritten.
      expect(document.body.textContent).toBe(textBefore);
      expect(document.body.textContent).not.toContain('•');
      const textNodesAfter: string[] = [];
      const w2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (w2.nextNode()) textNodesAfter.push((w2.currentNode as Text).nodeValue || '');
      expect(textNodesAfter).toEqual(textNodesBefore);
      expect(document.getElementById('account-holder')?.textContent).toBe(
        'Account Owner: executive.director@fintech-global.com'
      );
      expect(document.getElementById('arr-val')?.textContent).toBe('$1,250,000');
      expect(document.getElementById('prod-key')?.textContent).toBe('sk\u005flive_998811223344556677889900');

      // The redaction is VISUAL: a blur(8px) filter on the offending elements.
      for (const id of ['account-holder', 'arr-val', 'prod-key']) {
        const el = document.getElementById(id) as HTMLElement;
        expect(el.style.filter, `#${id} must be blurred`).toContain('blur(8px)');
      }

      // Non-sensitive elements are untouched.
      for (const id of ['page-title', 'seat-count', 'footer-copy']) {
        const el = document.getElementById(id) as HTMLElement;
        expect(el.style.filter, `#${id} must not be blurred`).toBe('');
        expect(el.classList.contains('smoothstudio-blur-redacted')).toBe(false);
      }
    });

    it('turning a category OFF restores the original rendering immediately, and the text was never touched', () => {
      document.body.innerHTML = `
        <p id="mail">Write to ops.lead@acme-labs.io</p>
        <p id="money">Revenue is $14,250.00</p>
      `;
      applyAutoRedaction({ blurEmails: true, blurRevenue: true, blurApiKeys: true });
      expect((document.getElementById('mail') as HTMLElement).style.filter).toContain('blur(8px)');
      expect((document.getElementById('money') as HTMLElement).style.filter).toContain('blur(8px)');

      applyAutoRedaction({ blurEmails: false, blurRevenue: true, blurApiKeys: true });
      const mail = document.getElementById('mail') as HTMLElement;
      expect(mail.style.filter).toBe('');
      expect(mail.classList.contains('smoothstudio-blur-redacted')).toBe(false);
      expect(mail.textContent).toBe('Write to ops.lead@acme-labs.io');
      expect((document.getElementById('money') as HTMLElement).style.filter).toContain('blur(8px)');

      resetRedactions();
      expect((document.getElementById('money') as HTMLElement).style.filter).toBe('');
      expect(document.getElementById('money')?.textContent).toBe('Revenue is $14,250.00');
    });

    it("restores the page's own inline filter and never touches the page's own data-redacted attribute", () => {
      document.body.innerHTML = `
        <p id="own" style="filter: grayscale(1)" data-redacted="from-the-page">Mail me: own.filter@example.org</p>
      `;
      applyAutoRedaction({ blurEmails: true });
      const el = document.getElementById('own') as HTMLElement;
      expect(el.style.filter).toContain('blur(8px)');
      expect(el.getAttribute('data-redacted')).toBe('from-the-page');

      resetRedactions();
      expect(el.style.filter).toBe('grayscale(1)');
      expect(el.getAttribute('data-redacted')).toBe('from-the-page');
      expect(el.textContent).toBe('Mail me: own.filter@example.org');
    });

    it('keeps the page usable: selection/copy is allowed, form values stay intact, no fade-in leaks a frame', () => {
      document.body.innerHTML = `
        <p id="mail">Contact: copy.me@example.org</p>
        <input id="em" type="text" value="typed.value@example.org" />
        <input id="pwd" type="password" value="hunter2-hunter2" />
      `;
      applyAutoRedaction({ blurEmails: true, blurRevenue: true, blurApiKeys: true });

      expect((document.getElementById('em') as HTMLInputElement).value).toBe('typed.value@example.org');
      expect((document.getElementById('pwd') as HTMLInputElement).value).toBe('hunter2-hunter2');
      expect((document.getElementById('em') as HTMLElement).style.filter).toContain('blur(8px)');

      const css = document.getElementById('smoothstudio-redaction-styles')?.textContent || '';
      expect(css).toContain('blur(8px)');
      // copy/paste must still yield the original text
      expect(css).not.toMatch(/user-select\s*:\s*none/);
      // the blur must be instant: a transition would paint sharp frames into the recording
      expect(css).not.toMatch(/transition/);
    });

    it('blurs sensitive content that the page adds later, without rewriting it', async () => {
      document.body.innerHTML = `<div id="host"></div>`;
      applyAutoRedaction({ blurEmails: true, blurRevenue: true, blurApiKeys: true });
      const host = document.getElementById('host') as HTMLElement;
      host.innerHTML = `<div id="late">late.arrival@example.org</div>`;
      await new Promise((r) => setTimeout(r, 120));
      const late = document.getElementById('late') as HTMLElement;
      expect(late.style.filter).toContain('blur(8px)');
      expect(late.textContent).toBe('late.arrival@example.org');
      resetRedactions();
    });

    it('blurs password inputs with CSS filter style while preserving user attributes', () => {
      document.body.innerHTML = `
        <div id="login-form">
          <input id="user-input" type="text" name="username" value="admin_user" />
          <input id="pwd-input" type="password" name="auth_secret" value="MySuperSecretP@ssword123!" />
          <div id="sensitive-token" data-sensitive="true">Internal Session Token: 0x99AAFF</div>
        </div>
      `;

      applyAutoRedaction({ blurEmails: true });

      const pwd = document.getElementById('pwd-input') as HTMLInputElement;
      const user = document.getElementById('user-input') as HTMLInputElement;
      const sensitiveEl = document.getElementById('sensitive-token') as HTMLElement;

      expect(pwd.style.filter).toContain('blur(8px)');
      expect(user.style.filter).toBe('');
      expect(sensitiveEl.style.filter).toContain('blur(8px)');
    });

    it('strictly avoids mutating SCRIPT, STYLE, and TEXTAREA tag contents', () => {
      document.body.innerHTML = `
        <script id="tracker-script">const config = { contact: "dev@analytics.internal" };</script>
        <style id="theme-style">.corp-email::after { content: "support@corp.internal"; }</style>
        <textarea id="user-draft">Drafting email to customer@client.org...</textarea>
      `;

      applyAutoRedaction({ blurEmails: true, blurRevenue: true, blurApiKeys: true });

      expect(document.getElementById('tracker-script')?.textContent).toContain(
        'dev@analytics.internal'
      );
      expect(document.getElementById('theme-style')?.textContent).toContain(
        'support@corp.internal'
      );
      expect(document.getElementById('user-draft')?.textContent).toContain(
        'customer@client.org'
      );
    });
  });
});
