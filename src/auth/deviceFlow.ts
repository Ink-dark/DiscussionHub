import { GitHubApiError, postOAuth } from '../github'

export interface DeviceCodeInfo {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete: string
  interval: number
  expiresIn: number
}

export interface TokenInfo {
  accessToken: string
  refreshToken?: string
  /** 毫秒时间戳；GitHub 未开启过期令牌时为空 */
  expiresAt?: number
  scope?: string
}

interface DeviceCodePayload {
  device_code?: string
  user_code?: string
  verification_uri?: string
  verification_uri_complete?: string
  interval?: number
  expires_in?: number
  error?: string
  error_description?: string
}

interface TokenPayload {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

const OAUTH_MESSAGES: Record<string, string> = {
  device_flow_disabled:
    'GitHub App 未启用 Device Flow，请在 App 设置中勾选 Enable Device Flow 后重试。',
  incorrect_client_credentials: 'GitHub App 的 Client ID 配置不正确，请检查 Worker 环境变量。',
  access_denied: '你拒绝了本次授权，可重新获取验证码再试。',
  expired_token: '验证码已过期，请重新获取。',
  unsupported_grant_type: '授权类型不被支持，请检查 Worker 转发参数。',
  bad_refresh_token: '刷新令牌已失效，请重新用 GitHub 登录。',
  invalid_grant: '授权已失效，请重新获取验证码。',
}

function oauthError(data: { error?: string; error_description?: string }, status: number): GitHubApiError {
  const code = data.error ?? ''
  const message =
    OAUTH_MESSAGES[code] ??
    data.error_description ??
    (code ? `GitHub 授权失败：${code}` : `认证交换层返回 ${status}`)
  return new GitHubApiError('OAUTH_ERROR', message, { status })
}

function toTokenInfo(data: TokenPayload, fallbackRefresh?: string): TokenInfo {
  const expiresIn = Number(data.expires_in)
  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token || fallbackRefresh,
    expiresAt:
      Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : undefined,
    scope: data.scope,
  }
}

/** 通道 B：申请设备码（client_id 由 Worker 注入，前端不传） */
export async function requestDeviceCode(): Promise<DeviceCodeInfo> {
  const { status, data } = await postOAuth<DeviceCodePayload>('/device/code', {})
  if (data.error || status >= 400 || !data.device_code || !data.user_code) {
    throw oauthError(data, status)
  }

  const verificationUri = data.verification_uri || 'https://github.com/login/device'
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri,
    verificationUriComplete:
      data.verification_uri_complete || `${verificationUri}?user_code=${encodeURIComponent(data.user_code)}`,
    interval: Math.max(5, Number(data.interval) || 5),
    expiresIn: Math.max(60, Number(data.expires_in) || 900),
  }
}

export type PollResult =
  | { state: 'pending' }
  | { state: 'slow_down' }
  | { state: 'token'; token: TokenInfo }

/** 按 interval 轮询；authorization_pending / slow_down 是正常答案，不抛错 */
export async function pollDeviceToken(deviceCode: string): Promise<PollResult> {
  const { status, data } = await postOAuth<TokenPayload>('/access_token', {
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    device_code: deviceCode,
  })

  if (data.access_token) {
    return { state: 'token', token: toTokenInfo(data) }
  }

  if (status < 400 && !data.error) {
    throw oauthError(data, status)
  }

  switch (data.error) {
    case 'authorization_pending':
      return { state: 'pending' }
    case 'slow_down':
      return { state: 'slow_down' }
    default:
      throw oauthError(data, status)
  }
}

/** 静默刷新：同样打到 /access_token，Worker 白名单已覆盖 */
export async function refreshUserToken(refreshToken: string): Promise<TokenInfo> {
  const { status, data } = await postOAuth<TokenPayload>('/access_token', {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })

  if (!data.access_token) {
    throw oauthError(data, status)
  }

  return toTokenInfo(data, refreshToken)
}
