import DOMPurify from 'dompurify'

// 消息 HTML 来自 GitHub 渲染结果，展示前统一净化；链接一律新窗口且不带 referrer。
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  const element = node as Element
  if (element.tagName === 'A') {
    element.setAttribute('target', '_blank')
    element.setAttribute('rel', 'noopener noreferrer nofollow')
  }
  if (element.tagName === 'IMG') {
    element.setAttribute('loading', 'lazy')
    element.setAttribute('referrerpolicy', 'no-referrer')
  }
})

export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }
  return text.replace(/[&<>"']/g, (char) => map[char] ?? char)
}

export function plainTextToHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br>')
}

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target'],
  })
}

export function renderMessageBody(message: { bodyHTML?: string; body: string }): string {
  if (message.bodyHTML) return sanitizeHtml(message.bodyHTML)
  return plainTextToHtml(message.body)
}
