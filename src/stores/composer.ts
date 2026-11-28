import { reactive } from 'vue'
import { defineStore } from 'pinia'
import { loadDrafts, saveDrafts } from '../auth/session'

/** 草稿按房间本地暂存，刷新 / 重登不丢未发送文案 */
export const useComposerStore = defineStore('composer', () => {
  const drafts = reactive<Record<string, string>>(loadDrafts())
  let saveTimer: number | undefined

  function persistNow(): void {
    if (saveTimer !== undefined) {
      window.clearTimeout(saveTimer)
      saveTimer = undefined
    }
    saveDrafts({ ...drafts })
  }

  function schedulePersist(): void {
    if (saveTimer !== undefined) window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      saveTimer = undefined
      saveDrafts({ ...drafts })
    }, 250)
  }

  function get(key: string): string {
    return drafts[key] ?? ''
  }

  function set(key: string, value: string): void {
    if (value) drafts[key] = value
    else delete drafts[key]
    schedulePersist()
  }

  function clear(key: string): void {
    if (!(key in drafts)) return
    delete drafts[key]
    schedulePersist()
  }

  function clearAll(): void {
    for (const key of Object.keys(drafts)) delete drafts[key]
    persistNow()
  }

  window.addEventListener('beforeunload', persistNow)

  return {
    drafts,
    get,
    set,
    clear,
    clearAll,
  }
})
