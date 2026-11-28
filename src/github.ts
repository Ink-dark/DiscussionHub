import { reactive } from 'vue'

const GRAPHQL_ENDPOINT = 'https://api.github.com/graphql'

export type GitHubErrorCode =
  | 'BAD_CREDENTIALS'
  | 'INSUFFICIENT_SCOPES'
  | 'RATE_LIMITED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'NETWORK'
  | 'GRAPHQL'
  | 'OAUTH_ERROR'
  | 'WORKER_NOT_CONFIGURED'
  | 'WORKER_UNREACHABLE'
  | 'UNKNOWN'

interface GitHubApiErrorOptions {
  status?: number
  details?: string[]
  resetAt?: number
  cause?: unknown
}

export class GitHubApiError extends Error {
  readonly code: GitHubErrorCode
  readonly status?: number
  readonly details?: string[]
  readonly resetAt?: number

  constructor(code: GitHubErrorCode, message: string, options: GitHubApiErrorOptions = {}) {
    super(message, { cause: options.cause })
    this.name = 'GitHubApiError'
    this.code = code
    this.status = options.status
    this.details = options.details
    this.resetAt = options.resetAt
  }
}

/** 最近一次响应携带的限流信息，供轮询退避与 UI 提示使用 */
export const rateLimit = reactive({
  remaining: null as number | null,
  resetAt: 0,
  limited: false,
})

/** 轮询间隔：接近耗尽时退避到 30s（写操作不做自动重试） */
export function pollDelayMs(): number {
  if (rateLimit.limited) return 30_000
  if (rateLimit.remaining !== null && rateLimit.remaining < 200) return 30_000
  return 9_000
}

function readRateLimit(headers: Headers): void {
  const remaining = headers.get('X-RateLimit-Remaining')
  if (remaining !== null && remaining.trim() !== '') {
    const value = Number(remaining)
    if (Number.isFinite(value)) rateLimit.remaining = value
  }
  const reset = headers.get('X-RateLimit-Reset')
  if (reset !== null && reset.trim() !== '') {
    const value = Number(reset)
    if (Number.isFinite(value)) rateLimit.resetAt = value * 1000
  }
  rateLimit.limited = rateLimit.remaining !== null && rateLimit.remaining <= 0
}

interface GraphQLErrorShape {
  type?: string
  message?: string
  path?: unknown[]
}

interface GraphQLPayload<T> {
  data?: T | null
  errors?: GraphQLErrorShape[]
}

export interface GraphQLOptions {
  /** 显式指定令牌（登录校验、401 重试时使用） */
  token?: string
  signal?: AbortSignal
  /** 部分别名失败（如房间角标）时仍返回可用数据 */
  tolerateErrors?: boolean
}

let tokenProvider: () => Promise<string | null> = async () => null

/** 由会话 store 注册，graphql() 只认 getToken() */
export function setTokenProvider(provider: () => Promise<string | null>): void {
  tokenProvider = provider
}

function graphqlErrorCode(message: string, type?: string): GitHubErrorCode {
  switch (type) {
    case 'RATE_LIMITED':
      return 'RATE_LIMITED'
    case 'FORBIDDEN':
      return 'FORBIDDEN'
    case 'NOT_FOUND':
      return 'NOT_FOUND'
    case 'INSUFFICIENT_SCOPES':
      return 'INSUFFICIENT_SCOPES'
    case 'BAD_CREDENTIALS':
      return 'BAD_CREDENTIALS'
    default:
      break
  }
  if (/rate limit/i.test(message)) return 'RATE_LIMITED'
  if (/bad credentials/i.test(message)) return 'BAD_CREDENTIALS'
  if (/saml|sso/i.test(message)) return 'FORBIDDEN'
  return 'GRAPHQL'
}

export async function graphql<T>(
  query: string,
  variables: Record<string, unknown> = {},
  options: GraphQLOptions = {},
): Promise<T> {
  const token = options.token ?? (await tokenProvider())
  if (!token) {
    throw new GitHubApiError('BAD_CREDENTIALS', '当前没有可用的访问令牌')
  }

  let response: Response
  try {
    response = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      signal: options.signal,
    })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new GitHubApiError('NETWORK', '无法连接 api.github.com', { cause })
  }

  readRateLimit(response.headers)

  const raw = await response.text()
  let payload: GraphQLPayload<T> | null = null
  try {
    payload = raw ? (JSON.parse(raw) as GraphQLPayload<T>) : null
  } catch {
    payload = null
  }

  const errorMessages = (payload?.errors ?? [])
    .map((item) => item.message ?? '')
    .filter((message) => message.length > 0)
  const joined = errorMessages.join('；')

  if (response.status === 401) {
    throw new GitHubApiError('BAD_CREDENTIALS', joined || '令牌无效或已过期', {
      status: 401,
      details: errorMessages,
    })
  }

  if (response.status === 403) {
    if (rateLimit.limited || /rate limit/i.test(joined)) {
      throw new GitHubApiError('RATE_LIMITED', joined || 'GitHub 接口限流', {
        status: 403,
        details: errorMessages,
        resetAt: rateLimit.resetAt,
      })
    }
    throw new GitHubApiError('FORBIDDEN', joined || '没有访问权限', {
      status: 403,
      details: errorMessages,
    })
  }

  if (!response.ok) {
    throw new GitHubApiError('UNKNOWN', joined || `GitHub API 返回 ${response.status}`, {
      status: response.status,
      details: errorMessages,
    })
  }

  if (payload?.errors?.length) {
    const first = payload.errors[0]
    const code = graphqlErrorCode(joined, first?.type)
    if (!(options.tolerateErrors && payload.data)) {
      throw new GitHubApiError(code, joined || 'GitHub GraphQL 返回错误', {
        status: response.status,
        details: errorMessages,
        resetAt: rateLimit.resetAt,
      })
    }
  }

  if (!payload || payload.data === undefined || payload.data === null) {
    throw new GitHubApiError('GRAPHQL', joined || 'GitHub 未返回数据', {
      status: response.status,
      details: errorMessages,
    })
  }

  return payload.data
}

const EXCHANGE_BASE = (import.meta.env.VITE_OAUTH_EXCHANGE_URL ?? '').trim().replace(/\/+$/, '')

export function exchangeConfigured(): boolean {
  return EXCHANGE_BASE.length > 0
}

export interface OAuthResponse<T> {
  status: number
  data: T
}

/**
 * 认证交换层调用。注意：GitHub 用 HTTP 400 + error 字段表达
 * authorization_pending / slow_down，这不是网络故障，原样返回给调用方判断。
 */
export async function postOAuth<T>(
  path: '/device/code' | '/access_token',
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<OAuthResponse<T>> {
  if (!EXCHANGE_BASE) {
    throw new GitHubApiError(
      'WORKER_NOT_CONFIGURED',
      '未配置 VITE_OAUTH_EXCHANGE_URL，App 登录不可用',
    )
  }

  let response: Response
  try {
    response = await fetch(`${EXCHANGE_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(params).toString(),
      signal,
    })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new GitHubApiError('WORKER_UNREACHABLE', '无法连接认证交换层', { cause })
  }

  let data: T
  try {
    data = (await response.json()) as T
  } catch {
    data = {} as T
  }

  return { status: response.status, data }
}
