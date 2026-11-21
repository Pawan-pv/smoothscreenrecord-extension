import { describe, it, expect, vi } from 'vitest';
import { SopGuideExporter } from '../../src/engine/sop-guide-exporter';
import { TelemetryData } from '../../src/types/telemetry';
import * as exportSafety from '../../src/engine/export-safety';

function createMockTelemetry(overrides: Partial<TelemetryData> = {}): TelemetryData {
  return {
    metadata: {
      id: 'session-sop-1',
      sessionId: 'session-sop-1',
      startTime: 1000,
      endTime: 10000,
      durationMs: 9000,
      width: 1920,
      height: 1080,
      devicePixelRatio: 1,
      title: 'Billing Portal Walkthrough',
      url: 'https://app.example.com/billing',
      brandColors: {
        primary: '#8B5CF6',
        secondary: '#6366F1',
        accent: '#EC4899',
        background: '#0B0C10'
      }
    },
    mousePoints: [],
    clicks: [
      {
        t: 2000,
        x: 480,
        y: 270,
        button: 0,
        targetTag: 'button',
        targetText: 'Download Invoice',
        targetLabel: 'Download Invoice',
        containerBounds: { left: 450, top: 250, width: 100, height: 40 }
      }
    ],
    keystrokes: [],
    inputEvents: [],
    typingSessions: [],
    ...overrides
  };
}

describe('SopGuideExporter', () => {
  describe('Privacy Redaction', () => {
    it('redacts email in metadata.title so sensitive info is not in the SOP heading', () => {
      const telemetry = createMockTelemetry({
        metadata: {
          ...createMockTelemetry().metadata,
          title: 'Account Settings for ceo@supersecretcorp.com'
        }
      });

      const md = SopGuideExporter.generateMarkdownGuide(telemetry, [], true);

      expect(md).not.toContain('ceo@supersecretcorp.com');
      expect(md).toContain('[hidden input]');
    });

    it('redacts revenue and emails in click targetText and targetLabel', () => {
      const telemetry = createMockTelemetry({
        clicks: [
          {
            t: 2000,
            x: 200,
            y: 300,
            button: 0,
            targetTag: 'button',
            targetText: 'Pay $500,000 Invoice',
            targetLabel: 'Send receipt to billing.contact@corp.com',
            containerBounds: { left: 190, top: 290, width: 200, height: 30 }
          }
        ]
      });

      const md = SopGuideExporter.generateMarkdownGuide(telemetry, [], true);

      expect(md).not.toContain('500,000');
      expect(md).not.toContain('$500,000');
      expect(md).not.toContain('billing.contact@corp.com');
      expect(md).toContain('[hidden input]');
    });

    it('redacts API keys in click targets and typing sessions', () => {
      const telemetry = createMockTelemetry({
        clicks: [],
        typingSessions: [
          {
            t: 2000,
            endT: 3000,
            text: 'sk\u005flive_abcdef1234567890abcdef',
            sensitive: false,
            targetLabel: 'API Key Field',
            targetTag: 'input'
          }
        ]
      });

      const md = SopGuideExporter.generateMarkdownGuide(telemetry, [], true);

      expect(md).not.toContain('sk\u005flive_abcdef1234567890abcdef');
      expect(md).toContain('[hidden input]');
    });

    it('respects selective category blur options', () => {
      const telemetry = createMockTelemetry({
        clicks: [
          {
            t: 2000,
            x: 200,
            y: 300,
            button: 0,
            targetTag: 'button',
            targetText: 'Target $850,000 ARR',
            targetLabel: 'Target $850,000 ARR',
            containerBounds: { left: 190, top: 290, width: 200, height: 30 }
          }
        ]
      });

      // Disable blurRevenue
      const md = SopGuideExporter.generateMarkdownGuide(
        telemetry,
        [],
        { blurEmails: true, blurRevenue: false, blurApiKeys: true }
      );

      // Revenue is retained because blurRevenue is false
      expect(md).toContain('$850,000 ARR');
    });
  });

  describe('Snapshot Capping (3000ms max distance)', () => {
    it('attaches snapshot when within 3000ms distance cap', () => {
      const telemetry = createMockTelemetry({
        clicks: [
          {
            t: 4000,
            x: 200,
            y: 300,
            button: 0,
            targetTag: 'button',
            targetText: 'Confirm',
            targetLabel: 'Confirm',
            containerBounds: { left: 190, top: 290, width: 50, height: 30 }
          }
        ]
      });
      const snapshots = [
        { timestamp: 5000, dataUrl: 'data:image/jpeg;base64,validSnapshotNear' }
      ];

      const md = SopGuideExporter.generateMarkdownGuide(telemetry, snapshots);

      expect(md).toContain('data:image/jpeg;base64,validSnapshotNear');
    });

    it('rejects snapshot when delta exceeds 3000ms distance cap', () => {
      const telemetry = createMockTelemetry({
        clicks: [
          {
            t: 60_000, // 60 seconds into recording
            x: 200,
            y: 300,
            button: 0,
            targetTag: 'button',
            targetText: 'Confirm',
            targetLabel: 'Confirm',
            containerBounds: { left: 190, top: 290, width: 50, height: 30 }
          }
        ]
      });
      const snapshots = [
        { timestamp: 1000, dataUrl: 'data:image/jpeg;base64,farSnapshotAtStart' }
      ];

      const md = SopGuideExporter.generateMarkdownGuide(telemetry, snapshots);

      expect(md).not.toContain('data:image/jpeg;base64,farSnapshotAtStart');
    });
  });

  describe('downloadMarkdown', () => {
    it('schedules object URL revocation via scheduleObjectUrlRevoke', () => {
      const scheduleSpy = vi.spyOn(exportSafety, 'scheduleObjectUrlRevoke');
      const createObjectURLMock = vi.fn().mockReturnValue('blob:sop-test');
      URL.createObjectURL = createObjectURLMock;

      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      try {
        SopGuideExporter.downloadMarkdown('# SOP Test', 'test.md');

        expect(clickSpy).toHaveBeenCalled();
        expect(scheduleSpy).toHaveBeenCalledWith('blob:sop-test');
      } finally {
        scheduleSpy.mockRestore();
        clickSpy.mockRestore();
      }
    });
  });
});
