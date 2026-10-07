import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Docker bind-mounts on Windows don't emit inotify events; poll instead.
    watch: { usePolling: true, interval: 300 },
    // Тот же путь, что отдаёт nginx в проде, — чтобы рендер работал
    // одинаково в dev и prod и в коде не было ветвлений по окружению
    proxy: {
      '/prompt': {
        target: 'https://image.pollinations.ai',
        changeOrigin: true,
        secure: true
      }
    }
  }
});
