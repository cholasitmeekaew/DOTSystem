import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const rawPort = process.env.PORT || '3000';
const port = Number(rawPort);

const basePath = process.env.BASE_PATH || '/';

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  // ไม่ optimize Supabase SDK ตอน dev/build — ให้ dynamic import ใน supabase.ts จัดการเอง
  // (ป้องกัน error ตอน build ในโหมด JSON ที่ไม่ได้ใช้ Supabase จริง เช่น Bolt)
  optimizeDeps: {
    exclude: ['@supabase/supabase-js'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
    // ทำให้ Supabase SDK เป็น external — ไม่ bundle เข้าไป
    // เพื่อให้ build ได้แม้ Supabase SDK ไม่ได้ติดตั้ง (Bolt / JSON mode)
    rollupOptions: {
      external: ['@supabase/supabase-js'],
      output: {
        // แสดงเป็น global เผื่อมี code ที่ใช้ Supabase จริงๆ ตอน runtime
        globals: {
          '@supabase/supabase-js': 'supabaseJsUnavailable',
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
