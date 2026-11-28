<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Composer from '../components/Composer.vue'
import MessageList from '../components/MessageList.vue'
import RoomList from '../components/RoomList.vue'
import UserAvatar from '../components/UserAvatar.vue'
import { pollDelayMs, rateLimit } from '../github'
import { useComposerStore } from '../stores/composer'
import { useMessagesStore } from '../stores/messages'
import { useRoomsStore } from '../stores/rooms'
import { useSessionStore } from '../stores/session'
import { formatRateReset, formatSyncTime } from '../utils/format'

const props = defineProps<{ owner: string; repo: string }>()

const session = useSessionStore()
const roomsStore = useRoomsStore()
const messagesStore = useMessagesStore()
const composerStore = useComposerStore()
const router = useRouter()

const drawerOpen = ref(false)
const refreshing = ref(false)
const booting = ref(false)

const room = computed(() => roomsStore.find(props.owner, props.repo))
const runtime = computed(() => (room.value ? roomsStore.runtimeFor(room.value.key) : null))
const messageState = computed(() =>
  room.value ? messagesStore.stateFor(room.value.key) : null,
)
const roomError = computed(() => runtime.value?.error ?? messageState.value?.error ?? null)

const rateLimited = computed(
  () =>
    rateLimit.limited ||
    (rateLimit.remaining !== null && rateLimit.remaining < 200),
)

const hasBanners = computed(
  () =>
    session.workerUnreachable ||
    rateLimited.value ||
    Boolean(messageState.value?.syncError),
)

let pollTimer: number | undefined
let badgeTimer: number | undefined
let activationId = 0
let unmounted = false
let pollInFlight = false

function isActive(key: string): boolean {
  return !unmounted && room.value?.key === key
}

function stopPoll(): void {
  if (pollTimer !== undefined) {
    window.clearTimeout(pollTimer)
    pollTimer = undefined
  }
}

function markReadNewest(key: string): void {
  if (document.visibilityState !== 'visible') return
  const state = messagesStore.stateFor(key)
  for (let index = state.items.length - 1; index >= 0; index -= 1) {
    const item = state.items[index]
    if (!item.pending && !item.failed) {
      roomsStore.markRead(key, item.id)
      return
    }
  }
}

function schedulePoll(key: string, immediate = false): void {
  if (!isActive(key)) return
  stopPoll()
  pollTimer = window.setTimeout(
    () => {
      void pollOnce(key)
    },
    immediate ? 0 : pollDelayMs(),
  )
}

async function pollOnce(key: string): Promise<void> {
  if (!isActive(key)) return
  if (pollInFlight) {
    schedulePoll(key)
    return
  }
  const config = roomsStore.rooms.find((item) => item.key === key)
  const roomRuntime = roomsStore.runtimeFor(key)
  if (!config || !roomRuntime?.discussionId) {
    schedulePoll(key)
    return
  }
  if (document.visibilityState !== 'visible') {
    schedulePoll(key)
    return
  }

  pollInFlight = true
  try {
    const result = await messagesStore.poll(key, roomRuntime.discussionId)
    if (isActive(key) && result.added > 0) markReadNewest(key)
  } finally {
    pollInFlight = false
    if (isActive(key)) schedulePoll(key)
  }
}

async function activate(): Promise<void> {
  const generation = ++activationId
  stopPoll()
  drawerOpen.value = false
  booting.value = false

  const config = room.value
  if (!config) return

  const state = messagesStore.stateFor(config.key)

  if (state.items.length === 0) {
    booting.value = true
    try {
      const ids = await roomsStore.ensureRoom(config.key)
      if (generation !== activationId) return
      await messagesStore.loadInitial(config.key, ids.discussionId)
    } catch {
      // runtime.error 已记录，由消息区展示可操作提示
    } finally {
      if (generation === activationId) booting.value = false
    }
    if (generation !== activationId) return
    markReadNewest(config.key)
    schedulePoll(config.key)
  } else {
    markReadNewest(config.key)
    schedulePoll(config.key, true)
  }

  void roomsStore.refreshBadges()
}

