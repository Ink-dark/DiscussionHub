import { GitHubApiError } from '../github'
import { formatClock } from './format'

export interface ErrorCopy {
  title: string
  hint: string
}

export function describeError(error: unknown): ErrorCopy {
  if (error instanceof GitHubApiError) {
    switch (error.code) {
      case 'BAD_CREDENTIALS':
        return {
          title: '登录已失效',
          hint: '令牌无效或已过期，请重新使用 GitHub 登录。',
        }
      case 'INSUFFICIENT_SCOPES':
        return {
          title: '令牌权限不足',
          hint: '请为令牌补上 Discussions: Read and write 与 Metadata: Read 权限。',
        }
      case 'RATE_LIMITED': {
        const resetAt = error.resetAt
        return {
          title: '触及 GitHub 限流',
          hint: resetAt
            ? `配额预计在 ${formatClock(new Date(resetAt).toISOString())} 重置，轮询已自动降速。`
            : '请稍后再试，轮询已自动降速。',
        }
      }
      case 'FORBIDDEN': {
        if (/pending|approval|approve/i.test(error.message)) {
          return {
            title: '令牌等待组织审批',
            hint: '请让组织管理员在 GitHub 设置中批准该令牌后再试。',
          }
        }
        if (/saml|sso/i.test(error.message)) {
          return {
            title: '需要完成 SSO 授权',
            hint: '请先在 GitHub 完成组织 SSO 授权，再回到这里重试。',
          }
        }
        if (/not accessible|permission|scope/i.test(error.message)) {
          return {
            title: '令牌权限不足',
            hint: '请确认令牌具备 Discussions: Read and write 与 Metadata: Read，且已授权到目标私有仓库。',
          }
        }
        return {
          title: '没有访问权限',
          hint: '确认当前账号是该私有仓库的协作者；组织仓库可能还需完成 SSO 授权。',
        }
      }
      case 'NOT_FOUND':
        return {
          title: '找不到数据',
          hint: error.message || '仓库或聊天流不存在，或已被删除。',
        }
      case 'NETWORK':
        return {
          title: '网络异常',
          hint: '无法连接 api.github.com，请检查网络后重试。',
        }
      case 'OAUTH_ERROR':
        return {
          title: 'GitHub 授权未完成',
          hint: error.message || '请重新获取验证码后再试。',
        }
      case 'WORKER_NOT_CONFIGURED':
        return {
          title: '认证交换层未配置',
          hint: '请使用 PAT 登录，或部署 Cloudflare Worker 并配置 VITE_OAUTH_EXCHANGE_URL。',
        }
      case 'WORKER_UNREACHABLE':
        return {
          title: '认证交换层不可达',
          hint: 'App 登录与令牌刷新暂不可用；已登录会话与 PAT 通道不受影响。',
        }
      case 'GRAPHQL':
        return {
          title: 'GitHub 返回错误',
          hint: error.message || '请稍后重试。',
        }
      default:
        return {
          title: '请求失败',
          hint: error.message || '请稍后重试。',
        }
    }
  }

  if (error instanceof Error) {
    return {
      title: '出现异常',
      hint: error.message,
    }
  }

  return {
    title: '出现未知错误',
    hint: '请刷新页面后重试。',
  }
}

export function errorText(error: unknown): string {
  const copy = describeError(error)
  return `${copy.title}：${copy.hint}`
}
