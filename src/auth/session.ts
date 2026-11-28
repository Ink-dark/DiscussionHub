/** 浏览器持有的登录态：token + 身份快照，绝不是复用 github.com 的 Cookie */
export type SessionKind = 'pat' | 'app'

export interface Session {
  kind: SessionKind
  token: string
  login: string
  avatarUrl: string
  /** 仅 App 令牌：过期时间（毫秒） */
  expiresAt?: number
  /** 仅 App 令牌：ghr_ 刷新令牌 */
  refreshToken?: string
  loginAt: number
}

export interface ReadMark {
  id: string
  at: number
}

const SESSION_KEY = 'gh-im.session.v1'
const DRAFTS_KEY = 'gh-im.drafts.v1'
const READ_KEY = 'gh-im.read.v1'

/** 距离过期不足 5 分钟时视为“将到期”，触发静默刷新 */
export const SESSION_EXPIRY_SKEW_MS = 5 * 60_000

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    (candidate.kind === 'pat' || candidate.kind === 'app') &&
    typeof candidate.token === 'string' &&
    candidate.token.length > 0 &&
    typeof candidate.login === 'string' &&
    typeof candidate.avatarUrl === 'string' &&
    typeof candidate.loginAt === 'number'
  )
}

export function loadSession(): Session | null {
  const parsed = safeParse<unknown>(localStorage.getItem(SESSION_KEY))
  return isSession(parsed) ? parsed : null
}

export function saveSession(session: Session): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function clearSessionStorage(): void {
  localStorage.removeItem(SESSION_KEY)
}

export function isExpiring(session: Session, now = Date.now()): boolean {
  return (
    typeof session.expiresAt === 'number' &&
    session.expiresAt > 0 &&
    session.expiresAt - now < SESSION_EXPIRY_SKEW_MS
  )
}

export function loadDrafts(): Record<string, string> {
  const parsed = safeParse<Record<string, unknown>>(localStorage.getItem(DRAFTS_KEY))
  if (!parsed) return {}
  const drafts: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string' && value.trim()) drafts[key] = value
  }
  return drafts
}

export function saveDrafts(drafts: Record<string, string>): void {
  if (Object.keys(drafts).length === 0) {
    localStorage.removeItem(DRAFTS_KEY)
    return
  }
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts))
}

export function loadReadMarks(): Record<string, ReadMark> {
  const parsed = safeParse<Record<string, unknown>>(localStorage.getItem(READ_KEY))
  if (!parsed) return {}
  const marks: Record<string, ReadMark> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (!value || typeof value !== 'object') continue
    const candidate = value as Record<string, unknown>
    if (typeof candidate.id === 'string' && typeof candidate.at === 'number') {
      marks[key] = { id: candidate.id, at: candidate.at }
    }
  }
  return marks
}

export function saveReadMarks(marks: Record<string, ReadMark>): void {
  if (Object.keys(marks).length === 0) {
    localStorage.removeItem(READ_KEY)
    return
  }
  localStorage.setItem(READ_KEY, JSON.stringify(marks))
}

export function clearDrafts(): void {
  localStorage.removeItem(DRAFTS_KEY)
}

export function clearReadMarks(): void {
  localStorage.removeItem(READ_KEY)
}
