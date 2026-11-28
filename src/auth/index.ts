import type { SessionKind } from './session'

/**
 * 双通道的统一抽象：上层（消息流 / 房间 / 轮询）只关心 canWrite 与 token，
 * PAT 与设备流的差异全部锁在 auth/ 内以及会话 store 的 token 生命周期里。
 */
export interface AuthProvider {
  id: SessionKind
  capabilities: {
    canWrite: boolean
  }
}

export const AUTH_PROVIDERS: Record<SessionKind, AuthProvider> = {
  pat: {
    id: 'pat',
    capabilities: { canWrite: true },
  },
  app: {
    id: 'app',
    capabilities: { canWrite: true },
  },
}
