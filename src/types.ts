/** GitHub 上的“我”，仅用于气泡分栏与顶栏展示 */
export interface Viewer {
  login: string
  avatarUrl: string
}

/** DiscussionComment 节点 */
export interface CommentNode {
  id: string
  body: string
  bodyHTML: string
  createdAt: string
  author: Viewer | null
}

/** 渲染层消息；pending / failed 为乐观更新状态 */
export interface ChatMessage {
  id: string
  body: string
  bodyHTML?: string
  createdAt: string
  author: Viewer | null
  pending?: boolean
  failed?: boolean
}
