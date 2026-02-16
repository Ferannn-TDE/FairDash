/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'neon-pink': '#FF0077',
        'bg-dark': '#0F0F0F',
        'bg-card': '#1A1A1A',
        'text-gray': '#A1A1A1',
      },
      fontFamily: {
        'bebas': ['"Bebas Neue"', 'cursive'],
        'inter': ['Inter', 'sans-serif'],
      },
      boxShadow: {
        'glow': '0 0 20px rgba(255, 0, 119, 0.4)',
        'glow-intense': '0 0 30px rgba(255, 0, 119, 0.6)',
      },
      animation: {
        'fadeIn': 'fadeIn 0.6s ease-out',
        'slideInLeft': 'slideInLeft 0.6s ease-out',
        'slideInRight': 'slideInRight 0.6s ease-out',
        'pulse-custom': 'pulse 2s infinite',
        'neonGlow': 'neonGlow 3s ease-in-out infinite',
        'float': 'float 3s ease-in-out infinite',
        'float-slow': 'float 8s ease-in-out infinite',
        'skeleton': 'skeleton-loading 1.5s infinite',
        'spin-slow': 'spin 2s linear infinite',
      },
      keyframes: {
        fadeIn: {
          'from': { opacity: '0', transform: 'translateY(20px)' },
          'to': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInLeft: {
          'from': { opacity: '0', transform: 'translateX(-50px)' },
          'to': { opacity: '1', transform: 'translateX(0)' },
        },
        slideInRight: {
          'from': { opacity: '0', transform: 'translateX(50px)' },
          'to': { opacity: '1', transform: 'translateX(0)' },
        },
        neonGlow: {
          '0%, 100%': { textShadow: '0 0 20px rgba(255, 0, 119, 0.4)' },
          '50%': { textShadow: '0 0 30px rgba(255, 0, 119, 0.6)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'skeleton-loading': {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
      },
      backdropBlur: {
        'xs': '2px',
      },
      screens: {
        'xs': '480px',
        'sm': '640px',
        'md': '768px',
        'lg': '968px',
        'xl': '1400px',
      },
    },
  },
  plugins: [],
}
