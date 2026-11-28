import { createRouter, createWebHashHistory } from 'vue-router'
import Gate from './views/Gate.vue'
import Chat from './views/Chat.vue'
import { useSessionStore } from './stores/session'
import { useRoomsStore } from './stores/rooms'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'gate', component: Gate },
    { path: '/r/:owner/:repo', name: 'chat', component: Chat, props: true },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach((to) => {
  const session = useSessionStore()
  const rooms = useRoomsStore()

  // F1 登录门禁：未认证时不渲染消息区
  if (to.name === 'chat' && !session.isAuthed) {
    return { name: 'gate', query: { next: to.fullPath } }
  }

  // 已登录访问登录页：回到目标房间或第一个房间
  if (to.name === 'gate' && session.isAuthed) {
    const next = typeof to.query.next === 'string' ? to.query.next : ''
    if (next.startsWith('/r/')) return next
    const first = rooms.rooms[0]
    if (first) {
      return { name: 'chat', params: { owner: first.owner, repo: first.repo } }
    }
  }

  return true
})
