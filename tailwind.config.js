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
        dark: {
          bg: '#000000',
          surface: '#0D0D0F',
          surfaceVariant: '#1C1C1E',
          outline: '#2C2C2E',
          onSurfaceVariant: '#8E8E93',
          primary: '#FFFFFF',
        },
        light: {
          bg: '#FFFFFF',
          surface: '#F7F7F9',
          surfaceVariant: '#F2F2F7',
          outline: '#E5E5EA',
          primary: '#000000',
        },
        accent: '#FA2D48',
      },
      fontFamily: {
        sans: ['SF Pro Display', 'Vazirmatn', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
