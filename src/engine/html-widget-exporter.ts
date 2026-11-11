import { TelemetryData } from '../types/telemetry';
import { redactTextString, isSensitiveString } from '../content/privacy-redactor';

export class HtmlWidgetExporter {
  public static generateInteractiveWidget(
    telemetry: TelemetryData,
    snapshots: { timestamp: number; dataUrl: string }[] = [],
    autoBlur: boolean | { blurEmails?: boolean; blurRevenue?: boolean; blurApiKeys?: boolean } = true
  ): string {
    const isAutoBlurOn = typeof autoBlur === 'boolean'
      ? autoBlur
      : Boolean(autoBlur?.blurEmails || autoBlur?.blurRevenue || autoBlur?.blurApiKeys);

    const { metadata, clicks } = telemetry;

    const steps = clicks.map((c, idx) => {
      let snap = snapshots.find((s) => Math.abs(s.timestamp - c.t) < 2500);
      if (!snap && snapshots.length > 0) {
        snap = [...snapshots].sort((a, b) => Math.abs(a.timestamp - c.t) - Math.abs(b.timestamp - c.t))[0];
      }
      // Mask ONLY genuinely sensitive values. Ordinary labels stay readable.
      const raw = c.targetText;
      const sensitive = !raw || raw === '[hidden input]' || (isAutoBlurOn && isSensitiveString(raw));
      let safeText = raw;
      if (sensitive) {
        safeText = redactTextString(raw || '');
        if (!raw || raw === '[hidden input]' || safeText.includes('••••')) {
          safeText = '[hidden input]';
        }
      }
      const label = c.targetLabel && c.targetLabel !== '[hidden input]' ? c.targetLabel : undefined;
      return {
        step: idx + 1,
        title: label
          ? `Click "${label.slice(0, 30)}"`
          : (safeText ? `Click "${safeText.slice(0, 30)}"` : `Click <${c.targetTag}>`),
        xPercent: ((c.x / metadata.width) * 100).toFixed(1),
        yPercent: ((c.y / metadata.height) * 100).toFixed(1),
        img: snap?.dataUrl || ''
      };
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Interactive Walkthrough — ${metadata.title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0B0C10;
      color: #F3F4F6;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .container {
      width: 100%;
      max-width: 1100px;
      background: #14161D;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.7);
    }
    .header {
      padding: 16px 24px;
      background: rgba(255, 255, 255, 0.03);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .title { font-size: 16px; font-weight: 600; }
    .progress-pill {
      background: rgba(139, 92, 246, 0.2);
      color: #C4B5FD;
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 500;
    }
    .viewport {
      position: relative;
      width: 100%;
      aspect-ratio: 16 / 9;
      background: #000;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .slide-image {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .empty-placeholder {
      color: #9CA3AF;
      font-size: 14px;
      text-align: center;
      padding: 40px;
    }
    /* Pulsing Interactive Hotspot */
    .hotspot {
      position: absolute;
      width: 38px;
      height: 38px;
      transform: translate(-50%, -50%);
      cursor: pointer;
      z-index: 10;
    }
    .hotspot-ring {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 3px solid #8B5CF6;
      animation: pulse-ring 1.6s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
    }
    .hotspot-dot {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 14px;
      height: 14px;
      background: #8B5CF6;
      border: 2px solid #FFF;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      box-shadow: 0 0 15px rgba(139, 92, 246, 0.8);
    }
    @keyframes pulse-ring {
      0% { transform: scale(0.6); opacity: 1; }
      100% { transform: scale(2.2); opacity: 0; }
    }
    .footer {
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
    .step-desc { font-size: 14px; color: #D1D5DB; }
    .btn {
      background: #8B5CF6;
      color: white;
      border: none;
      padding: 8px 18px;
      border-radius: 8px;
      font-weight: 500;
      font-size: 13px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn:hover { background: #7C3AED; }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="title">${metadata.title}</div>
      <div class="progress-pill" id="step-pill">Step 1 of ${steps.length || 1}</div>
    </div>
    <div class="viewport" id="viewport">
      <img id="step-img" class="slide-image" src="${steps[0]?.img || ''}" alt="Step Preview" style="${steps[0]?.img ? '' : 'display:none;'}" />
      <div id="placeholder" class="empty-placeholder" style="${steps[0]?.img ? 'display:none;' : ''}">
        Interactive Hotspot Walkthrough<br><small style="color:#6B7280;">Click the pulsing target below to proceed</small>
      </div>
      <div class="hotspot" id="hotspot" style="left: ${steps[0]?.xPercent || 50}%; top: ${steps[0]?.yPercent || 50}%;">
        <div class="hotspot-ring"></div>
        <div class="hotspot-dot"></div>
      </div>
    </div>
    <div class="footer">
      <div class="step-desc" id="step-desc">${steps[0]?.title || 'Follow the highlighted steps.'}</div>
      <div style="display:flex; gap:8px;">
        <button class="btn" id="prev-btn" onclick="prevStep()" disabled>Previous</button>
        <button class="btn" id="next-btn" onclick="nextStep()">Next Step</button>
      </div>
    </div>
  </div>

  <script>
    const steps = window.steps = ${JSON.stringify(steps)};
    let currentIdx = 0;

    function renderStep() {
      if (!steps || steps.length === 0) return;
      const s = steps[currentIdx];
      document.getElementById('step-pill').innerText = 'Step ' + (currentIdx + 1) + ' of ' + steps.length;
      document.getElementById('step-desc').innerText = s.title;

      const img = document.getElementById('step-img');
      const placeholder = document.getElementById('placeholder');
      if (s.img) {
        img.src = s.img;
        img.style.display = 'block';
        placeholder.style.display = 'none';
      } else {
        img.style.display = 'none';
        placeholder.style.display = 'block';
      }

      const hotspot = document.getElementById('hotspot');
      hotspot.style.left = s.xPercent + '%';
      hotspot.style.top = s.yPercent + '%';

      document.getElementById('prev-btn').disabled = currentIdx === 0;
      document.getElementById('next-btn').disabled = currentIdx === steps.length - 1;
    }

    function nextStep() {
      if (currentIdx < steps.length - 1) {
        currentIdx++;
        renderStep();
      }
    }

    function prevStep() {
      if (currentIdx > 0) {
        currentIdx--;
        renderStep();
      }
    }

    document.getElementById('hotspot').addEventListener('click', nextStep);
  </script>
</body>
</html>`;
  }

  public static downloadWidget(htmlContent: string, filename = 'Interactive_Walkthrough.html') {
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }
}
