export type DegradationSource = 'webcodecs' | 'opfs' | 'webaudio' | 'canvas';
export type DegradationSeverity = 'warning' | 'critical';

export interface SystemDegradationEvent {
  id: string;
  source: DegradationSource;
  severity: DegradationSeverity;
  title: string;
  message: string;
  timestamp: number;
  details?: string;
  canFallbackToRam?: boolean;
  canDowngradeEncoder?: boolean;
}

type DegradationListener = (event: SystemDegradationEvent) => void;

class DiagnosticDataChannel {
  private listeners: Set<DegradationListener> = new Set();
  private activeDegradations: Map<string, SystemDegradationEvent> = new Map();
  private storageMode: 'opfs' | 'ram' = 'opfs';
  private encoderStreamMode: 'hardware-mp4' | 'client-webm' = 'hardware-mp4';
  private frameDropCount = 0;

  public subscribe(listener: DegradationListener): () => void {
    this.listeners.add(listener);
    // If there is an existing degradation, notify subscriber immediately
    for (const evt of this.activeDegradations.values()) {
      try {
        listener(evt);
      } catch (err) {
        console.error('[DiagnosticChannel] Listener error:', err);
      }
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  public reportDegradation(event: Omit<SystemDegradationEvent, 'id' | 'timestamp'>): SystemDegradationEvent {
    const fullEvent: SystemDegradationEvent = {
      ...event,
      id: `${event.source}_${Date.now()}`,
      timestamp: Date.now()
    };
    this.activeDegradations.set(event.source, fullEvent);
    this.notifyAll(fullEvent);
    return fullEvent;
  }

  public recordFrameDrop(errorDetail?: string): void {
    this.frameDropCount++;
    if (this.frameDropCount >= 1) {
      this.reportDegradation({
        source: 'webcodecs',
        severity: 'critical',
        title: 'Hardware Encoding Frame Drops Detected',
        message: `WebCodecs GPU pipeline dropped hardware encoding frames (${this.frameDropCount} detected). Local GPU may be throttled or saturated.`,
        canDowngradeEncoder: true,
        details: errorDetail || `Frame drop event count: ${this.frameDropCount}`
      });
    }
  }

  public recordStorageCap(errorDetail?: string): void {
    this.reportDegradation({
      source: 'opfs',
      severity: 'critical',
      title: 'OPFS Storage Quota / Permission Cap Reached',
      message: 'The local profile storage quota or permission boundary capped disk writes. Disk-heavy OPFS stream is degraded.',
      canFallbackToRam: true,
      details: errorDetail || 'Origin Private File System write stream encountered a storage cap or permission rejection.'
    });
  }

  public clearDegradation(source?: DegradationSource): void {
    if (source) {
      this.activeDegradations.delete(source);
      if (source === 'webcodecs') this.frameDropCount = 0;
    } else {
      this.activeDegradations.clear();
      this.frameDropCount = 0;
    }
  }

  public getActiveDegradations(): SystemDegradationEvent[] {
    return Array.from(this.activeDegradations.values());
  }

  public getStorageMode(): 'opfs' | 'ram' {
    return this.storageMode;
  }

  public setStorageMode(mode: 'opfs' | 'ram'): void {
    this.storageMode = mode;
  }

  public getEncoderStreamMode(): 'hardware-mp4' | 'client-webm' {
    return this.encoderStreamMode;
  }

  public setEncoderStreamMode(mode: 'hardware-mp4' | 'client-webm'): void {
    this.encoderStreamMode = mode;
  }

  private notifyAll(event: SystemDegradationEvent): void {
    this.listeners.forEach((l) => {
      try {
        l(event);
      } catch (err) {
        console.error('[DiagnosticChannel] Notification error:', err);
      }
    });
  }
}

export const diagnosticChannel = new DiagnosticDataChannel();
