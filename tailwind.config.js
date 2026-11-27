/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        studio: {
          canvas: '#08090D',
          bg: '#08090D',
          panel: '#0F1117',
          card: '#161922',
          cardHover: '#1D212D',
          border: 'rgba(255, 255, 255, 0.07)',
          borderHover: 'rgba(255, 255, 255, 0.14)',
          accent: '#60A5FA',
          accentAlt: '#818CF8',
          accentGlow: 'rgba(99, 132, 255, 0.25)',
          text: '#F3F6FC',
          muted: '#9AA4B8',
          meta: '#647087',
          success: '#34D399',
          caution: '#FBBF24',
          live: '#FB7185'
        }
      },
      fontFamily: {
        sans: ['Inter', 'SF Pro Display', 'Segoe UI Variable Text', 'Segoe UI', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Cascadia Code', 'SF Mono', 'ui-monospace', 'monospace']
      },
      backgroundImage: {
        gemini: 'linear-gradient(135deg, #4285F4 0%, #7C83FD 48%, #A855F7 100%)'
      },
      boxShadow: {
        'ss-panel': '0 16px 44px -18px rgba(0, 0, 0, 0.85)',
        'ss-glow': '0 0 26px -8px rgba(99, 132, 255, 0.55)',
        'ss-primary': '0 10px 26px -12px rgba(99, 132, 255, 0.75)'
      },
      transitionTimingFunction: {
        ss: 'cubic-bezier(0.22, 1, 0.36, 1)'
      },
      keyframes: {
        'slide-in': {
          '0%': { opacity: '0', transform: 'translateY(-8px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' }
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        'pop-in': {
          '0%': { opacity: '0', transform: 'translateY(6px) scale(0.97)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' }
        },
        sheen: {
          '0%, 100%': { transform: 'translateX(-120%)' },
          '50%': { transform: 'translateX(120%)' }
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.65' },
          '70%, 100%': { transform: 'scale(1.9)', opacity: '0' }
        }
      },
      animation: {
        'slide-in': 'slide-in 220ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in': 'fade-in 200ms ease-out both',
        'pop-in': 'pop-in 200ms cubic-bezier(0.22, 1, 0.36, 1) both',
        sheen: 'sheen 3s ease-in-out infinite',
        'pulse-ring': 'pulse-ring 2s ease-out infinite'
      }
    },
  },
  plugins: [],
}