async function retryRoom(): Promise<void> {
  const config = room.value
  if (!config) return

  const generation = ++activationId
  booting.value = true
  roomsStore.resetRoom(config.key)
  messagesStore.clearRoom(config.key)

  try {
    const ids = await roomsStore.ensureRoom(config.key)
    if (generation !== activationId) return
    await messagesStore.loadInitial(config.key, ids.discussionId)
  } catch {
    // 展示 runtime.error
  } finally {
    if (generation === activationId) booting.value = false
  }

  if (generation !== activationId) return
  markReadNewest(config.key)
  schedulePoll(config.key)
}

function handleLoadOlder(): void {
  const config = room.value
  const roomRuntime = runtime.value
  if (!config || !roomRuntime?.discussionId) return
  void messagesStore.loadOlder(config.key, roomRuntime.discussionId)
}

async function handleSend(text: string): Promise<void> {
  const config = room.value
  const roomRuntime = runtime.value
  if (!config || !roomRuntime?.discussionId || !session.canWrite) return
  await messagesStore.send(config.key, roomRuntime.discussionId, text)
  markReadNewest(config.key)
}

function handleRetry(messageId: string): void {
  const config = room.value
  const roomRuntime = runtime.value
  if (!config || !roomRuntime?.discussionId) return
  void messagesStore
    .retry(config.key, roomRuntime.discussionId, messageId)
    .then(() => markReadNewest(config.key))
}

async function manualRefresh(): Promise<void> {
  const config = room.value
  const roomRuntime = runtime.value
  if (!config || !roomRuntime?.discussionId || refreshing.value) return
  refreshing.value = true
  try {
    const result = await messagesStore.poll(config.key, roomRuntime.discussionId)
    if (result.added > 0) markReadNewest(config.key)
    await roomsStore.refreshBadges()
  } finally {
    refreshing.value = false
  }
}

function switchRoom(key: string): void {
  const target = roomsStore.rooms.find((item) => item.key === key)
  drawerOpen.value = false
  if (!target || target.key === room.value?.key) return
  void router.replace({ name: 'chat', params: { owner: target.owner, repo: target.repo } })
}

function logout(): void {
  session.signOut()
  messagesStore.resetAll()
  roomsStore.resetRuntime()
  composerStore.clearAll()
  void router.replace('/')
}

function handleVisibility(): void {
  if (document.visibilityState !== 'visible') return
  const config = room.value
  if (!config) return
  markReadNewest(config.key)
  schedulePoll(config.key, true)
  void roomsStore.refreshBadges()
}

watch(() => [props.owner, props.repo], () => { void activate() }, { immediate: true })

watch(
  () => session.isAuthed,
  (authed) => {
    if (!authed) {
      messagesStore.resetAll()
      void router.replace('/')
    }
  },
)

onMounted(() => {
  void roomsStore.refreshBadges()
  badgeTimer = window.setInterval(() => {
    void roomsStore.refreshBadges()
  }, 60_000)
  document.addEventListener('visibilitychange', handleVisibility)
})

onBeforeUnmount(() => {
  unmounted = true
  activationId += 1
  stopPoll()
  if (badgeTimer !== undefined) window.clearInterval(badgeTimer)
  document.removeEventListener('visibilitychange', handleVisibility)
})
</script>

