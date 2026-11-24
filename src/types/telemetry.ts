export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MousePoint {
  t: number; // relative timestamp in ms from recording start
  x: number; // normalised or pixel x coordinate
  y: number; // normalised or pixel y coordinate
  c: CursorStyle;
}

export type CursorStyle = 'default' | 'pointer' | 'text' | 'grab' | 'grabbing' | 'not-allowed' | 'crosshair';

export type CapturedNativeCursor = 'never' | 'motion' | 'always' | 'unknown';

export type ShadowMode = 'none' | 'subtle' | 'studio';

export interface ClickEvent {
  t: number;
  x: number;
  y: number;
  button: number;
  targetTag: string;
  targetText?: string;
  /** Human readable label of the interacted element (form field name, etc.) */
  targetLabel?: string;
  containerBounds?: BoundingBox;
  /** event.detail of the click: 1 single, 2 double, 3 triple. Absent in older recordings. */
  clickCount?: number;
  /**
   * True when the target is something a user operates (button, link, field, role=button/link,
   * contenteditable, or a pointer cursor). False only for plain page content. Absent in older
   * recordings, which are always treated as interactive (a click is never dropped on a guess).
   */
  interactive?: boolean;
}

export interface PressEvent {
  t: number;
  type: 'down' | 'up';
  x: number;
  y: number;
  button: number;
}

export interface KeystrokeEvent {
  t: number;
  key: string;
  combo: string; // e.g. "⌘K", "Ctrl+C", "Enter"
}

/**
 * A contiguous burst of typing into a single field. Consecutive keystrokes are
 * grouped into one session so downstream exports can render one meaningful
 * step ("Type "x" into "Field"") instead of one step per character.
 */
export interface TypingSession {
  t: number;          // start of the burst (ms from recording origin)
  endT: number;       // end of the burst (ms from recording origin)
  text: string;       // typed characters (empty when the field is sensitive)
  sensitive: boolean; // true when the field is a sensitive input
  targetLabel: string;// e.g. "Deploy Feature Branch"
  targetTag: string;  // e.g. "input"
}

export interface InputFocusEvent {
  t: number;
  type: 'focus' | 'blur' | 'type';
  bounds: BoundingBox;
}

/** The recorded tab became hidden (the user left it) or visible again. */
export interface VisibilityEvent {
  t: number;
  state: 'hidden' | 'visible';
}

export interface ScrollEvent {
  t: number;
  scrollX: number;
  scrollY: number;
}

/**
 * Where the recorded page sat on the screen, in screen CSS pixels (DIPs). Lets the editor
 * place page clicks on a window or entire-screen recording.
 */
export interface ScreenLayout {
  /** Top-left corner of the page viewport on the screen. */
  viewportLeft: number;
  viewportTop: number;
  /** Browser zoom of the page (1 = 100%). */
  zoom: number;
  screenLeft: number;
  screenTop: number;
  screenWidth: number;
  screenHeight: number;
  windowLeft: number;
  windowTop: number;
  windowWidth: number;
  windowHeight: number;
}

export interface RecordingMetadata {
  id: string;
  /** Recording session id: shared by the video, the telemetry and the editor (M1-08). */
  sessionId?: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  width: number;
  height: number;
  devicePixelRatio: number;
  title: string;
  url?: string;
  displaySurface?: 'browser' | 'window' | 'monitor' | string;
  capturedNativeCursor?: CapturedNativeCursor;
  /**
   * Window / screen recordings: 'styled' = the real cursor was asked to be left out and the
   * editor draws the styled one; 'real' = the real cursor is in the video. Absent = older recording.
   */
  cursorMode?: 'styled' | 'real';
  /** Where the page sat on the screen while recording (absent in older recordings). */
  screenLayout?: ScreenLayout;
  /**
   * 'capture': the coordinates were converted from the page viewport into the recorded
   * window/screen frame. Absent = page viewport coordinates.
   */
  coordinateSpace?: 'capture';
  brandColors?: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
  };
}

export interface CaptionWord {
  word: string;
  startTime: number;
  endTime: number;
}

