<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { initials } from '../utils/format'

const props = defineProps<{
  login: string
  src?: string | null
  small?: boolean
}>()

const failed = ref(false)

// 切换账号或头像地址变化时重试加载，避免一次失败后永久显示首字母
watch(
  () => [props.login, props.src],
  () => {
    failed.value = false
  },
)

const showImage = computed(() => Boolean(props.src) && !failed.value)
const fallback = computed(() => initials(props.login || '?'))
</script>

<template>
  <span class="avatar" :class="{ 'avatar--sm': small }">
    <span class="avatar__fallback">{{ fallback }}</span>
    <img
      v-if="showImage"
      :src="props.src ?? ''"
      alt=""
      loading="lazy"
      referrerpolicy="no-referrer"
      @error="failed = true"
    />
  </span>
</template>
