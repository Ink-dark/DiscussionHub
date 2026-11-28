import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import { GitHubApiError, graphql } from '../github'
import { M_ENSURE_ROOM, Q_ROOM } from '../graphqlDocuments'
import { loadReadMarks, saveReadMarks, type ReadMark } from '../auth/session'
import { describeError, type ErrorCopy } from '../utils/errors'
import { useSessionStore } from './session'

const ROOM_DISCUSSION_TITLE = 'general'

export interface RoomConfig {
  key: string
  owner: string
  repo: string
  label: string
}

export type RoomStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface RoomRuntime {
  repositoryId: string | null
  discussionId: string | null
  latestCommentId: string | null
  lastReadId: string | null
  status: RoomStatus
  error: ErrorCopy | null
}

export interface RoomView extends RoomConfig {
  unread: boolean
  status: RoomStatus
  error: ErrorCopy | null
  latestCommentId: string | null
  lastReadId: string | null
}

interface RoomQueryData {
  repository: {
    id: string
    discussionCategories: { nodes: { id: string; name: string }[] }
    discussions: {
      nodes: {
        id: string
        number: number
        title: string
        comments: { nodes: { id: string }[] }
      }[]
    }
  } | null
}

interface EnsureRoomData {
  createDiscussion: {
    discussion: { id: string; number: number }
  }
}

interface BadgeRepository {
  discussions: {
    nodes: {
      title: string
      comments: { nodes: { id: string }[] }
    }[]
  }
}

const NAME_PATTERN = /^[A-Za-z0-9._-]+$/

