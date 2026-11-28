<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DeviceFlowState } from '../stores/session'
import { formatCountdown } from '../utils/format'

const props = defineProps<{ state: DeviceFlowState }>()
const emit = defineEmits<{
  (event: 'cancel'): void
  (event: 'restart'): void
}>()

const copied = ref(false)
const busy = computed(
  () =>
    props.state.phase === 'waiting' ||
    props.state.phase === 'polling' ||
    props.state.phase === 'slow_down',
)
const canRestart = computed(
  () => props.state.phase === 'expired' || props.state.phase === 'error',
)

let copyTimer: number | undefined

async function copyCode(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.state.code.userCode)
    copied.value = true
    if (copyTimer !== undefined) window.clearTimeout(copyTimer)
    copyTimer = window.setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    // 剪贴板不可用时用户仍可手动选中
  }
}
</script>

<template>
  <div class="modal-backdrop">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="device-title">
      <header class="modal__head">
        <div>
          <p class="eyebrow">GitHub App · 设备流</p>
          <h2 id="device-title">在 GitHub 上确认授权</h2>
        </div>
        <button class="icon-btn" type="button" aria-label="关闭" @click="emit('cancel')">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path
              d="M3.5 3.5l9 9m0-9l-9 9"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </header>

      <ol class="steps">
        <li>打开 <strong>github.com/login/device</strong>（只认这个域名）。</li>
        <li>输入下面的一次性验证码，并确认授权给这个 App。</li>
        <li>回到本页，登录会自动完成，无需刷新。</li>
      </ol>

      <div class="device-code">
        <span class="device-code__value">{{ state.code.userCode }}</span>
        <button class="btn btn--ghost btn--sm" type="button" @click="copyCode">
          {{ copied ? '已复制' : '复制' }}
        </button>
      </div>

      <div class="device-status" :class="`device-status--${state.phase}`">
        <span v-if="busy" class="spinner" aria-hidden="true"></span>
        <span>{{ state.message }}</span>
      </div>

      <p class="device-expiry">
        <template v-if="state.phase === 'expired'">验证码已失效</template>
        <template v-else>验证码 <strong>{{ formatCountdown(state.secondsLeft) }}</strong> 后过期</template>
      </p>

      <div class="modal__actions">
        <a
          class="btn btn--primary"
          :href="state.code.verificationUriComplete"
          target="_blank"
          rel="noopener noreferrer"
        >
          打开授权页
        </a>
        <button
          v-if="canRestart"
          class="btn btn--soft"
          type="button"
          @click="emit('restart')"
        >
          重新获取验证码
        </button>
        <button class="btn btn--ghost" type="button" @click="emit('cancel')">取消</button>
      </div>

      <p class="modal__foot">
        验证码仅用于本次登录；令牌由浏览器持有，交换层不会记录任何凭据。
      </p>
    </div>
  </div>
</template>
