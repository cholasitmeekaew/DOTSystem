/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          900: '#060b18',
          800: '#0a1225',
          700: '#0f1b38',
          600: '#152247',
          500: '#1a2a57',
        },
      },
      fontFamily: {
        // ต้องมี 'Noto Sans Thai' ด้วย
        // ถ้าไม่ใส่ คลาส font-sans จะตัด fallback ไทยทิ้ง
        // ทำให้ภาษาไทยไปใช้ฟอนต์ระบบที่อาจไม่มี glyph ครบ → ซ้อนกัน/เพี้ยน
        sans: [
          'Inter',
          'Noto Sans Thai',
          'Leelawadee UI',
          'Sarabun',
          'system-ui',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
