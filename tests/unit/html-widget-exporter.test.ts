import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HtmlWidgetExporter } from '../../src/engine/html-widget-exporter';
import { TelemetryData } from '../../src/types/telemetry';
import * as exportSafety from '../../src/engine/export-safety';

function createMockTelemetry(overrides: Partial<TelemetryData> = {}): TelemetryData {
  return {
    metadata: {
      id: 'session-test-1',
      sessionId: 'session-test-1',
      startTime: 1000,
      endTime: 10000,
      durationMs: 9000,
      width: 1920,
      height: 1080,
      devicePixelRatio: 1,
      title: 'Admin Workflow Walkthrough',
      url: 'https://app.example.com/admin',
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
        targetText: 'Submit Form',
        targetLabel: 'Submit Form',
        containerBounds: { left: 450, top: 250, width: 100, height: 40 }
      }
    ],
    keystrokes: [],
    inputEvents: [],
    typingSessions: [],
    ...overrides
  };
}

describe('HtmlWidgetExporter', () => {
  describe('Privacy Redaction', () => {
    it('redacts email in targetLabel so it never leaks into widget HTML or JSON', () => {
      const telemetry = createMockTelemetry({
        clicks: [
          {
            t: 2000,
            x: 200,
            y: 300,
            button: 0,
            targetTag: 'input',
            targetText: '',
            targetLabel: 'contact.person@secretcompany.com',
            containerBounds: { left: 190, top: 290, width: 200, height: 30 }
          }
        ]
      });

      const html = HtmlWidgetExporter.generateInteractiveWidget(telemetry, [], true);

      expect(html).not.toContain('contact.person@secretcompany.com');
      expect(html).not.toContain('secretcompany.com');
      expect(html).toContain('[hidden input]');
    });

    it('redacts revenue figures in targetLabel and targetText', () => {
      const telemetry = createMockTelemetry({
        clicks: [
          {
            t: 2000,
            x: 200,
            y: 300,
            button: 0,
            targetTag: 'button',
            targetText: 'Approve $1,250,000 ARR Payment',
            targetLabel: 'Approve $1,250,000 ARR Payment',
            containerBounds: { left: 190, top: 290, width: 200, height: 30 }
          }
        ]
      });

      const html = HtmlWidgetExporter.generateInteractiveWidget(telemetry, [], true);

      expect(html).not.toContain('1,250,000');
      expect(html).not.toContain('$1,250,000');
    });

    it('redacts API keys in targetLabel and targetText', () => {
      const telemetry = createMockTelemetry({
        clicks: [
          {
            t: 2000,
            x: 200,
            y: 300,
            button: 0,
            targetTag: 'button',
            targetText: 'sk\u005flive_1234567890abcdef1234',
            targetLabel: 'sk\u005flive_1234567890abcdef1234',
            containerBounds: { left: 190, top: 290, width: 200, height: 30 }
          }
        ]
      });

      const html = HtmlWidgetExporter.generateInteractiveWidget(telemetry, [], true);

      expect(html).not.toContain('sk\u005flive_1234567890abcdef1234');
      expect(html).toContain('[hidden input]');
    });

    it('redacts sensitive metadata.title when autoBlur is active', () => {
      const telemetry = createMockTelemetry({
        metadata: {
          ...createMockTelemetry().metadata,
          title: 'Q4 Financial Review: $5,000,000 ARR & CFO alice@company.com'
        }
      });

      const html = HtmlWidgetExporter.generateInteractiveWidget(telemetry, [], true);

      expect(html).not.toContain('5,000,000');
      expect(html).not.toContain('alice@company.com');
    });

    it('respects category blur options when selectively disabled', () => {
      const telemetry = createMockTelemetry({
        clicks: [
          {
            t: 2000,
            x: 200,
            y: 300,
            button: 0,
            targetTag: 'button',
            targetText: '$250,000 Milestone',
            targetLabel: '$250,000 Milestone',
            containerBounds: { left: 190, top: 290, width: 200, height: 30 }
          }
        ]
      });

      // Disable blurRevenue, enable blurEmails
      const html = HtmlWidgetExporter.generateInteractiveWidget(
        telemetry,
        [],
        { blurEmails: true, blurRevenue: false, blurApiKeys: true }
      );

      // Revenue is allowed since blurRevenue is explicitly disabled
      expect(html).toContain('$250,000');
    });
  });

  describe('HTML & Script Injection Safety', () => {
    it('escapes metadata.title in HTML markup', () => {
      const telemetry = createMockTelemetry({
        metadata: {
          ...createMockTelemetry().metadata,
          title: 'Portal <img src=x onerror=alert(1)> & "Settings"'
        }
      });

      const html = HtmlWidgetExporter.generateInteractiveWidget(telemetry, [], false);

      expect(html).not.toContain('<img src=x onerror=alert(1)>');
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
      expect(html).toContain('&amp; &quot;Settings&quot;');
    });

    it('escapes rendered initial step description in HTML markup', () => {
      const telemetry = createMockTelemetry({
        clicks: [
          {
            t: 1000,
            x: 100,
            y: 100,
            button: 0,
            targetTag: 'b',
            targetText: undefined,
            targetLabel: undefined,
            containerBounds: { left: 90, top: 90, width: 20, height: 20 }
          }
        ]
      });

      const html = HtmlWidgetExporter.generateInteractiveWidget(telemetry, [], false);

      // Default title without label/text is `Click <b>`
      // In HTML markup it must be escaped as `Click &lt;b&gt;` so it does not render as a bold tag
      expect(html).toContain('&lt;b&gt;');
    });

    it('uses serializeForInlineScript so script tags in step text cannot break out of <script>', () => {
      const telemetry = createMockTelemetry({
        clicks: [
          {
            t: 1000,
            x: 100,
            y: 100,
            button: 0,
            targetTag: 'button',
            targetText: 'Inject </script><script>alert("injected")</script>',
            targetLabel: 'Inject </script><script>alert("injected")</script>',
            containerBounds: { left: 90, top: 90, width: 20, height: 20 }
          }
        ]
      });

      const html = HtmlWidgetExporter.generateInteractiveWidget(telemetry, [], false);

      // The script payload must not contain raw </script>
      const scriptBlockMatch = html.match(/<script>([\s\S]*?)<\/script>/);
      expect(scriptBlockMatch).not.toBeNull();
      const scriptContent = scriptBlockMatch![1];
      expect(scriptContent).not.toContain('</script>');
      expect(scriptContent).toContain('\\u003c/script\\u003e');
    });
  });

  describe('Snapshot Capping (3000ms max distance)', () => {
    it('attaches snapshot within 3000ms of click timestamp', () => {
      const telemetry = createMockTelemetry({
        clicks: [
          {
            t: 5000,
            x: 500,
            y: 500,
            button: 0,
            targetTag: 'button',
            targetText: 'Next',
            targetLabel: 'Next',
            containerBounds: { left: 490, top: 490, width: 50, height: 30 }
          }
        ]
      });
      const snapshots = [
        { timestamp: 6200, dataUrl: 'data:image/jpeg;base64,validSnap' }
      ];

      const html = HtmlWidgetExporter.generateInteractiveWidget(telemetry, snapshots);

      expect(html).toContain('data:image/jpeg;base64,validSnap');
    });

    it('rejects distant snapshots > 3000ms away to prevent unrelated screens', () => {
      const telemetry = createMockTelemetry({
        clicks: [
          {
            t: 180_000, // 3 minutes into recording
            x: 500,
            y: 500,
            button: 0,
            targetTag: 'button',
            targetText: 'Finish',
            targetLabel: 'Finish',
            containerBounds: { left: 490, top: 490, width: 50, height: 30 }
          }
        ]
      });
      const snapshots = [
        { timestamp: 2000, dataUrl: 'data:image/jpeg;base64,oldSnapFromStart' }
      ];

      const html = HtmlWidgetExporter.generateInteractiveWidget(telemetry, snapshots);

      // Distant snapshot must NOT be attached
      expect(html).not.toContain('data:image/jpeg;base64,oldSnapFromStart');
    });
  });

  describe('Coordinate NaN Guards', () => {
    it('calculates valid percentage when dimensions are valid', () => {
      const telemetry = createMockTelemetry({
        metadata: {
          ...createMockTelemetry().metadata,
          width: 1000,
          height: 500
        },
        clicks: [
          {
            t: 1000,
            x: 250,
            y: 100,
            button: 0,
            targetTag: 'button',
            targetText: 'Target',
            targetLabel: 'Target',
            containerBounds: { left: 240, top: 90, width: 50, height: 30 }
          }
        ]
      });

      const html = HtmlWidgetExporter.generateInteractiveWidget(telemetry);

      expect(html).toContain('left: 25.0%');
      expect(html).toContain('top: 20.0%');
    });

    it('guards against 0 or missing dimensions without producing NaN or Infinity', () => {
      const telemetry = createMockTelemetry({
        metadata: {
          ...createMockTelemetry().metadata,
          width: 0,
          height: 0
        },
        clicks: [
          {
            t: 1000,
            x: 250,
            y: 100,
            button: 0,
            targetTag: 'button',
            targetText: 'Target',
            targetLabel: 'Target',
            containerBounds: { left: 240, top: 90, width: 50, height: 30 }
          }
        ]
      });

      const html = HtmlWidgetExporter.generateInteractiveWidget(telemetry);

      expect(html).not.toContain('NaN');
      expect(html).not.toContain('Infinity');
      // Falls back to safe 50.0%
      expect(html).toContain('left: 50.0%');
      expect(html).toContain('top: 50.0%');
    });
  });

  describe('downloadWidget', () => {
    it('schedules deferred object URL revocation via scheduleObjectUrlRevoke', () => {
      const scheduleSpy = vi.spyOn(exportSafety, 'scheduleObjectUrlRevoke');
      const createObjectURLMock = vi.fn().mockReturnValue('blob:widget-test');
      URL.createObjectURL = createObjectURLMock;

      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      try {
        HtmlWidgetExporter.downloadWidget('<html>test</html>', 'test.html');

        expect(clickSpy).toHaveBeenCalled();
        expect(scheduleSpy).toHaveBeenCalledWith('blob:widget-test');
      } finally {
        scheduleSpy.mockRestore();
        clickSpy.mockRestore();
      }
    });
  });
});
