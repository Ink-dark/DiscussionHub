/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 房间列表 JSON：[{ owner, repo, label? }] */
  readonly VITE_GITHUB_ROOMS?: string
  /** Cloudflare Worker 认证交换层地址，不含尾斜杠 */
  readonly VITE_OAUTH_EXCHANGE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