export interface CaptionBlock {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  words: CaptionWord[];
}

export type CaptionStyle = 'tiktok-bold' | 'apple-keynote' | 'minimal-pill' | 'classic-sub';

export type CursorTheme = 'mac-obsidian' | 'neon-glow' | 'minimal-white';

export type FramingMode = 'smart-fill' | 'fit';

/** What fills the canvas behind the recording window. */
export type BackgroundSpec =
  | { kind: 'backdrop' } // the preset's animated Backdrop Matrix
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; colors: string[]; angle: number; shape: 'linear' | 'radial' }
  | { kind: 'wallpaper'; id: string }
  | { kind: 'image'; uploadId: string };

/** 0..100 each. Blur / dim apply to wallpapers and images; motion to wallpapers, gradients and images. */
export interface BackgroundEffects {
  blur: number;
  dim: number;
  /** Speed of the background's slow animation; 0 = still. */
  motion: number;
}

/** A background as the renderer draws it: the spec, its effects and (for an image) the decoded picture. */
export interface BackgroundLayer {
  spec: BackgroundSpec;
  effects: BackgroundEffects;
  image?: CanvasImageSource | null;
}

export const DEFAULT_BACKGROUND_EFFECTS: BackgroundEffects = { blur: 0, dim: 0, motion: 30 };

export interface TelemetryData {
  metadata: RecordingMetadata;
  mousePoints: MousePoint[];
  clicks: ClickEvent[];
  pressEvents?: PressEvent[];
  keystrokes: KeystrokeEvent[];
  inputEvents: InputFocusEvent[];
  typingSessions?: TypingSession[];
  scrollEvents?: ScrollEvent[];
  visibilityEvents?: VisibilityEvent[];
  captions?: CaptionBlock[];
}

export interface ZoomPill {
  id: string;
  startTime: number;
  endTime: number;
  targetX: number; // 0..1 normalised screen coordinates
  targetY: number; // 0..1 normalised screen coordinates
  targetScale: number; // e.g. 1.2 to 2.8
  tiltX: number; // isometric degrees
  tiltY: number; // isometric degrees
  spotlight: boolean; // spotlight dimming mask toggle
  label?: string;
  autoGenerated?: boolean;
  /**
   * Focus keyframes of a multi-click shot (normalised 0..1, `t` in ms). Between them the
   * camera pans; it does not zoom out. Absent = one focus at (targetX, targetY).
   */
  keyframes?: Array<{ t: number; x: number; y: number }>;
  /** An auto zoom the user changed: it is theirs now and survives rebuilding the auto zooms. */
  editedByUser?: boolean;
  /**
   * Length of the camera move into this zoom, in ms. Absent = 450 (the default), so older
   * recordings and saved zooms are unchanged. Never more than 35% of a short zoom.
   */
  transitionDuration?: number;
}

export interface SilenceSegment {
  id: string;
  startTime: number;
  endTime: number;
  duration: number;
  markedForCut: boolean;
}

export type AspectRatioType = '16:9' | '9:16' | '1:1' | '4:3' | '4:5';

export type VibePresetId =
  | 'keynote-pro'
  | 'stripe-mesh'
  | 'linear-cosmic'
  | 'linear-dark'
  | 'apple-keynote'
  | 'indie-pop'
  | 'minimal-clean'
  | 'custom';

export interface BackdropMatrixParams {
  presetType: 'keynote-pro' | 'stripe-mesh' | 'linear-cosmic' | 'classic-mesh';
  vignetteStrength: number; // 0..100
  illumination: number;     // 0..100
  flowSpeed: number;        // 0..100
  gridIntensity?: number;   // 0..100
  gradientAngle?: number;   // 0..360 (degrees)
}

export interface VibePreset {
  id: VibePresetId;
  name: string;
  gradientColors: string[];
  borderRadius: number;
  shadowBlur: number;
  shadowColor: string;
  cursorRingColor: string;
  keycapTheme: 'dark' | 'light' | 'glass';
  backdrop?: BackdropMatrixParams;
}
