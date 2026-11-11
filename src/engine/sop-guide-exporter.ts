import { TelemetryData, TypingSession } from '../types/telemetry';
import {
  redactTextString,
  isSensitiveString,
  EMAIL_DETECT,
  REVENUE_DETECT,
  API_KEY_DETECT
} from '../content/privacy-redactor';

interface Snapshot {
  timestamp: number;
  dataUrl: string;
}

type SopStep =
  | { kind: 'click'; t: number; tag: string; text?: string; label?: string }
  | { kind: 'type'; t: number; endT: number; text: string; sensitive: boolean; label: string; tag: string }
  | { kind: 'shortcut'; t: number; combo: string };

const TYPING_ABSORB_WINDOW_MS = 3000;

interface BlurOptions {
  blurEmails: boolean;
  blurRevenue: boolean;
  blurApiKeys: boolean;
}

/**
 * Masks a string ONLY when it is actually sensitive.
 * Sensitive means: the source already flagged it as a hidden input, or the
 * text matches the email / API key / revenue patterns.
 * Normal text such as a git branch name must stay readable.
 */
function maskIfSensitive(
  text: string | undefined,
  alreadyHidden: boolean,
  blur: BlurOptions
): { text: string; hidden: boolean } {
  if (!text) return { text: '', hidden: false };
  if (alreadyHidden || text === '[hidden input]') {
    return { text: '[hidden input]', hidden: true };
  }
  const patternHit =
    (blur.blurEmails && EMAIL_DETECT.test(text)) ||
    (blur.blurRevenue && REVENUE_DETECT.test(text)) ||
    (blur.blurApiKeys && API_KEY_DETECT.test(text)) ||
    /(password|secret|sk_live_|bearer\s+)/i.test(text);
  if (patternHit || isSensitiveString(text)) {
    const redacted = redactTextString(text);
    return { text: redacted.includes('••••') ? '[hidden input]' : redacted, hidden: true };
  }
  return { text, hidden: false };
}

