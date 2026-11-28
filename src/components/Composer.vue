<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useComposerStore } from '../stores/composer'

const props = defineProps<{
  roomKey: string
  disabled: boolean
  sending: boolean
}>()

const emit = defineEmits<{
  (event: 'send', text: string): void
}>()

const composer = useComposerStore()
const textarea = ref<HTMLTextAreaElement | null>(null)

const text = computed({
  get: () => composer.get(props.roomKey),
  set: (value: string) => composer.set(props.roomKey, value),
})

const canSend = computed(
  () => !props.disabled && !props.sending && text.value.trim().length > 0,
)

function resize(): void {
  const el = textarea.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 180)}px`
}

function onInput(event: Event): void {
  const target = event.target as HTMLTextAreaElement
  text.value = target.value
  resize()
}

function submit(): void {
  if (!canSend.value) return
  const value = text.value.trim()
  text.value = ''
  nextTick(resize)
  emit('send', value)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  submit()
}

watch(text, () => nextTick(resize))
onMounted(resize)
</script>

<template>
  <div class="composer">
    <div class="composer__box" :class="{ 'composer__box--disabled': disabled }">
      <textarea
        ref="textarea"
        class="composer__input"
        rows="1"
        :value="text"
        :disabled="disabled"
        :placeholder="disabled ? '当前房间暂不可发送消息' : `发消息到 #general…`"
        spellcheck="false"
        @input="onInput"
        @keydown="onKeydown"
      ></textarea>
      <button
        class="composer__send"
        type="button"
        :disabled="!canSend"
        :aria-label="sending ? '发送中' : '发送消息'"
        @click="submit"
      >
        <span v-if="sending" class="spinner spinner--light" aria-hidden="true"></span>
        <svg v-else viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <path
            d="M3.4 10.2L16.2 4.2c.5-.2 1 .3.8.8l-4.1 11.2c-.2.5-.9.6-1.2.1l-2.1-3.6-3.8-1.6c-.5-.2-.5-.9-.4-.9z"
            fill="currentColor"
          />
        </svg>
      </button>
    </div>
    <div class="composer__meta">
      <span><kbd>Enter</kbd> 发送 · <kbd>Shift</kbd> + <kbd>Enter</kbd> 换行</span>
      <span v-if="disabled">只读：当前令牌缺少 Discussions 写权限</span>
      <span v-else>正文按纯文本提交</span>
    </div>
  </div>
</template>
