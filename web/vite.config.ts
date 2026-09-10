import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发时把 /api 与 /ws 代理到后端
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // 局域网可访问，真机/模拟器调试
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
});
