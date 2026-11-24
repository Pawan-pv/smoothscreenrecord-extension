/**
 * The editor's recording lifecycle as an explicit state machine.
 *
 *   idle ──start──▶ starting ──started──▶ recording ──stop──▶ stopping ──stopped──▶ idle
 *                     │  └──stop (capture ended at once)──▶ stopping
 *                     └──start-failed──▶ idle
 *
 * Any other event is refused (returns null). That is what makes a second Record
 * click, a Record during a stop, a second Stop, or a late callback of an earlier
 * session harmless: it simply has no transition.
 */
export type RecordingPhase = 'idle' | 'starting' | 'recording' | 'stopping';
export type RecordingEvent = 'start' | 'started' | 'start-failed' | 'stop' | 'stopped';

const TRANSITIONS: Record<RecordingPhase, Partial<Record<RecordingEvent, RecordingPhase>>> = {
  idle: { start: 'starting' },
  starting: { started: 'recording', 'start-failed': 'idle', stop: 'stopping' },
  recording: { stop: 'stopping' },
  stopping: { stopped: 'idle' }
};

export function nextRecordingPhase(phase: RecordingPhase, event: RecordingEvent): RecordingPhase | null {
  return TRANSITIONS[phase][event] ?? null;
}

/** Export jobs share the one source video: at most one runs at a time. */
export type ExportJob = 'mp4' | 'gif';
