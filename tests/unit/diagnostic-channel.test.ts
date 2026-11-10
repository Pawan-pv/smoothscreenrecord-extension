import { describe, it, expect, beforeEach, vi } from 'vitest';
import { diagnosticChannel } from '../../src/engine/diagnostic-channel';

describe('DiagnosticDataChannel', () => {
  beforeEach(() => {
    diagnosticChannel.clearDegradation();
  });

  it('subscribes to degradation events and invokes callback', () => {
    const listener = vi.fn();
    const unsubscribe = diagnosticChannel.subscribe(listener);

    diagnosticChannel.reportDegradation({
      source: 'webcodecs',
      severity: 'critical',
      title: 'Encoder Lag',
      message: 'Dropped 5 frames'
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].source).toBe('webcodecs');
    expect(listener.mock.calls[0][0].severity).toBe('critical');

    unsubscribe();
  });

  it('immediately transmits existing active degradations to newly subscribed listeners', () => {
    diagnosticChannel.reportDegradation({
      source: 'opfs',
      severity: 'critical',
      title: 'Disk Quota Full',
      message: 'No space remaining'
    });

    const lateListener = vi.fn();
    diagnosticChannel.subscribe(lateListener);

    expect(lateListener).toHaveBeenCalledTimes(1);
    expect(lateListener.mock.calls[0][0].source).toBe('opfs');
  });

  it('clears degradation by source', () => {
    diagnosticChannel.reportDegradation({
      source: 'opfs',
      severity: 'critical',
      title: 'Disk Error',
      message: 'Failed to write chunk'
    });

    expect(diagnosticChannel.getActiveDegradations().length).toBe(1);

    diagnosticChannel.clearDegradation('opfs');
    expect(diagnosticChannel.getActiveDegradations().length).toBe(0);
  });

  it('swaps storage mode and encoder mode gracefully', () => {
    expect(diagnosticChannel.getStorageMode()).toBe('opfs');
    diagnosticChannel.setStorageMode('ram');
    expect(diagnosticChannel.getStorageMode()).toBe('ram');

    expect(diagnosticChannel.getEncoderStreamMode()).toBe('hardware-mp4');
    diagnosticChannel.setEncoderStreamMode('client-webm');
    expect(diagnosticChannel.getEncoderStreamMode()).toBe('client-webm');
  });
});
