import { reactive } from 'vue'
import { defineStore } from 'pinia'
import { GitHubApiError, graphql } from '../github'
import { M_SEND, Q_MESSAGES } from '../graphqlDocuments'
import { describeError, type ErrorCopy } from '../utils/errors'
import type { ChatMessage, CommentNode } from '../types'
import { useSessionStore } from './session'

interface CommentsConnection {
  pageInfo: {
    startCursor: string | null
    hasPreviousPage: boolean
  }
  nodes: CommentNode[]
}

interface MessagesData {
  node: { comments?: CommentsConnection } | null
}

interface SendData {
  addDiscussionComment: {
    comment: CommentNode
  }
}

export interface RoomMessageState {
  items: ChatMessage[]
  startCursor: string | null
  hasMore: boolean
  loadingInitial: boolean
  loadingOlder: boolean
  sending: boolean
  lastSyncAt: number | null
  /** 初始加载错误（阻断整个消息区） */
  error: ErrorCopy | null
  /** 轮询错误（非阻断，顶部提示） */
  syncError: ErrorCopy | null
  /** 发送错误（输入框附近提示） */
  sendError: ErrorCopy | null
}

function createState(): RoomMessageState {
  return {
    items: [],
    startCursor: null,
    hasMore: false,
    loadingInitial: false,
    loadingOlder: false,
    sending: false,
    lastSyncAt: null,
    error: null,
    syncError: null,
    sendError: null,
  }
}

function toMessage(node: CommentNode): ChatMessage {
  return {
    id: node.id,
    body: node.body,
    bodyHTML: node.bodyHTML,
    createdAt: node.createdAt,
    author: node.author,
  }
}

function sortMessages(items: ChatMessage[]): void {
  items.sort((left, right) => {
    const leftTime = Date.parse(left.createdAt)
    const rightTime = Date.parse(right.createdAt)
    if (leftTime !== rightTime) return leftTime - rightTime
    return left.id.localeCompare(right.id)
  })
}

function mergeNodes(state: RoomMessageState, nodes: CommentNode[]): number {
  const byId = new Map(state.items.map((item) => [item.id, item]))
  let added = 0
  for (const node of nodes) {
    const incoming = toMessage(node)
    const existing = byId.get(incoming.id)
    if (existing) {
      existing.body = incoming.body
      existing.bodyHTML = incoming.bodyHTML
      existing.createdAt = incoming.createdAt
      existing.author = incoming.author
      existing.pending = false
      existing.failed = false
    } else {
      state.items.push(incoming)
      byId.set(incoming.id, incoming)
      added += 1
    }
  }
  if (added > 0) sortMessages(state.items)
  return added
}

