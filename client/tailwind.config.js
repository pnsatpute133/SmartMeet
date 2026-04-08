/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          bg: '#202124',
          surface: '#3c4043',
          border: '#5f6368',
        },
        brand: {
          blue: '#8ab4f8',
          blueHover: '#aecbfa',
          red: '#ea4335',
          redHover: '#f28b82',
        }
      },
      fontFamily: {
        sans: ['Google Sans', 'Inter', 'Roboto', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