<template>
  <div class="chat">
    <aside class="sidebar" :class="{ 'sidebar--open': drawerOpen }">
      <div class="sidebar__brand">
        <span class="brand__mark brand__mark--sm" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path
              d="M5 4.8h14a1.2 1.2 0 011.2 1.2v9.4a1.2 1.2 0 01-1.2 1.2h-7.3l-4.2 3.1a.6.6 0 01-.96-.48V16.6H5a1.2 1.2 0 01-1.2-1.2V6A1.2 1.2 0 015 4.8z"
              fill="currentColor"
            />
          </svg>
        </span>
        <div class="sidebar__brand-text">
          <p class="sidebar__title">DiscussionsHub</p>
          <p class="sidebar__sub">{{ roomsStore.rooms.length }} 个房间</p>
        </div>
      </div>

      <div class="sidebar__section">
        <span class="sidebar__label">房间</span>
        <RoomList
          :rooms="roomsStore.roomViews"
          :active-key="room?.key ?? ''"
          @select="switchRoom"
        />
      </div>

      <div class="sidebar__account">
        <UserAvatar
          small
          :login="session.login"
          :src="session.viewer?.avatarUrl"
        />
        <div class="sidebar__account-meta">
          <span class="sidebar__login">@{{ session.login }}</span>
          <span class="sidebar__token">{{ session.tokenBadge }}</span>
        </div>
        <button class="icon-btn" type="button" aria-label="退出登录" @click="logout">
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <path
              d="M8 3.5H4.8c-.7 0-1.3.6-1.3 1.3v10.4c0 .7.6 1.3 1.3 1.3H8M12.6 6.8L16 10l-3.4 3.2M16 10H7.6"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>
    </aside>

    <div v-if="drawerOpen" class="scrim" aria-hidden="true" @click="drawerOpen = false"></div>

    <section class="main">
      <header class="topbar">
        <button
          class="icon-btn topbar__menu"
          type="button"
          aria-label="打开房间列表"
          @click="drawerOpen = true"
        >
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
            <path
              d="M3.5 6h13M3.5 10h13M3.5 14h13"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
            />
          </svg>
        </button>

        <div class="topbar__title">
          <h1>{{ room?.label ?? `${props.owner}/${props.repo}` }}</h1>
          <p class="topbar__sub">
            <span class="hash">#</span> general
            <span class="dot"></span>
            {{ props.owner }}/{{ props.repo }}
            <span class="dot"></span>
            {{ formatSyncTime(messageState?.lastSyncAt ?? null) }}
          </p>
        </div>

        <div class="topbar__actions">
          <a
            class="topbar__account"
            :href="`https://github.com/${session.login}`"
            target="_blank"
            rel="noopener noreferrer"
            :title="`@${session.login} 的 GitHub 主页`"
          >
            <UserAvatar :login="session.login" :src="session.viewer?.avatarUrl" />
            <span class="topbar__account-login">@{{ session.login }}</span>
          </a>
          <span class="badge">{{ session.tokenBadge }}</span>
          <button
            class="icon-btn"
            :class="{ 'is-spinning': refreshing }"
            type="button"
            aria-label="刷新消息"
            :disabled="!runtime?.discussionId || refreshing"
            @click="manualRefresh"
          >
            <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
              <path
                d="M15.6 8.2A5.8 5.8 0 104 12.9M15.6 8.2V4.6M15.6 8.2h-3.6"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>
      </header>

      <div v-if="hasBanners" class="banners">
        <div v-if="session.workerUnreachable" class="banner banner--warn">
          认证交换层不可达，App 令牌刷新暂不可用；已登录会话与消息收发不受影响。
        </div>
        <div v-if="rateLimited" class="banner banner--warn">
          GitHub 接口配额偏低或已限流，轮询自动降速到 30 秒
          <template v-if="rateLimit.resetAt">（预计 {{ formatRateReset(rateLimit.resetAt) }} 重置）</template>。
        </div>
        <div v-if="messageState?.syncError" class="banner banner--warn">
          {{ messageState.syncError.title }}：{{ messageState.syncError.hint }}
        </div>
      </div>

      <div v-if="!room" class="chat-state chat-state--page">
        <span class="chat-state__mark">?</span>
        <h2>这个房间不在配置中</h2>
        <p>{{ props.owner }}/{{ props.repo }} 没有被列入 <code>VITE_GITHUB_ROOMS</code>。</p>
        <div class="chat-state__actions">
          <button
            v-if="roomsStore.rooms[0]"
            class="btn btn--primary"
            type="button"
            @click="switchRoom(roomsStore.rooms[0].key)"
          >
            打开 {{ roomsStore.rooms[0].label }}
          </button>
          <button class="btn btn--ghost" type="button" @click="logout">退出登录</button>
        </div>
      </div>

      <template v-else>
        <MessageList
          :key="room.key"
          :messages="messageState?.items ?? []"
          :me="session.login"
          :loading-initial="booting || Boolean(messageState?.loadingInitial)"
          :loading-older="Boolean(messageState?.loadingOlder)"
          :has-more="Boolean(messageState?.hasMore)"
          :error="roomError"
          @load-older="handleLoadOlder"
          @retry-message="handleRetry"
          @retry="retryRoom"
        />

        <div v-if="messageState?.sendError" class="send-alert">
          <strong>{{ messageState.sendError.title }}</strong>
          <span>{{ messageState.sendError.hint }}</span>
        </div>

        <Composer
          :room-key="room.key"
          :disabled="!runtime?.discussionId || !session.canWrite"
          :sending="Boolean(messageState?.sending)"
          @send="handleSend"
        />
      </template>
    </section>
  </div>
</template>