export class SopGuideExporter {
  public static generateMarkdownGuide(
    telemetry: TelemetryData,
    snapshots: Snapshot[] = [],
    autoBlur: boolean | { blurEmails?: boolean; blurRevenue?: boolean; blurApiKeys?: boolean } = true
  ): string {
    // `autoBlur` only controls which patterns are redacted. It NEVER blanks out
    // ordinary content: masking is driven by the sensitivity of the value.
    const blurOptions = typeof autoBlur === 'boolean'
      ? { blurEmails: autoBlur, blurRevenue: autoBlur, blurApiKeys: autoBlur }
      : {
          blurEmails: Boolean(autoBlur?.blurEmails),
          blurRevenue: Boolean(autoBlur?.blurRevenue),
          blurApiKeys: Boolean(autoBlur?.blurApiKeys)
        };

    const { metadata, clicks, keystrokes } = telemetry;
    const typingSessions: TypingSession[] = telemetry.typingSessions || [];
    const durationSec = (metadata.durationMs / 1000).toFixed(1);
    const dateStr = new Date(metadata.startTime).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

    let md = `# Standard Operating Procedure (SOP): ${metadata.title}\n\n`;
    md += `> **Source URL**: [${metadata.url || 'Web Application'}](${metadata.url || '#'})\n`;
    md += `> **Recorded On**: ${dateStr} | **Duration**: ${durationSec}s | **Actions**: ${clicks.length} clicks, ${keystrokes.length} keystrokes\n\n`;
    md += `---\n\n`;
    md += `## 📋 Overview\n`;
    md += `This step-by-step walkthrough was automatically captured using **SmoothStudio**. Follow the sequential actions below to execute this procedure.\n\n`;
    md += `## 🛠️ Step-by-Step Execution Guide\n\n`;

    // ------------------------------------------------------------------
    // Build the step list: clicks, grouped typing bursts and shortcuts.
    // ------------------------------------------------------------------
    const steps: SopStep[] = [];

    clicks.forEach((c) => {
      steps.push({
        kind: 'click',
        t: c.t,
        tag: c.targetTag,
        text: c.targetText,
        label: c.targetLabel
      });
    });

    // Keystrokes that belong to a typing burst are consumed by that burst.
    const consumedKeystrokeTimes = new Set<number>();
    typingSessions.forEach((s) => {
      keystrokes.forEach((k) => {
        if (k.t >= s.t - 60 && k.t <= s.endT + 60 && k.key && k.key.length === 1) {
          consumedKeystrokeTimes.add(k.t);
        }
      });
      steps.push({
        kind: 'type',
        t: s.t,
        endT: s.endT,
        text: s.text,
        sensitive: s.sensitive,
        label: s.targetLabel,
        tag: s.targetTag
      });
    });

    keystrokes.forEach((k) => {
      if (consumedKeystrokeTimes.has(k.t)) return;
      steps.push({ kind: 'shortcut', t: k.t, combo: k.combo });
    });

    // A click that only focuses a field which is then typed into is redundant:
    // the typing step already names the field. Drop it.
    const filteredSteps = steps.filter((step) => {
      if (step.kind !== 'click') return true;
      const isField = ['input', 'textarea'].includes(step.tag.toLowerCase());
      if (!isField) return true;
      const absorbed = typingSessions.some(
        (s) => s.t >= step.t - 200 && s.t <= step.t + TYPING_ABSORB_WINDOW_MS
      );
      return !absorbed;
    });

    filteredSteps.sort((a, b) => a.t - b.t);

    if (filteredSteps.length === 0) {
      md += `*No discrete click or keyboard actions were recorded during this session.*\n\n`;
    }

    const findSnapshot = (t: number): Snapshot | undefined => {
      if (snapshots.length === 0) return undefined;
      let best: Snapshot | undefined;
      let bestDelta = Infinity;
      for (const s of snapshots) {
        const d = Math.abs(s.timestamp - t);
        if (d < bestDelta) {
          bestDelta = d;
          best = s;
        }
      }
      return best;
    };

    let stepNumber = 1;
    for (const step of filteredSteps) {
      const timeStr = (step.t / 1000).toFixed(1) + 's';

      if (step.kind === 'click') {
        const masked = maskIfSensitive(step.text, false, blurOptions);
        const target = masked.hidden
          ? '**[hidden input]**'
          : (step.text ? `**"${step.text}"**` : `the **${step.tag.toUpperCase()}** element`);
        const label = step.label && step.label !== '[hidden input]' ? ` (${step.label})` : '';
        md += `### Step ${stepNumber}: Click on ${target}${label} \`[${timeStr}]\`\n\n`;
        md += `1. Locate the **${step.tag.toUpperCase()}** component on the screen.\n`;
        md += `2. Perform a primary click action on ${masked.hidden ? '**[hidden input]**' : (step.text ? `**"${step.text}"**` : 'the element')}.\n\n`;
      } else if (step.kind === 'type') {
        if (step.sensitive) {
          md += `### Step ${stepNumber}: Enter \`[hidden input]\` into \`[hidden input]\` \`[${timeStr}]\`\n\n`;
          md += `1. Ensure the sensitive field is in focus.\n`;
          md += `2. Enter the value. It is intentionally not recorded.\n\n`;
        } else {
          const masked = maskIfSensitive(step.text, false, blurOptions);
          const fieldName = step.label || step.tag;
          md += `### Step ${stepNumber}: Type **"${masked.text}"** into **"${fieldName}"** \`[${timeStr}]\`\n\n`;
          md += `1. Click the **${fieldName}** field to focus it.\n`;
          md += `2. Type **${masked.text}**.\n\n`;
        }
      } else {
        const masked = maskIfSensitive(step.combo, step.combo === '[hidden input]', blurOptions);
        md += `### Step ${stepNumber}: Press Shortcut \`${masked.text}\` \`[${timeStr}]\`\n\n`;
        md += `1. Ensure the active window or target input is in focus.\n`;
        md += `2. Press the keyboard shortcut: \`${masked.text}\`.\n\n`;
      }

      const snap = findSnapshot(step.t);
      if (snap) {
        md += `![Step ${stepNumber} Snapshot](${snap.dataUrl})\n\n`;
      }

      stepNumber++;
    }

    md += `---\n\n`;
    md += `*Generated automatically by [SmoothStudio](https://github.com/smoothscreenrecord) — $0 Server Cost Screen Studio.*`;

    return md;
  }

  public static downloadMarkdown(markdownContent: string, filename = 'SOP_Guide.md') {
    const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8;' });
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
