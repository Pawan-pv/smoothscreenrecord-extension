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
      className="fixed top-20 right-6 z-40 w-[460px] max-w-[calc(100vw-3rem)] bg-[#161822]/95 backdrop-blur-xl border border-amber-500/40 rounded-2xl shadow-2xl shadow-black/80 p-5 flex flex-col gap-4 text-white select-none animate-in fade-in slide-in-from-top-4 duration-300 ring-1 ring-amber-500/20"
      role="alert"
      aria-live="assertive"
    >
      {/* Header Banner */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
            <AlertTriangle className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                System Degradation
              </span>
              <span className="text-[10px] font-mono text-gray-400">
                {new Date(activeDegradation.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <h3 className="text-sm font-semibold text-white mt-1 leading-snug">
              {activeDegradation.title}
            </h3>
          </div>
        </div>

        <button
          onClick={onDismiss}
          className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
          title="Dismiss warning"
          aria-label="Dismiss warning"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Message and Engine Telemetry Details */}
      <div className="bg-black/40 border border-white/5 rounded-xl p-3 text-xs space-y-1.5">
        <p className="text-gray-200 leading-relaxed font-normal">
          {activeDegradation.message}
        </p>
        {activeDegradation.details && (
          <div className="pt-1.5 border-t border-white/5 font-mono text-[11px] text-amber-200/80 break-words flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Telemetry detail: {activeDegradation.details}</span>
          </div>
        )}
      </div>

      {/* Current System Pipeline Diagnostics */}
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-gray-300">
            <HardDrive className="w-3.5 h-3.5 text-purple-400" />
            <span>Storage Buffer:</span>
          </div>
          <span
            className={`font-mono px-2 py-0.5 rounded text-[10px] ${
              storageMode === 'ram'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : isOpfsCap
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'bg-white/10 text-gray-300'
            }`}
          >
            {storageMode === 'ram' ? 'In-Memory RAM' : 'OPFS Disk'}
          </span>
        </div>

        <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-gray-300">
            <Cpu className="w-3.5 h-3.5 text-sky-400" />
            <span>Encoder Engine:</span>
          </div>
          <span
            className={`font-mono px-2 py-0.5 rounded text-[10px] ${
              encoderStreamMode === 'client-webm'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : isWebCodecsDrop
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'bg-white/10 text-gray-300'
            }`}
          >
            {encoderStreamMode === 'client-webm' ? 'Pure WebM' : 'H.264 GPU'}
          </span>
        </div>
      </div>

      {/* Safe Fail-over Paths Action Group */}
      <div className="space-y-2 pt-1 border-t border-white/10">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 block">
          Safe Fail-Over Recovery Paths
        </span>

        {/* 1. Toggle RAM Fallback Buffer */}
        <button
          onClick={onToggleRamFallback}
          className={`w-full p-2.5 rounded-xl border text-xs flex items-center justify-between transition-all ${
            storageMode === 'ram'
              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200'
              : 'bg-white/5 border-white/10 hover:bg-white/10 text-white hover:border-purple-400/50'
          }`}
        >
          <div className="flex items-center gap-2.5 text-left">
            <div className="w-7 h-7 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-300 shrink-0">
              <HardDrive className="w-4 h-4" />
            </div>
            <div>
              <div className="font-medium flex items-center gap-1.5">
                Toggle RAM Fallback Buffer
                {storageMode === 'ram' && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                )}
              </div>
              <p className="text-[10px] text-gray-400">
                {storageMode === 'ram'
                  ? 'Active: Recording streams safely directly in system RAM arrays.'
                  : 'Swaps from disk-heavy OPFS to raw system memory arrays.'}
              </p>
            </div>
          </div>
          <span className="text-[11px] font-mono text-purple-300 shrink-0">
            {storageMode === 'ram' ? 'RAM Active' : 'Enable →'}
          </span>
        </button>

        {/* 2. Downgrade Encoder Stream */}
        <button
          onClick={onDowngradeEncoderStream}
          className={`w-full p-2.5 rounded-xl border text-xs flex items-center justify-between transition-all ${
            encoderStreamMode === 'client-webm'
              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200'
              : 'bg-white/5 border-white/10 hover:bg-white/10 text-white hover:border-sky-400/50'
          }`}
        >
          <div className="flex items-center gap-2.5 text-left">
            <div className="w-7 h-7 rounded-lg bg-sky-500/20 flex items-center justify-center text-sky-300 shrink-0">
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <div className="font-medium flex items-center gap-1.5">
                Downgrade Encoder Stream
                {encoderStreamMode === 'client-webm' && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                )}
              </div>
              <p className="text-[10px] text-gray-400">
                {encoderStreamMode === 'client-webm'
                  ? 'Active: Exporting pure WebM stream with zero hardware drop risk.'
                  : 'Swaps from hardware-accelerated H.264 MP4 to pure WebM client-side downloads.'}
              </p>
            </div>
          </div>
          <span className="text-[11px] font-mono text-sky-300 shrink-0">
            {encoderStreamMode === 'client-webm' ? 'WebM Active' : 'Enable →'}
          </span>
        </button>
      </div>

      {/* Footer Utility Actions */}
      <div className="flex items-center justify-between pt-1 border-t border-white/5 text-[11px]">
        {onOpenFlightDoctor ? (
          <button
            onClick={onOpenFlightDoctor}
            className="text-purple-400 hover:text-purple-300 flex items-center gap-1 underline-offset-2 hover:underline transition-colors"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            Run Flight Doctor Probes
          </button>
        ) : (
          <span className="text-gray-500 text-[10px]">Telemetry Channel Live</span>
        )}

        <button
          onClick={onDismiss}
          className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-white font-medium text-xs transition-colors"
        >
          Dismiss & Continue
        </button>
      </div>
    </div>
  );
}