export const useMessagesStore = defineStore('messages', () => {
  const byRoom = reactive<Record<string, RoomMessageState>>({})
  const sessionStore = useSessionStore()

  function stateFor(key: string): RoomMessageState {
    if (!byRoom[key]) byRoom[key] = createState()
    return byRoom[key]
  }

  async function fetchPage(
    discussionId: string,
    before: string | null,
  ): Promise<CommentsConnection> {
    const data = await sessionStore.withAuth((token) =>
      graphql<MessagesData>(
        Q_MESSAGES,
        { id: discussionId, before },
        { token },
      ),
    )
    const connection = data.node?.comments
    if (!connection) {
      throw new GitHubApiError('NOT_FOUND', '聊天流不存在或已被删除')
    }
    return connection
  }

  async function loadInitial(key: string, discussionId: string): Promise<void> {
    const state = stateFor(key)
    if (state.loadingInitial) return
    state.loadingInitial = true
    state.error = null
    try {
      const connection = await fetchPage(discussionId, null)
      state.items = connection.nodes.map(toMessage)
      sortMessages(state.items)
      state.startCursor = connection.pageInfo.startCursor
      state.hasMore = connection.pageInfo.hasPreviousPage
      state.lastSyncAt = Date.now()
      state.syncError = null
    } catch (error) {
      state.error = describeError(error)
    } finally {
      state.loadingInitial = false
    }
  }

  async function loadOlder(key: string, discussionId: string): Promise<void> {
    const state = stateFor(key)
    if (state.loadingOlder || !state.hasMore || !state.startCursor) return
    state.loadingOlder = true
    try {
      const connection = await fetchPage(discussionId, state.startCursor)
      const existingIds = new Set(state.items.map((item) => item.id))
      const older = connection.nodes
        .filter((node) => !existingIds.has(node.id))
        .map(toMessage)
      if (older.length > 0) state.items = [...older, ...state.items]
      state.startCursor = connection.pageInfo.startCursor
      state.hasMore = connection.pageInfo.hasPreviousPage
      state.error = null
      state.syncError = null
      state.lastSyncAt = Date.now()
    } catch (error) {
      state.syncError = describeError(error)
    } finally {
      state.loadingOlder = false
    }
  }

  /** 轮询最新一批并按 id 增量合并；返回新增条数与最新 id */
  async function poll(
    key: string,
    discussionId: string,
  ): Promise<{ added: number; latestId: string | null }> {
    const state = stateFor(key)
    if (state.loadingInitial) return { added: 0, latestId: null }
    try {
      const connection = await fetchPage(discussionId, null)
      const added = mergeNodes(state, connection.nodes)
      const latestId = connection.nodes[connection.nodes.length - 1]?.id ?? null
      state.lastSyncAt = Date.now()
      state.syncError = null
      return { added, latestId }
    } catch (error) {
      state.syncError = describeError(error)
      return { added: 0, latestId: null }
    }
  }

  async function send(key: string, discussionId: string, rawText: string): Promise<boolean> {
    const text = rawText.trim()
    if (!text) return false

    const state = stateFor(key)
    const tempId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const optimistic: ChatMessage = {
      id: tempId,
      body: text,
      createdAt: new Date().toISOString(),
      author: sessionStore.viewer,
      pending: true,
    }
    state.items.push(optimistic)
    state.sending = true
    state.sendError = null

    try {
      const data = await sessionStore.withAuth((token) =>
        graphql<SendData>(M_SEND, { discussionId, body: text }, { token }),
      )
      const comment = data.addDiscussionComment.comment
      const tempIndex = state.items.findIndex((item) => item.id === tempId)
      const duplicateIndex = state.items.findIndex((item) => item.id === comment.id)

      if (tempIndex >= 0) {
        if (duplicateIndex >= 0 && duplicateIndex !== tempIndex) {
          // 轮询先带回了真实消息：去掉乐观气泡即可
          state.items.splice(tempIndex, 1)
        } else {
          Object.assign(state.items[tempIndex], {
            id: comment.id,
            body: comment.body || text,
            bodyHTML: comment.bodyHTML,
            createdAt: comment.createdAt,
            author: comment.author ?? sessionStore.viewer,
            pending: false,
            failed: false,
          })
        }
      }

      sortMessages(state.items)
      state.lastSyncAt = Date.now()
      return true
    } catch (error) {
      const tempIndex = state.items.findIndex((item) => item.id === tempId)
      if (tempIndex >= 0) {
        state.items[tempIndex].pending = false
        state.items[tempIndex].failed = true
      }
      state.sendError = describeError(error)
      return false
    } finally {
      state.sending = false
    }
  }

  async function retry(
    key: string,
    discussionId: string,
    messageId: string,
  ): Promise<boolean> {
    const state = stateFor(key)
    const index = state.items.findIndex((item) => item.id === messageId && item.failed)
    if (index < 0) return false
    const body = state.items[index].body
    state.items.splice(index, 1)
    return send(key, discussionId, body)
  }

  function clearRoom(key: string): void {
    delete byRoom[key]
  }

  function resetAll(): void {
    for (const key of Object.keys(byRoom)) delete byRoom[key]
  }

  return {
    byRoom,
    stateFor,
    loadInitial,
    loadOlder,
    poll,
    send,
    retry,
    clearRoom,
    resetAll,
  }
})
