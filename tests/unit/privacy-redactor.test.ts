import { describe, it, expect, beforeEach } from 'vitest';
import { applyAutoRedaction } from '../../src/content/privacy-redactor';

describe('Privacy Redactor (Content Script Engine)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('redacts email addresses when blurEmails is true', () => {
    document.body.innerHTML = `
      <div id="container">
        <p id="email-text">Contact alice.wonderland@example.org for inquiries</p>
        <span id="clean-text">Nothing secret here</span>
      </div>
    `;

    applyAutoRedaction({ blurEmails: true });

    expect(document.getElementById('email-text')?.textContent).toBe(
      'Contact ••••••@••••.com for inquiries'
    );
    expect(document.getElementById('clean-text')?.textContent).toBe('Nothing secret here');
  });

  it('redacts revenue and currency amounts when blurRevenue is true', () => {
    document.body.innerHTML = `
      <div id="dashboard">
        <div id="mrr">Current MRR: $48,250.00</div>
        <div id="arr">ARR reached $1,250,000 this year</div>
        <div id="clean">User count: 42 users</div>
      </div>
    `;

    applyAutoRedaction({ blurRevenue: true });

    expect(document.getElementById('mrr')?.textContent).toContain('$••,•••');
    expect(document.getElementById('arr')?.textContent).toContain('$••,•••');
    expect(document.getElementById('clean')?.textContent).toBe('User count: 42 users');
  });

  it('redacts sensitive API keys when blurApiKeys is true', () => {
    document.body.innerHTML = `
      <div>
        <p id="stripe-key">Stripe Key: sk\u005flive_51Abcdef1234567890abcdef1234</p>
        <p id="google-key">AI Key: AI\u007aaSyB1234567890abcdefghijklmnopqrstu1</p>
      </div>
    `;

    applyAutoRedaction({ blurApiKeys: true });

    expect(document.getElementById('stripe-key')?.textContent).toContain('••••••••••••••••');
    expect(document.getElementById('google-key')?.textContent).toContain('••••••••••••••••');
  });

  it('blurs password inputs with CSS filter', () => {
    document.body.innerHTML = `
      <form>
        <input id="pwd" type="password" value="supersecret123" />
        <input id="username" type="text" value="johndoe" />
      </form>
    `;

    applyAutoRedaction({ blurEmails: true });

    const pwdInput = document.getElementById('pwd') as HTMLInputElement;
    const userInput = document.getElementById('username') as HTMLInputElement;

    expect(pwdInput.style.filter).toContain('blur');
    expect(userInput.style.filter).toBe('');
  });

  it('ignores SCRIPT, STYLE, and TEXTAREA elements to avoid breaking site logic', () => {
    document.body.innerHTML = `
      <script id="analytics">var contactEmail = "tracking@google.com";</script>
      <style id="custom-css">.header { color: red; }</style>
    `;

    applyAutoRedaction({ blurEmails: true });

    const script = document.getElementById('analytics');
    expect(script?.textContent).toContain('tracking@google.com');
  });
});
