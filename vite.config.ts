import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 项目页部署在 https://<user>.github.io/<repo>/，构建时通过 BASE_PATH 注入子路径；
// 本地开发与自定义域名保持根路径即可。
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [vue()],
  build: {
    target: 'es2022',
    sourcemap: false,
  },
})
