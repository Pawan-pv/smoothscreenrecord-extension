import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyAutoRedaction,
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
    it('selectively redacts DOM text nodes in-memory within a sub-30ms performance target', () => {
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

      // Measure execution duration for DOM TreeWalker mutation
      const start = performance.now();
      applyAutoRedaction({ blurEmails: true, blurRevenue: true, blurApiKeys: true });
      const durationMs = performance.now() - start;

      // Rigid sub-30ms execution requirement
      expect(durationMs).toBeLessThan(30);

      // Verify specific redacted fields
      expect(document.getElementById('account-holder')?.textContent).toBe(
        'Account Owner: ••••••@••••.com'
      );
      expect(document.getElementById('arr-val')?.textContent).toBe('$••,•••');
      expect(document.getElementById('prod-key')?.textContent).toBe('••••••••••••••••');

      // Verify structural preservation of non-sensitive elements
      expect(document.getElementById('page-title')?.textContent).toBe('Financial Overview');
      expect(document.getElementById('seat-count')?.textContent).toBe('45 active seats');
      expect(document.getElementById('footer-copy')?.textContent).toBe(
        'All rights reserved © 2026 Enterprise Inc.'
      );

      // Verify data-redacted attribute markers
      expect(document.getElementById('account-holder')?.getAttribute('data-redacted')).toBe('true');
      expect(document.getElementById('arr-val')?.getAttribute('data-redacted')).toBe('true');
      expect(document.getElementById('prod-key')?.getAttribute('data-redacted')).toBe('true');
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
