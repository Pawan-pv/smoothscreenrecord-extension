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
          bg: '#0B0C10',
          card: '#14161D',
          border: 'rgba(255, 255, 255, 0.08)',
          accent: '#8B5CF6',
          accentGlow: 'rgba(139, 92, 246, 0.25)',
          muted: '#8E95A5',
          text: '#F3F4F6'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace']
      }
    },
  },
  plugins: [],
}
