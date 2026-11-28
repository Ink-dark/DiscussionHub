/**
 * GitHub OAuth 极薄交换层（Cloudflare Worker）
 *
 * 职责：把白名单内两个路径转发到 github.com/login/*，注入 client_id，处理 CORS。
 * 硬约束：
 *  - 只转发 /device/code 与 /access_token，不做开放代理；
 *  - 不碰 api.github.com，不读写 Discussions；
 *  - 不写 KV / D1 / R2 / 日志，不记录 device_code / refresh_token / access_token；
 *  - ALLOWED_ORIGIN 精确匹配，不使用 *。
 */

const ROUTES = {
  '/device/code': 'https://github.com/login/device/code',
  '/access_token': 'https://github.com/login/oauth/access_token',
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin')
    const allowed = env.ALLOWED_ORIGIN
    if (!origin || origin !== allowed) {
      return new Response('Forbidden', { status: 403 })
    }

    const cors = {
      'Access-Control-Allow-Origin': allowed,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept',
      'Access-Control-Max-Age': '600',
      'Vary': 'Origin',
      'Cache-Control': 'no-store',
    }

    // 预检直接返回，不请求上游
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }
    if (request.method !== 'POST') {
      return reply({ error: 'method_not_allowed' }, 405, cors)
    }

    const upstream = ROUTES[new URL(request.url).pathname]
    if (!upstream) return reply({ error: 'not_found' }, 404, cors)

    // 不记录 body：里面可能有 device_code / refresh_token
    const params = new URLSearchParams(await request.text())
    params.set('client_id', env.GITHUB_CLIENT_ID) // 由 Worker 注入，前端不可篡改
    params.delete('client_secret') // 兜底：绝不透传前端传来的 secret
    if (env.GITHUB_CLIENT_SECRET) {
      params.set('client_secret', env.GITHUB_CLIENT_SECRET) // 可选，仅服务端持有
    }

    const response = await fetch(upstream, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': 'gh-discussions-im-exchange',
      },
      body: params.toString(),
    })

    // 原样透传 status / body；新建 Response 再挂 CORS 头
    return new Response(response.body, {
      status: response.status,
      headers: {
        ...cors,
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
      },
    })
  },
}

function reply(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })
}
