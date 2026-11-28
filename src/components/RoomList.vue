<script setup lang="ts">
import type { RoomView } from '../stores/rooms'
import { initials } from '../utils/format'

defineProps<{
  rooms: RoomView[]
  activeKey: string
}>()

const emit = defineEmits<{
  (event: 'select', key: string): void
}>()
</script>

<template>
  <div class="room-list">
    <button
      v-for="room in rooms"
      :key="room.key"
      type="button"
      class="room"
      :class="{ 'room--active': room.key === activeKey }"
      @click="emit('select', room.key)"
    >
      <span class="room__avatar">{{ initials(room.label) }}</span>
      <span class="room__meta">
        <span class="room__name">{{ room.label }}</span>
        <span class="room__sub">{{ room.owner }}/{{ room.repo }}</span>
      </span>
      <span
        v-if="room.unread && room.key !== activeKey"
        class="room__dot"
        aria-label="有新消息"
      ></span>
      <span
        v-else-if="room.status === 'error'"
        class="room__alert"
        aria-label="房间加载失败"
      >!</span>
    </button>
  </div>
</template>