export const useRoomsStore = defineStore('rooms', () => {
  const configError = ref<string | null>(null)
  const rooms = ref<RoomConfig[]>(parseRooms(import.meta.env.VITE_GITHUB_ROOMS, configError))

  const marks: Record<string, ReadMark> = loadReadMarks()
  const runtimes = reactive<Record<string, RoomRuntime>>({})

  for (const room of rooms.value) {
    runtimes[room.key] = {
      repositoryId: null,
      discussionId: null,
      latestCommentId: null,
      lastReadId: marks[room.key]?.id ?? null,
      status: 'idle',
      error: null,
    }
  }

  const pending = new Map<string, Promise<{ discussionId: string; repositoryId: string }>>()

  const sessionStore = useSessionStore()

  const roomViews = computed<RoomView[]>(() =>
    rooms.value.map((room) => {
      const runtime = runtimes[room.key]
      return {
        ...room,
        unread: Boolean(
          runtime.latestCommentId && runtime.latestCommentId !== runtime.lastReadId,
        ),
        status: runtime.status,
        error: runtime.error,
        latestCommentId: runtime.latestCommentId,
        lastReadId: runtime.lastReadId,
      }
    }),
  )

  function find(owner: string, repo: string): RoomConfig | null {
    const key = `${owner}/${repo}`.toLowerCase()
    return rooms.value.find((room) => room.key === key) ?? null
  }

  function runtimeFor(key: string): RoomRuntime | null {
    return runtimes[key] ?? null
  }

  function markRead(key: string, commentId: string): void {
    const runtime = runtimes[key]
    if (!runtime || !commentId) return
    runtime.lastReadId = commentId
    runtime.latestCommentId = commentId
    marks[key] = { id: commentId, at: Date.now() }
    saveReadMarks(marks)
  }

  function noteLatest(key: string, commentId: string | null): void {
    const runtime = runtimes[key]
    if (!runtime) return
    runtime.latestCommentId = commentId
  }

  async function doEnsureRoom(key: string): Promise<{ discussionId: string; repositoryId: string }> {
    const config = rooms.value.find((room) => room.key === key)
    const runtime = runtimes[key]
    if (!config || !runtime) {
      throw new GitHubApiError('NOT_FOUND', '该房间未在配置中')
    }

    runtime.status = 'loading'
    runtime.error = null

    try {
      const data = await sessionStore.withAuth((token) =>
        graphql<RoomQueryData>(
          Q_ROOM,
          { owner: config.owner, name: config.repo },
          { token },
        ),
      )

      const repository = data.repository
      if (!repository) {
        throw new GitHubApiError(
          'NOT_FOUND',
          `仓库 ${config.owner}/${config.repo} 不存在，或当前账号没有访问权限`,
        )
      }

      const categories = repository.discussionCategories.nodes
      if (categories.length === 0) {
        throw new GitHubApiError(
          'FORBIDDEN',
          '仓库尚未开启 Discussions，请先在仓库 Settings → General 中开启',
        )
      }

      let discussion =
        repository.discussions.nodes.find(
          (item) => item.title.trim().toLowerCase() === ROOM_DISCUSSION_TITLE,
        ) ?? null

      if (discussion) {
        runtime.latestCommentId = discussion.comments.nodes[0]?.id ?? null
      } else {
        const created = await sessionStore.withAuth((token) =>
          graphql<EnsureRoomData>(
            M_ENSURE_ROOM,
            {
              repo: repository.id,
              cat: categories[0].id,
              title: ROOM_DISCUSSION_TITLE,
            },
            { token },
          ),
        )
        discussion = {
          id: created.createDiscussion.discussion.id,
          number: created.createDiscussion.discussion.number,
          title: ROOM_DISCUSSION_TITLE,
          comments: { nodes: [] },
        }
        runtime.latestCommentId = null
      }

      runtime.repositoryId = repository.id
      runtime.discussionId = discussion.id
      runtime.status = 'ready'
      return { discussionId: discussion.id, repositoryId: repository.id }
    } catch (error) {
      runtime.status = 'error'
      runtime.error = describeError(error)
      throw error
    }
  }

  /** 解析 repositoryId / discussionId；不存在 general 流时自动创建 */
  async function ensureRoom(key: string): Promise<{ discussionId: string; repositoryId: string }> {
    const runtime = runtimes[key]
    if (!runtime) throw new GitHubApiError('NOT_FOUND', '该房间未在配置中')
    if (runtime.discussionId && runtime.repositoryId) {
      return { discussionId: runtime.discussionId, repositoryId: runtime.repositoryId }
    }
    const existing = pending.get(key)
    if (existing) return existing

    const task = doEnsureRoom(key).finally(() => {
      pending.delete(key)
    })
    pending.set(key, task)
    return task
  }

  function resetRoom(key: string): void {
    const runtime = runtimes[key]
    if (!runtime) return
    // 手动重试时重新解析仓库与聊天流，覆盖仓库改名 / 讨论被删等情况
    runtime.repositoryId = null
    runtime.discussionId = null
    runtime.status = 'idle'
    runtime.error = null
  }

  /** 登出时清空运行时状态（本地已读标记由会话层一并清除） */
  function resetRuntime(): void {
    for (const room of rooms.value) {
      runtimes[room.key] = {
        repositoryId: null,
        discussionId: null,
        latestCommentId: null,
        lastReadId: null,
        status: 'idle',
        error: null,
      }
    }
    for (const key of Object.keys(marks)) delete marks[key]
  }

  /** 侧栏未读角标：一次请求批量取每个房间 general 流的最新 comment id */
  async function refreshBadges(): Promise<void> {
    if (!sessionStore.isAuthed || rooms.value.length === 0) return

    const fields = rooms.value
      .map(
        (room, index) =>
          `r${index}: repository(owner: ${JSON.stringify(room.owner)}, name: ${JSON.stringify(
            room.repo,
          )}) { discussions(first: 50) { nodes { title comments(last: 1) { nodes { id } } } } }`,
      )
      .join(' ')

    const query = `query RoomBadges { ${fields} }`

    try {
      const data = await sessionStore.withAuth((token) =>
        graphql<Record<string, BadgeRepository | null>>(query, {}, { token, tolerateErrors: true }),
      )

      rooms.value.forEach((room, index) => {
        const repository = data[`r${index}`]
        if (!repository) return
        const discussion = repository.discussions.nodes.find(
          (item) => item.title.trim().toLowerCase() === ROOM_DISCUSSION_TITLE,
        )
        const latest = discussion?.comments.nodes[0]?.id ?? null
        noteLatest(room.key, latest)
      })
    } catch {
      // 角标属非关键路径，静默失败即可；鉴权失效由会话层统一处理
    }
  }

  return {
    rooms,
    roomViews,
    configError,
    find,
    runtimeFor,
    ensureRoom,
    resetRoom,
    resetRuntime,
    markRead,
    noteLatest,
    refreshBadges,
  }
})

function parseRooms(
  raw: string | undefined,
  configError: { value: string | null },
): RoomConfig[] {
  if (!raw || !raw.trim()) {
    configError.value =
      '尚未配置房间。请在构建环境设置 VITE_GITHUB_ROOMS，例如 [{"owner":"your-org","repo":"team-chat"}]。'
    return []
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    configError.value = 'VITE_GITHUB_ROOMS 不是合法 JSON，请检查构建环境变量。'
    return []
  }

  if (!Array.isArray(parsed)) {
    configError.value = 'VITE_GITHUB_ROOMS 必须是数组。'
    return []
  }

  const seen = new Set<string>()
  const result: RoomConfig[] = []

  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const owner = typeof record.owner === 'string' ? record.owner.trim() : ''
    const repo = typeof record.repo === 'string' ? record.repo.trim() : ''
    if (!owner || !repo || !NAME_PATTERN.test(owner) || !NAME_PATTERN.test(repo)) continue

    const key = `${owner}/${repo}`.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    result.push({
      key,
      owner,
      repo,
      label:
        typeof record.label === 'string' && record.label.trim()
          ? record.label.trim()
          : repo,
    })
  }

  if (result.length === 0) {
    configError.value =
      'VITE_GITHUB_ROOMS 中没有有效的房间（每项需要非空的 owner 与 repo）。'
  }

  return result
}
