import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  GitHubApiError,
  exchangeConfigured,
  setTokenProvider,
} from '../github'
import { AUTH_PROVIDERS } from '../auth'
import {
  clearDrafts,
  clearReadMarks,
  clearSessionStorage,
  isExpiring,
  loadSession,
  saveSession,
  type Session,
} from '../auth/session'
import { normalizePat, verifyPat } from '../auth/pat'
import {
  pollDeviceToken,
  refreshUserToken,
  requestDeviceCode,
  type DeviceCodeInfo,
} from '../auth/deviceFlow'
import { errorText } from '../utils/errors'
import { remainingLabel } from '../utils/format'

export type DevicePhase = 'waiting' | 'polling' | 'slow_down' | 'expired' | 'error'

export interface DeviceFlowState {
  code: DeviceCodeInfo
  phase: DevicePhase
  message: string
  secondsLeft: number
}

export const useSessionStore = defineStore('session', () => {
  const restored = loadSession()
  const session = ref<Session | null>(restored)

  // App 令牌既没过期也没有刷新令牌：直接判失效，避免带着死令牌进房间
  if (
    restored?.kind === 'app' &&
    !restored.refreshToken &&
    typeof restored.expiresAt === 'number' &&
    restored.expiresAt <= Date.now()
  ) {
    session.value = null
    clearSessionStorage()
  }

  const busy = ref(false)
  const loginError = ref<string | null>(null)
  const notice = ref<string | null>(
    restored && !session.value ? '登录已过期，请重新用 GitHub 登录。' : null,
  )
  const workerUnreachable = ref(false)
  const device = ref<DeviceFlowState | null>(null)

  const exchangeReady = exchangeConfigured()

  const isAuthed = computed(() => session.value !== null)
  const viewer = computed(() =>
    session.value
      ? { login: session.value.login, avatarUrl: session.value.avatarUrl }
      : null,
  )
  const login = computed(() => session.value?.login ?? '')
  const canWrite = computed(() =>
    session.value ? AUTH_PROVIDERS[session.value.kind].capabilities.canWrite : false,
  )
  const tokenBadge = computed(() => {
    const current = session.value
    if (!current) return ''
    if (current.kind === 'pat') return 'PAT'
    if (typeof current.expiresAt === 'number' && current.expiresAt > 0) {
      return `App · ${remainingLabel(current.expiresAt - Date.now())}`
    }
    return 'App'
  })

  function persist(next: Session): void {
    session.value = next
    saveSession(next)
  }

  function expireSession(): void {
    if (!session.value) return
    session.value = null
    clearSessionStorage()
    notice.value = '登录已失效，请重新用 GitHub 登录。'
  }

  let refreshPromise: Promise<Session | null> | null = null

  async function performRefresh(): Promise<Session | null> {
    if (refreshPromise) return refreshPromise
    const current = session.value
    if (!current || current.kind !== 'app' || !current.refreshToken) return null
    const refreshToken = current.refreshToken

    const task = (async (): Promise<Session | null> => {
      try {
        const token = await refreshUserToken(refreshToken)
        const latest = session.value
        // 刷新期间用户可能已登出，避免把旧会话写回
        if (!latest || latest.token !== current.token) return null
        workerUnreachable.value = false
        const next: Session = {
          ...latest,
          token: token.accessToken,
          refreshToken: token.refreshToken ?? refreshToken,
          expiresAt: token.expiresAt,
          loginAt: Date.now(),
        }
        // 新令牌对先落盘再继续发请求：旧 access / refresh 立即作废
        persist(next)
        return next
      } catch (error) {
        if (error instanceof GitHubApiError && error.code === 'WORKER_UNREACHABLE') {
          workerUnreachable.value = true
        }
        return null
      }
    })()

    refreshPromise = task
    try {
      return await task
    } finally {
      if (refreshPromise === task) refreshPromise = null
    }
  }

  /** graphql() 的唯一令牌入口：App 令牌将到期时先静默刷新 */
  async function getToken(): Promise<string | null> {
    const current = session.value
    if (!current) return null
    if (current.kind === 'app' && current.refreshToken && isExpiring(current)) {
      const refreshed = await performRefresh()
      if (refreshed) return refreshed.token
    }
    return current.token
  }

  /**
   * 统一鉴权请求：401 时尝试刷新一次，仍失败则清会话并提示重新登录。
   * 写操作不在这里做自动重试，避免重复发消息。
   */
  async function withAuth<T>(fn: (token: string) => Promise<T>): Promise<T> {
    const token = await getToken()
    if (!token) throw new GitHubApiError('BAD_CREDENTIALS', '当前未登录')

    try {
      return await fn(token)
    } catch (error) {
      if (!(error instanceof GitHubApiError) || error.code !== 'BAD_CREDENTIALS') throw error
      const current = session.value
      if (!current) throw error
      const refreshed = await performRefresh()
      if (!refreshed) {
        expireSession()
        throw error
      }
      try {
        return await fn(refreshed.token)
      } catch (retryError) {
        if (retryError instanceof GitHubApiError && retryError.code === 'BAD_CREDENTIALS') {
          expireSession()
        }
        throw retryError
      }
    }
  }

  async function loginWithPat(rawToken: string): Promise<boolean> {
    const token = normalizePat(rawToken)
    if (!token) {
      loginError.value = '请输入 GitHub 令牌。'
      return false
    }
    if (busy.value) return false
    busy.value = true
    loginError.value = null
    try {
      const me = await verifyPat(token)
      persist({
        kind: 'pat',
        token,
        login: me.login,
        avatarUrl: me.avatarUrl,
        loginAt: Date.now(),
      })
      notice.value = null
      return true
    } catch (error) {
      loginError.value = errorText(error)
      return false
    } finally {
      busy.value = false
    }
  }

  // ---- 设备流 ----
  let countdownTimer: number | undefined
  let pollTimer: number | undefined
  let pollIntervalMs = 5000
  let flowGeneration = 0

  function clearTimers(): void {
    if (pollTimer !== undefined) {
      window.clearTimeout(pollTimer)
      pollTimer = undefined
    }
    if (countdownTimer !== undefined) {
      window.clearInterval(countdownTimer)
      countdownTimer = undefined
    }
  }

  function finishDeviceFlow(): void {
    flowGeneration += 1
    clearTimers()
    device.value = null
    loginError.value = null
    pollIntervalMs = 5000
  }

  function cancelDeviceLogin(): void {
    flowGeneration += 1
    clearTimers()
    device.value = null
  }

  function startCountdown(generation: number): void {
    if (countdownTimer !== undefined) window.clearInterval(countdownTimer)
    countdownTimer = window.setInterval(() => {
      const state = device.value
      if (!state || generation !== flowGeneration) return
      state.secondsLeft = Math.max(0, state.secondsLeft - 1)
      if (state.secondsLeft <= 0) {
        state.phase = 'expired'
        state.message = '验证码已过期，请重新获取。'
        clearTimers()
      }
    }, 1000)
  }

  function schedulePoll(generation: number, delay: number): void {
    if (pollTimer !== undefined) window.clearTimeout(pollTimer)
    pollTimer = window.setTimeout(() => {
      void runPoll(generation)
    }, delay)
  }

  async function runPoll(generation: number): Promise<void> {
    const state = device.value
    if (!state || generation !== flowGeneration) return
    if (state.phase === 'expired' || state.phase === 'error') return

    state.phase = 'polling'
    try {
      const result = await pollDeviceToken(state.code.deviceCode)
      if (generation !== flowGeneration || !device.value) return

      if (result.state === 'pending') {
        device.value.message = '等待你在 GitHub 上确认授权…'
        schedulePoll(generation, pollIntervalMs)
        return
      }

      if (result.state === 'slow_down') {
        pollIntervalMs += 5000
        device.value.phase = 'slow_down'
        device.value.message = 'GitHub 要求降低轮询频率，已自动放慢…'
        schedulePoll(generation, pollIntervalMs)
        return
      }

      const me = await verifyPat(result.token.accessToken)
      if (generation !== flowGeneration) return

      persist({
        kind: 'app',
        token: result.token.accessToken,
        refreshToken: result.token.refreshToken,
        expiresAt: result.token.expiresAt,
        login: me.login,
        avatarUrl: me.avatarUrl,
        loginAt: Date.now(),
      })
      workerUnreachable.value = false
      notice.value = null
      finishDeviceFlow()
    } catch (error) {
      if (generation !== flowGeneration) return
      const current = device.value
      if (!current) return
      current.phase = 'error'
      current.message = errorText(error)
      clearTimers()
      if (error instanceof GitHubApiError && error.code === 'WORKER_UNREACHABLE') {
        workerUnreachable.value = true
      }
    }
  }

  async function startDeviceLogin(): Promise<boolean> {
    cancelDeviceLogin()
    if (!exchangeReady) {
      loginError.value = '未配置认证交换层（VITE_OAUTH_EXCHANGE_URL），请改用 PAT 登录。'
      return false
    }
    busy.value = true
    loginError.value = null
    notice.value = null
    try {
      const code = await requestDeviceCode()
      pollIntervalMs = Math.max(5000, code.interval * 1000)
      const generation = ++flowGeneration
      device.value = {
        code,
        phase: 'waiting',
        message: '等待你在 GitHub 上确认授权…',
        secondsLeft: code.expiresIn,
      }
      startCountdown(generation)
      schedulePoll(generation, pollIntervalMs)
      return true
    } catch (error) {
      if (error instanceof GitHubApiError && error.code === 'WORKER_UNREACHABLE') {
        workerUnreachable.value = true
        loginError.value = null
      } else {
        loginError.value = errorText(error)
      }
      return false
    } finally {
      busy.value = false
    }
  }

  function signOut(): void {
    cancelDeviceLogin()
    session.value = null
    clearSessionStorage()
    clearDrafts()
    clearReadMarks()
    loginError.value = null
    workerUnreachable.value = false
    notice.value = '已退出登录。如需撤销授权，可到 GitHub → Settings → Applications 操作。'
  }

  function clearNotice(): void {
    notice.value = null
  }

  // 让 graphql() 通过会话层取令牌（含提前刷新）
  setTokenProvider(getToken)

  return {
    session,
    isAuthed,
    viewer,
    login,
    canWrite,
    tokenBadge,
    busy,
    loginError,
    notice,
    device,
    exchangeReady,
    workerUnreachable,
    loginWithPat,
    startDeviceLogin,
    cancelDeviceLogin,
    signOut,
    getToken,
    withAuth,
    clearNotice,
  }
})
