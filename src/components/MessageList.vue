<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { ChatMessage } from '../types'
import type { ErrorCopy } from '../utils/errors'
import { formatClock, formatDay, sameDay } from '../utils/format'
import { renderMessageBody } from '../utils/sanitize'
import UserAvatar from './UserAvatar.vue'

const props = defineProps<{
  messages: ChatMessage[]
  me: string
  loadingInitial: boolean
  loadingOlder: boolean
  hasMore: boolean
  error: ErrorCopy | null
}>()

const emit = defineEmits<{
  (event: 'load-older'): void
  (event: 'retry-message', id: string): void
  (event: 'retry'): void
}>()

const scrollEl = ref<HTMLElement | null>(null)
let stickToBottom = true
let olderRequested = false
const pendingRestore = { active: false, height: 0, top: 0 }

const rows = computed(() =>
  props.messages.map((message, index) => {
    const previous = props.messages[index - 1]
    const sameAuthor = Boolean(
      previous &&
        previous.author?.login &&
        previous.author.login === message.author?.login,
    )
    const closeEnough = previous
      ? Math.abs(
          new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime(),
        ) <
        5 * 60_000
      : false
    const newDay = !previous || !sameDay(previous.createdAt, message.createdAt)
    return {
      message,
      compact: sameAuthor && closeEnough && !newDay,
      newDay,
    }
  }),
)

function isOwn(message: ChatMessage): boolean {
  return Boolean(props.me && message.author?.login === props.me)
}

function avatarUrl(message: ChatMessage): string {
  return message.author?.avatarUrl ?? ''
}

function avatarName(message: ChatMessage): string {
  return message.author?.login ?? '?'
}

function captureForOlder(): void {
  const el = scrollEl.value
  if (!el) return
  pendingRestore.active = true
  pendingRestore.height = el.scrollHeight
  pendingRestore.top = el.scrollTop
}

function requestOlder(): void {
  if (olderRequested || props.loadingOlder || props.loadingInitial || !props.hasMore) return
  olderRequested = true
  captureForOlder()
  emit('load-older')
}

function onScroll(): void {
  const el = scrollEl.value
  if (!el) return
  stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  if (el.scrollTop < 48 && props.hasMore) requestOlder()
}

watch(
  () => props.loadingOlder,
  (loading) => {
    if (!loading) olderRequested = false
  },
)

watch(
  () => props.messages.length,
  async (count, previous) => {
    const el = scrollEl.value
    if (!el) return
    if (pendingRestore.active) {
      await nextTick()
      el.scrollTop = el.scrollHeight - pendingRestore.height + pendingRestore.top
      pendingRestore.active = false
      stickToBottom = false
      return
    }
    if (count > previous) {
      await nextTick()
      if (stickToBottom || previous === 0) {
        el.scrollTop = el.scrollHeight
        stickToBottom = true
      }
    }
  },
  { flush: 'post' },
)
</script>

<template>
  <div ref="scrollEl" class="message-list" @scroll.passive="onScroll">
    <div class="message-list__inner">
      <div class="message-list__top">
        <button
          v-if="hasMore && !loadingInitial && messages.length"
          class="load-more"
          type="button"
          :disabled="loadingOlder"
          @click="requestOlder"
        >
          <span v-if="loadingOlder" class="spinner" aria-hidden="true"></span>
          {{ loadingOlder ? '正在加载更早的消息…' : '加载更早的消息' }}
        </button>
        <p v-else-if="!loadingInitial && messages.length" class="message-list__start">
          已经到最早的消息了
        </p>
      </div>

      <div v-if="loadingInitial && messages.length === 0" class="message-skeleton" aria-hidden="true">
        <div v-for="index in 5" :key="index" class="message-skeleton__row" :class="`message-skeleton__row--${index % 2 ? 'left' : 'right'}`">
          <span class="message-skeleton__avatar"></span>
          <span class="message-skeleton__bubble" :style="{ width: `${180 + ((index * 53) % 160)}px` }"></span>
        </div>
      </div>

      <div v-else-if="error && messages.length === 0" class="chat-state">
        <span class="chat-state__mark">!</span>
        <h3>{{ error.title }}</h3>
        <p>{{ error.hint }}</p>
        <button class="btn btn--primary" type="button" @click="emit('retry')">重试</button>
      </div>

      <div v-else-if="messages.length === 0" class="chat-state">
        <span class="chat-state__mark">#</span>
        <h3>还没有消息</h3>
        <p>在下方输入框发出第一条消息，它会同步到这个私有仓库的 general 讨论里。</p>
      </div>

      <template v-else>
        <template v-for="row in rows" :key="row.message.id">
          <div v-if="row.newDay" class="day-divider">
            <span>{{ formatDay(row.message.createdAt) }}</span>
          </div>

          <article
            class="msg"
            :class="{
              'msg--own': isOwn(row.message),
              'msg--compact': row.compact,
              'msg--pending': row.message.pending,
              'msg--failed': row.message.failed,
            }"
          >
            <span v-if="row.compact" class="msg__avatar-spacer" aria-hidden="true"></span>
            <UserAvatar
              v-else
              class="msg__avatar"
              :login="avatarName(row.message)"
              :src="avatarUrl(row.message)"
            />

            <div class="msg__content">
              <div v-if="!row.compact" class="msg__meta">
                <span class="msg__author">
                  {{ isOwn(row.message) ? '你' : row.message.author?.login ?? '未知成员' }}
                </span>
                <time :datetime="row.message.createdAt">
                  {{ formatClock(row.message.createdAt) }}
                </time>
                <span v-if="row.message.pending" class="msg__tag">发送中…</span>
              </div>

              <div class="msg__bubble">
                <div class="md" v-html="renderMessageBody(row.message)"></div>
                <button
                  v-if="row.message.failed"
                  class="msg__retry"
                  type="button"
                  @click="emit('retry-message', row.message.id)"
                >
                  发送失败 · 点击重试
                </button>
              </div>
            </div>
          </article>
        </template>
      </template>
    </div>
  </div>
</template>
