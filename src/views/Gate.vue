<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DeviceCodeModal from '../components/DeviceCodeModal.vue'
import { useComposerStore } from '../stores/composer'
import { useMessagesStore } from '../stores/messages'
import { useRoomsStore } from '../stores/rooms'
import { useSessionStore } from '../stores/session'

const session = useSessionStore()
const rooms = useRoomsStore()
const router = useRouter()
const route = useRoute()

type Method = 'pat' | 'app'
const method = ref<Method>('pat')
const patInput = ref('')
const showPat = ref(false)
const submittingPat = ref(false)

const roomCount = computed(() => rooms.rooms.length)
const nextTarget = computed(() => {
  const next = route.query.next
  if (typeof next === 'string' && next.startsWith('/r/')) return next
  const first = rooms.rooms[0]
  return first ? `/r/${first.owner}/${first.repo}` : ''
})

async function submitPat(): Promise<void> {
  if (submittingPat.value) return
  submittingPat.value = true
  await session.loginWithPat(patInput.value)
  submittingPat.value = false
}

async function startDevice(): Promise<void> {
  if (method.value !== 'app') method.value = 'app'
  await session.startDeviceLogin()
}

async function restartDevice(): Promise<void> {
  await session.startDeviceLogin()
}

function logout(): void {
  session.signOut()
  useMessagesStore().resetAll()
  rooms.resetRuntime()
  useComposerStore().clearAll()
}

watch(
  () => session.isAuthed,
  async (authed) => {
    if (!authed) return
    const target = nextTarget.value
    if (!target) return
    await router.replace(target)
  },
)
</script>

