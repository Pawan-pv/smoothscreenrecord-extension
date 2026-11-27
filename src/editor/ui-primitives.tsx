import React, { useId } from 'react';

/**
 * Shared UI primitives for the SmoothStudio design system.
 * Purely presentational — no engine, capture, privacy or export logic.
 */

interface BrandMarkProps {
  size?: number;
  className?: string;
}

/** Sharp, inline SmoothStudio emblem with the Gemini blue → violet gradient. */
export function BrandMark({ size = 32, className = '' }: BrandMarkProps) {
  const rawId = useId();
  const gradientId = `ssBrand${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <span
      className={`ss-brand-tile rounded-[10px] ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        width={Math.round(size * 0.62)}
        height={Math.round(size * 0.62)}
        fill="none"
      >
        <defs>
          <linearGradient id={gradientId} x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
            <stop stopColor="#4285F4" />
            <stop offset="0.48" stopColor="#7C83FD" />
            <stop offset="1" stopColor="#A855F7" />
          </linearGradient>
        </defs>
        <path
          d="M16.6 7.6H9.6a2.15 2.15 0 0 0 0 4.3h4.8a2.15 2.15 0 0 1 0 4.3H7.4"
          stroke={`url(#${gradientId})`}
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="17.6" cy="6.1" r="1.35" fill="#38BDF8" />
      </svg>
    </span>
  );
}

type SliderProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'min' | 'max'
> & {
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
};

/**
 * Range input with a live Gemini-gradient fill up to the thumb value.
 * The fill is driven by a CSS custom property, so there is no JS DOM writes
 * beyond React's normal value updates and no external assets.
 */
export function StudioSlider({
  value,
  min = 0,
  max = 100,
  onChange,
  className = '',
  style,
  ...rest
}: SliderProps) {
  const lo = Number(min);
  const hi = Number(max);
  const pct = hi > lo
    ? Math.max(0, Math.min(100, ((Number(value) - lo) / (hi - lo)) * 100))
    : 0;

  return (
    <input
      type="range"
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={`studio-slider ${className}`.trim()}
      style={{ ...(style || {}), '--range-fill': `${pct}%` } as React.CSSProperties}
      {...rest}
    />
  );
}
