import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { useSessionStore } from './stores/session'
import './style.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)

// 提前实例化会话 store：注册 graphql() 的令牌提供者并从 localStorage 恢复登录态
useSessionStore(pinia)

app.use(router)
app.mount('#app')
