/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        partner: {
          accent: '#059669',
          'accent-hover': '#047857',
        },
      },
    },
  },
  plugins: [],
};