<template>
  <div class="gate">
    <div class="gate__glow" aria-hidden="true"></div>

    <header class="gate__header">
      <div class="brand">
        <span class="brand__mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path
              d="M5 4.8h14a1.2 1.2 0 011.2 1.2v9.4a1.2 1.2 0 01-1.2 1.2h-7.3l-4.2 3.1a.6.6 0 01-.96-.48V16.6H5a1.2 1.2 0 01-1.2-1.2V6A1.2 1.2 0 015 4.8z"
              fill="currentColor"
            />
          </svg>
        </span>
        <span class="brand__text">Discussions<span class="brand__muted">Hub</span></span>
      </div>
      <span class="gate__tag">私有仓库 · 零运维 IM</span>
    </header>

    <main class="gate__main">
      <section class="pitch">
        <p class="eyebrow">GitHub Discussions as Message Store</p>
        <h1>
          把仓库的讨论区<br />
          <span>变成团队的聊天窗口</span>
        </h1>
        <p class="pitch__lede">
          不建账号、不建数据库、不跑服务器。消息留在你的私有仓库里，
          权限完全交给 GitHub——浏览器里这枚令牌只是把那部分权限带进页面。
        </p>
        <ul class="pitch__list">
          <li><span>01</span> 仓库即房间，侧栏一键切换群组</li>
          <li><span>02</span> 评论即消息，GitHub 原生页面同步可见</li>
          <li><span>03</span> 令牌只存浏览器，刷新不用重新授权</li>
        </ul>
        <div v-if="roomCount" class="pitch__rooms">
          <span class="pitch__rooms-label">已配置房间</span>
          <div class="chips">
            <span v-for="room in rooms.rooms" :key="room.key" class="chip">
              {{ room.label }}
            </span>
          </div>
        </div>
      </section>

      <section class="panel">
        <template v-if="session.isAuthed">
          <div class="panel__head">
            <p class="eyebrow">已连接</p>
            <h2>@{{ session.login }}</h2>
            <p class="panel__sub">登录态已保存在本浏览器，刷新页面无需重新授权。</p>
          </div>

          <div class="connected">
            <img
              v-if="session.viewer?.avatarUrl"
              class="connected__avatar"
              :src="session.viewer.avatarUrl"
              alt=""
              referrerpolicy="no-referrer"
            />
            <div class="connected__meta">
              <strong>@{{ session.login }}</strong>
              <span>令牌类型：{{ session.tokenBadge }}</span>
            </div>
          </div>

          <div class="alert alert--info">
            还没有可用房间。请在构建环境配置
            <code>VITE_GITHUB_ROOMS</code>（JSON 数组，含 owner 与 repo），重新构建后即可进入。
          </div>

          <button class="btn btn--ghost btn--block" type="button" @click="logout">退出登录</button>
        </template>

        <template v-else>
          <div class="panel__head">
            <p class="eyebrow">Sign in</p>
            <h2>连接你的 GitHub</h2>
            <p class="panel__sub">任选一种方式进入。登录态只保存在这台浏览器里。</p>
          </div>

          <div v-if="session.notice" class="alert alert--warn">
            <span>{{ session.notice }}</span>
            <button class="alert__close" type="button" aria-label="关闭" @click="session.clearNotice()">×</button>
          </div>

          <div v-if="session.loginError" class="alert alert--error">
            {{ session.loginError }}
          </div>

          <div v-if="session.workerUnreachable" class="alert alert--warn">
            认证交换层不可达，App 登录与令牌刷新暂时不可用；PAT 通道不受影响。
          </div>

          <div class="segmented" role="tablist" aria-label="登录方式">
            <button
              type="button"
              role="tab"
              :aria-selected="method === 'pat'"
              :class="{ 'is-active': method === 'pat' }"
              @click="method = 'pat'"
            >
              自带令牌
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="method === 'app'"
              :class="{ 'is-active': method === 'app' }"
              @click="method = 'app'"
            >
              GitHub App
            </button>
          </div>

          <form v-if="method === 'pat'" class="login-form" @submit.prevent="submitPat">
            <label class="field">
              <span class="field__label">GitHub 令牌</span>
              <span class="field__control">
                <input
                  v-model="patInput"
                  :type="showPat ? 'text' : 'password'"
                  class="field__input"
                  placeholder="github_pat_… 或 ghp_…"
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck="false"
                />
                <button
                  class="field__toggle"
                  type="button"
                  :aria-label="showPat ? '隐藏令牌' : '显示令牌'"
                  @click="showPat = !showPat"
                >
                  {{ showPat ? '隐藏' : '显示' }}
                </button>
              </span>
            </label>

            <button class="btn btn--primary btn--block" type="submit" :disabled="session.busy || submittingPat">
              <span v-if="session.busy || submittingPat" class="spinner spinner--light" aria-hidden="true"></span>
              {{ session.busy || submittingPat ? '正在验证…' : '用令牌登录' }}
            </button>

            <div class="hint">
              <p>
                <strong>推荐 fine-grained PAT</strong>：Resource owner 选择目标仓库，
                勾选 <code>Discussions: Read and write</code> 与 <code>Metadata: Read</code>。
              </p>
              <p class="hint__warn">
                兜底的 Classic PAT 需要 <code>repo</code> 权限，会覆盖你账号能访问的全部仓库，
                权限远大于“发消息”。组织仓库的令牌可能需要管理员审批。
              </p>
              <a
                class="link"
                href="https://github.com/settings/tokens?type=beta"
                target="_blank"
                rel="noopener noreferrer"
              >
                前往 GitHub 创建令牌 →
              </a>
            </div>
          </form>

          <div v-else class="login-form">
            <p class="app-copy">
              用 GitHub App 的设备流登录：点一下拿到 8 位验证码，在 GitHub 上确认即可。
              令牌由浏览器持有，交换层只做无状态转发。
            </p>
            <button
              class="btn btn--primary btn--block"
              type="button"
              :disabled="!session.exchangeReady || session.busy"
              @click="startDevice"
            >
              <span v-if="session.busy" class="spinner spinner--light" aria-hidden="true"></span>
              {{ session.busy ? '正在申请验证码…' : '用 GitHub 登录' }}
            </button>
            <p v-if="!session.exchangeReady" class="hint hint__warn">
              未配置 <code>VITE_OAUTH_EXCHANGE_URL</code>，设备流不可用。请改用 PAT 登录，
              或部署 <code>cf-oauth-exchange</code> 后重新构建。
            </p>
            <div class="hint">
              <p>请在 GitHub 设置中为 App 开启 Device Flow，并授予 Discussions 读写权限。</p>
            </div>
          </div>

          <div v-if="rooms.configError" class="alert alert--error">
            {{ rooms.configError }}
          </div>
        </template>

        <p class="panel__foot">
          令牌仅保存在 <code>localStorage</code>，不进源码、构建变量或日志；消息读写直连
          <code>api.github.com</code>。
        </p>
      </section>
    </main>

    <footer class="gate__footer">
      <span>GitHub 负责身份与权限</span>
      <span class="dot"></span>
      <span>Discussions 负责消息存储</span>
      <span class="dot"></span>
      <span>Pages 只负责展示</span>
    </footer>

    <DeviceCodeModal
      v-if="session.device"
      :state="session.device"
      @cancel="session.cancelDeviceLogin()"
      @restart="restartDevice"
    />
  </div>
</template>
