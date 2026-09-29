import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // 开发模式下 API 转发到本地数据服务（端口同 server/index.mjs，可用 PORT 覆盖）
      '/api': `http://localhost:${process.env.PORT || 9100}`,
    },
  },
});
