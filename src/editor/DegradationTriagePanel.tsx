import React from 'react';
import {
  AlertTriangle,
  HardDrive,
  Cpu,
  CheckCircle2,
  X,
  ShieldAlert,
  ArrowRight,
  Activity,
  Layers
} from 'lucide-react';
import { SystemDegradationEvent } from '../engine/diagnostic-channel';

export interface DegradationTriagePanelProps {
  activeDegradation: SystemDegradationEvent | null;
  onDismiss: () => void;
  storageMode: 'opfs' | 'ram';
  onToggleRamFallback: () => void;
  encoderStreamMode: 'hardware-mp4' | 'client-webm';
  onDowngradeEncoderStream: () => void;
  onOpenFlightDoctor?: () => void;
}

export function DegradationTriagePanel({
  activeDegradation,
  onDismiss,
  storageMode,
  onToggleRamFallback,
  encoderStreamMode,
  onDowngradeEncoderStream,
  onOpenFlightDoctor
}: DegradationTriagePanelProps) {
  if (!activeDegradation) return null;

  const isOpfsCap = activeDegradation.source === 'opfs';
  const isWebCodecsDrop = activeDegradation.source === 'webcodecs';

  return (
    <div
      className="fixed top-20 right-6 z-40 w-[460px] max-w-[calc(100vw-3rem)] ss-panel border border-[#FBBF24]/35 rounded-2xl shadow-ss-panel p-5 flex flex-col gap-4 text-studio-text select-none ss-sheet-enter ring-1 ring-[#FBBF24]/15"
      role="alert"
      aria-live="assertive"
    >
      {/* Header Banner */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#FBBF24]/15 border border-[#FBBF24]/40 flex items-center justify-center text-[#FBBF24] shrink-0">
            <AlertTriangle className="w-5 h-5 animate-pulse" strokeWidth={1.75} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="ss-status-badge text-[#FCD34D] border-[#FBBF24]/35 bg-[#FBBF24]/12">
                System Degradation
              </span>
              <span className="ss-num text-[10px] text-studio-muted">
                {new Date(activeDegradation.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <h3 className="text-sm font-semibold text-studio-text mt-1 leading-snug">
              {activeDegradation.title}
            </h3>
          </div>
        </div>

        <button
          onClick={onDismiss}
          className="p-1 rounded-lg hover:bg-studio-cardHover text-studio-muted hover:text-studio-text transition-colors"
          title="Dismiss warning"
          aria-label="Dismiss warning"
        >
          <X className="w-4 h-4" strokeWidth={1.75} />
        </button>
      </div>

      {/* Message and Engine Telemetry Details */}
      <div className="bg-black/40 border border-studio-border rounded-xl p-3 text-xs space-y-1.5">
        <p className="text-[#E2E8F0] leading-relaxed font-normal">
          {activeDegradation.message}
        </p>
        {activeDegradation.details && (
          <div className="pt-1.5 border-t border-studio-border ss-num text-[11px] text-[#FDE68A]/80 break-words flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-[#FBBF24] shrink-0" strokeWidth={1.75} />
            <span>Telemetry detail: {activeDegradation.details}</span>
          </div>
        )}
      </div>

      {/* Current System Pipeline Diagnostics */}
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="ss-card p-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[#CBD5E1]">
            <HardDrive className="w-3.5 h-3.5 text-[#818CF8]" strokeWidth={1.75} />
            <span>Storage Buffer:</span>
          </div>
          <span
            className={`ss-num px-2 py-0.5 rounded text-[10px] ${
              storageMode === 'ram'
                ? 'bg-[#34D399]/12 text-[#6EE7B7] border border-[#34D399]/30'
                : isOpfsCap
                ? 'bg-[#FBBF24]/15 text-[#FCD34D] border border-[#FBBF24]/30'
                : 'bg-white/10 text-[#CBD5E1]'
            }`}
          >
            {storageMode === 'ram' ? 'In-Memory RAM' : 'OPFS Disk'}
          </span>
        </div>

        <div className="ss-card p-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[#CBD5E1]">
            <Cpu className="w-3.5 h-3.5 text-[#38BDF8]" strokeWidth={1.75} />
            <span>Encoder Engine:</span>
          </div>
          <span
            className={`ss-num px-2 py-0.5 rounded text-[10px] ${
              encoderStreamMode === 'client-webm'
                ? 'bg-[#34D399]/12 text-[#6EE7B7] border border-[#34D399]/30'
                : isWebCodecsDrop
                ? 'bg-[#FBBF24]/15 text-[#FCD34D] border border-[#FBBF24]/30'
                : 'bg-white/10 text-[#CBD5E1]'
            }`}
          >
            {encoderStreamMode === 'client-webm' ? 'Pure WebM' : 'H.264 GPU'}
          </span>
        </div>
      </div>

      {/* Safe Fail-over Paths Action Group */}
      <div className="space-y-2 pt-1 border-t border-studio-border">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-studio-muted block">
          Safe Fail-Over Recovery Paths
        </span>

        {/* 1. Toggle RAM Fallback Buffer */}
        <button
          onClick={onToggleRamFallback}
          className={`ss-btn w-full p-2.5 rounded-xl text-xs justify-between ${
            storageMode === 'ram'
              ? 'bg-[#34D399]/12 border-[#34D399]/40 text-[#A7F3D0]'
              : 'bg-studio-card border-studio-border hover:bg-studio-cardHover text-studio-text hover:border-[#818CF8]/50'
          }`}
        >
          <div className="flex items-center gap-2.5 text-left">
            <div className="ss-brand-tile w-7 h-7 rounded-lg flex items-center justify-center shrink-0">
              <HardDrive className="w-4 h-4" strokeWidth={1.75} />
            </div>
            <div>
              <div className="font-medium flex items-center gap-1.5">
                Toggle RAM Fallback Buffer
                {storageMode === 'ram' && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-studio-success" strokeWidth={1.75} />
                )}
              </div>
              <p className="text-[10px] text-studio-muted">
                {storageMode === 'ram'
                  ? 'Active: Recording streams safely directly in system RAM arrays.'
                  : 'Swaps from disk-heavy OPFS to raw system memory arrays.'}
              </p>
            </div>
          </div>
          <span className="text-[11px] ss-num text-[#A5B4FC] shrink-0">
            {storageMode === 'ram' ? 'RAM Active' : 'Enable →'}
          </span>
        </button>

        {/* 2. Downgrade Encoder Stream */}
        <button
          onClick={onDowngradeEncoderStream}
          className={`ss-btn w-full p-2.5 rounded-xl text-xs justify-between ${
            encoderStreamMode === 'client-webm'
              ? 'bg-[#34D399]/12 border-[#34D399]/40 text-[#A7F3D0]'
              : 'bg-studio-card border-studio-border hover:bg-studio-cardHover text-studio-text hover:border-[#38BDF8]/50'
          }`}
        >
          <div className="flex items-center gap-2.5 text-left">
            <div className="w-7 h-7 rounded-lg bg-[#38BDF8]/12 border border-[#38BDF8]/30 flex items-center justify-center text-[#38BDF8] shrink-0">
              <Cpu className="w-4 h-4" strokeWidth={1.75} />
            </div>
            <div>
              <div className="font-medium flex items-center gap-1.5">
                Downgrade Encoder Stream
                {encoderStreamMode === 'client-webm' && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-studio-success" strokeWidth={1.75} />
                )}
              </div>
              <p className="text-[10px] text-studio-muted">
                {encoderStreamMode === 'client-webm'
                  ? 'Active: Exporting pure WebM stream with zero hardware drop risk.'
                  : 'Swaps from hardware-accelerated H.264 MP4 to pure WebM client-side downloads.'}
              </p>
            </div>
          </div>
          <span className="text-[11px] ss-num text-[#7DD3FC] shrink-0">
            {encoderStreamMode === 'client-webm' ? 'WebM Active' : 'Enable →'}
          </span>
        </button>
      </div>

      {/* Footer Utility Actions */}
      <div className="flex items-center justify-between pt-1 border-t border-studio-border text-[11px]">
        {onOpenFlightDoctor ? (
          <button
            onClick={onOpenFlightDoctor}
            className="text-[#818CF8] hover:text-[#A5B4FC] flex items-center gap-1 underline-offset-2 hover:underline transition-colors"
          >
            <ShieldAlert className="w-3.5 h-3.5" strokeWidth={1.75} />
            Run Flight Doctor Probes
          </button>
        ) : (
          <span className="text-studio-meta text-[10px]">Telemetry Channel Live</span>
        )}

        <button
          onClick={onDismiss}
          className="ss-btn ss-btn-secondary px-3 py-1.5 text-xs"
        >
          Dismiss & Continue
        </button>
      </div>
    </div>
  );
}
