/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        admin: {
          accent: '#2563eb',
          'accent-hover': '#1d4ed8',
        },
      },
    },
  },
  plugins: [],
};
