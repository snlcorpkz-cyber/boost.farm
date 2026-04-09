/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        farm: {
          green: '#7BC67E',
          sky: '#87CEEB',
          soil: '#8B6F47',
          water: '#4A9BD9',
          nutrition: '#F5A623',
          morning: '#FFB7A5',
          afternoon: '#87CEEB',
          evening: '#FF8C5A',
          night: '#2C3E6B',
        },
      },
      fontFamily: {
        game: ['"Nunito"', 'sans-serif'],
      },
      animation: {
        'bounce-slow': 'bounce 3s infinite',
        'sway': 'sway 4s ease-in-out infinite',
        'fill-water': 'fillWater 2s ease-out',
        'pour': 'pour 0.8s ease-in-out',
        'rainbow': 'rainbow 2s ease-in-out',
      },
      keyframes: {
        sway: {
          '0%, 100%': { transform: 'rotate(-2deg)' },
          '50%': { transform: 'rotate(2deg)' },
        },
        fillWater: {
          '0%': { height: '0%' },
          '100%': { height: 'var(--fill-level)' },
        },
        pour: {
          '0%': { transform: 'rotate(0deg)' },
          '30%': { transform: 'rotate(-45deg)' },
          '100%': { transform: 'rotate(0deg)' },
        },
        rainbow: {
          '0%': { opacity: '0', transform: 'scale(0.5)' },
          '50%': { opacity: '1', transform: 'scale(1)' },
          '100%': { opacity: '0', transform: 'scale(1.2)' },
        },
      },
    },
  },
  plugins: [],
};
