import { TelemetryData, TypingSession } from '../types/telemetry';
import {
  findNearestSnapshot,
  scheduleObjectUrlRevoke,
  maskIfSensitive,
  BlurOptions
} from './export-safety';

interface Snapshot {
  timestamp: number;
  dataUrl: string;
}

type SopStep =
  | { kind: 'click'; t: number; tag: string; text?: string; label?: string }
  | { kind: 'type'; t: number; endT: number; text: string; sensitive: boolean; label: string; tag: string }
  | { kind: 'shortcut'; t: number; combo: string };

const TYPING_ABSORB_WINDOW_MS = 3000;

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
    // QA: the title is page-controlled text too; a revenue figure or an email
    // in the document title must not become the SOP heading.
    const safeTitle = maskIfSensitive(metadata.title, false, blurOptions).text
      || 'Screen Recording';
    const dateStr = new Date(metadata.startTime).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

    let md = `# Standard Operating Procedure (SOP): ${safeTitle}\n\n`;
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
    // Modifier combinations (Ctrl+K, Cmd+...) are NOT part of the typed text
    // and stay separate shortcut steps.
    const consumedKeystrokeTimes = new Set<number>();
    typingSessions.forEach((s) => {
      keystrokes.forEach((k) => {
        const isPlainCharacter = k.key && k.key.length === 1 && !k.combo.includes('+');
        if (isPlainCharacter && k.t >= s.t - 60 && k.t <= s.endT + 60) {
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

    const findSnapshot = (t: number): Snapshot | undefined =>
      // QA: never attach a screenshot from minutes away to a step.
      findNearestSnapshot(snapshots, t);

    let stepNumber = 1;
    for (const step of filteredSteps) {
      const timeStr = (step.t / 1000).toFixed(1) + 's';

      if (step.kind === 'click') {
        const masked = maskIfSensitive(step.text, false, blurOptions);
        const target = masked.hidden
          ? '**[hidden input]**'
          : (masked.text ? `**"${masked.text}"**` : `the **${step.tag.toUpperCase()}** element`);
        // QA: the label is page-controlled text and may itself contain an email,
        // a revenue figure or an API key. Redact it before it becomes a heading.
        const maskedLabel = maskIfSensitive(step.label, false, blurOptions);
        const label = maskedLabel.hidden
          ? ' ([hidden input])'
          : (maskedLabel.text ? ` (${maskedLabel.text})` : '');
        md += `### Step ${stepNumber}: Click on ${target}${label} \`[${timeStr}]\`\n\n`;
        md += `1. Locate the **${step.tag.toUpperCase()}** component on the screen.\n`;
        md += `2. Perform a primary click action on ${masked.hidden ? '**[hidden input]**' : (masked.text ? `**"${masked.text}"**` : 'the element')}.\n\n`;
      } else if (step.kind === 'type') {
        if (step.sensitive) {
          md += `### Step ${stepNumber}: Enter \`[hidden input]\` into \`[hidden input]\` \`[${timeStr}]\`\n\n`;
          md += `1. Ensure the sensitive field is in focus.\n`;
          md += `2. Enter the value. It is intentionally not recorded.\n\n`;
        } else {
          const masked = maskIfSensitive(step.text, false, blurOptions);
          const maskedLabel = maskIfSensitive(step.label, false, blurOptions);
          const fieldName = maskedLabel.text || step.tag;
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
    // QA: 60 s (or pagehide) instead of 1 s so a slow download is not cut off.
    scheduleObjectUrlRevoke(url);
  }
}
