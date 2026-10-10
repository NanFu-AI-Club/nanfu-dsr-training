/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // 吉卜力天空蓝 — 柔和、温暖、像天空之城的蓝天
        sky: {
          50: '#f2f8fd',
          100: '#e3f0fa',
          200: '#c5e0f5',
          300: '#9cc9ed',
          400: '#6dade2',
          500: '#4a94d4',
          600: '#3a7abf',
          700: '#30629c',
          800: '#2a517e',
          900: '#254569',
        },
        // 主色调：温暖的天空蓝
        primary: {
          50: '#f0f6fb',
          100: '#dcebf5',
          200: '#b8d6ec',
          300: '#8abae0',
          400: '#5f9cd1',
          500: '#4482bb',
          600: '#35699e',
          700: '#2d5580',
          800: '#28496b',
          900: '#253e59',
        },
        // 强调色：吉卜力风格的暖金色（像千与千寻的黄昏）
        accent: {
          50: '#fef9ee',
          100: '#fdf0d5',
          200: '#fadf9e',
          300: '#f6c85d',
          400: '#f2b030',
          500: '#e8961a',
          600: '#c97a0f',
          700: '#a05c10',
          800: '#824914',
          900: '#6b3d14',
        },
        // 温暖大地色 — 替代冷灰色
        warm: {
          50: '#faf8f5',
          100: '#f5f0e8',
          200: '#e5d8c5',
          300: '#cdb694',
          400: '#8a6b48',
          500: '#6d5136',
          600: '#5c4630',
          700: '#4a3828',
          800: '#352820',
          900: '#221a15',
        },
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.25rem',
        '4xl': '1.75rem',
      },
      boxShadow: {
        'soft': '0 2px 15px -3px rgba(0, 0, 0, 0.06), 0 1px 6px -2px rgba(0, 0, 0, 0.04)',
        'soft-lg': '0 4px 25px -5px rgba(0, 0, 0, 0.07), 0 2px 10px -3px rgba(0, 0, 0, 0.04)',
        'soft-xl': '0 8px 35px -8px rgba(0, 0, 0, 0.08), 0 4px 15px -4px rgba(0, 0, 0, 0.04)',
        'inner-soft': 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.03)',
        'glow': '0 0 20px rgba(68, 130, 187, 0.15)',
      },
      fontFamily: {
        sans: ['"Noto Sans SC"', '"PingFang SC"', '"Microsoft YaHei"', 'system-ui', 'sans-serif'],
      },
      animation: {
        'float': 'float 6s ease-in-out infinite',
        'float-delay': 'float 7s ease-in-out 2s infinite',
        'float-slow': 'float 8s ease-in-out 1s infinite',
        'fade-in': 'fadeIn 0.5s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'slide-in': 'slideInRight 0.3s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        'cloud-drift': 'cloudDrift 30s linear infinite',
        'cloud-drift-slow': 'cloudDrift 45s linear 10s infinite',
        'bounce-in': 'bounceIn 0.4s ease-out',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        cloudDrift: {
          '0%': { transform: 'translateX(-10%)' },
          '100%': { transform: 'translateX(110%)' },
        },
        bounceIn: {
          '0%': { opacity: '0', transform: 'translate(-50%, -10px) scale(0.9)' },
          '60%': { opacity: '1', transform: 'translate(-50%, 2px) scale(1.03)' },
          '100%': { opacity: '1', transform: 'translate(-50%, 0) scale(1)' },
        },
      },
    },
  },
  plugins: [],
};
