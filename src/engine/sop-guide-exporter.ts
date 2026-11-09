import { TelemetryData } from '../types/telemetry';

export class SopGuideExporter {
  public static generateMarkdownGuide(
    telemetry: TelemetryData,
    snapshots: { timestamp: number; dataUrl: string }[] = []
  ): string {
    const { metadata, clicks, keystrokes } = telemetry;
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

    // Merge and sequence events chronologically
    type StepEvent =
      | { type: 'click'; t: number; tag: string; text?: string; bounds?: { x: number; y: number } }
      | { type: 'key'; t: number; combo: string };

    const events: StepEvent[] = [
      ...clicks.map((c) => ({
        type: 'click' as const,
        t: c.t,
        tag: c.targetTag,
        text: c.targetText,
        bounds: c.containerBounds ? { x: c.containerBounds.x, y: c.containerBounds.y } : undefined
      })),
      ...keystrokes.map((k) => ({
        type: 'key' as const,
        t: k.t,
        combo: k.combo
      }))
    ].sort((a, b) => a.t - b.t);

    if (events.length === 0) {
      md += `*No discrete click or keyboard actions were recorded during this session.*\n\n`;
    }

    let stepNumber = 1;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const timeStr = (ev.t / 1000).toFixed(1) + 's';

      if (ev.type === 'click') {
        const actionLabel = ev.text ? `Click on **"${ev.text}"**` : `Click on the \`<${ev.tag}>\` element`;
        md += `### Step ${stepNumber}: ${actionLabel} \`[${timeStr}]\`\n\n`;
        md += `1. Locate the **${ev.tag.toUpperCase()}** component on the screen.\n`;
        md += `2. Perform a primary click action on ${ev.text ? `**"${ev.text}"**` : `the element`}.\n\n`;

        // If snapshot is available near this timestamp
        const nearestSnap = snapshots.find((s) => Math.abs(s.timestamp - ev.t) < 1500);
        if (nearestSnap) {
          md += `![Step ${stepNumber} Snapshot](${nearestSnap.dataUrl})\n\n`;
        }

        stepNumber++;
      } else if (ev.type === 'key') {
        md += `### Step ${stepNumber}: Press Shortcut \`${ev.combo}\` \`[${timeStr}]\`\n\n`;
        md += `1. Ensure the active window or target input is in focus.\n`;
        md += `2. Press the keyboard shortcut: \`${ev.combo}\`.\n\n`;
        stepNumber++;
      }
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
