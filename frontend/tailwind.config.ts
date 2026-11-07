import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: '#00A82D',
        mint: '#E8F5E9',
        active: '#E6F4EA',
        scheduled: '#FFF3E0',
        ink: '#17212F',
        muted: '#8993A3',
        field: '#F3F6F4'
      },
      boxShadow: {
        popover: '0 8px 24px rgba(20, 30, 45, 0.12)'
      }
    }
  },
  plugins: []
};

export default config;
