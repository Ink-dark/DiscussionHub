import { GitHubApiError, graphql } from '../github'
import { Q_VIEWER } from '../graphqlDocuments'
import type { Viewer } from '../types'

/** 去掉粘贴时带进来的空白与换行 */
export function normalizePat(input: string): string {
  return input.replace(/\s+/g, '')
}

/** 通道 A：用自带 PAT 查询 viewer，成功即视为令牌有效 */
export async function verifyPat(token: string): Promise<Viewer> {
  const data = await graphql<{ viewer: Viewer | null }>(
    Q_VIEWER,
    {},
    { token, tolerateErrors: false },
  )
  if (!data.viewer?.login) {
    throw new GitHubApiError('BAD_CREDENTIALS', '无法读取 GitHub 身份')
  }
  return data.viewer
}
