# PRD｜GitHub Discussions 极简 IM

| 项 | 内容 |
|---|---|
| 版本 | **v1.1 定稿** |
| 日期 | 2026-11-27 |
| 技术栈 | Vite + Vue 3 + Pinia + Vue Router（hash） |
| 前端部署 | GitHub Pages（静态） |
| 认证交换层 | Cloudflare Workers 边缘函数（方案一，本版落地） |
| 状态 | 已决策，可进入 M0 技术验证 |

> **一句话**：把 GitHub Discussions 当消息存储，把 Pages 当唯一前端。成员就是仓库协作者——GitHub 已经替你管了权限，浏览器里那枚 token 只是把这份权限带进页面。整个产品不做账号、不做成员、不做业务后端，只做一件事：**在一个私有仓库里，把评论流变成聊天窗口**。

---

## 版本变更

| 版本 | 变更 |
|---|---|
| v0.1 | 初版，含 Category 分组与双认证假设 |
| v0.2 | 收敛为极简 IM：仓库=群组、不管成员、私有仓库、token 存浏览器 |
| v0.3 | 恢复双通道认证，引入 App 设备流与浏览器登录态 |
| v1.0 | 合并为完整 PRD，留一个待决策项：设备流跨域不通时怎么办 |
| **v1.1** | **决策落地：采用方案一，引入 Cloudflare Workers 极薄交换层**。修正 `client_secret` 表述；明确数据面不经 Worker；新增 Worker 完整契约与参考实现；移除待确认项 |

---

## 1. 背景、目标与边界

### 1.1 为什么做
小团队想要一个能收发消息、按群组切换、可回溯的极简 IM，但不想维护服务器、数据库和账号系统。私有仓库的 Discussions 天然提供时间线、Markdown、身份归属与访问控制；缺的只是一层 IM 形态的界面。

### 1.2 产品目标

| 编号 | 目标 |
|---|---|
| G1 | **零运维**：前端 `npm run build` 后推 Pages 即可用；无数据库、无自建业务 API |
| G2 | **数据主权**：所有消息落在指定私有仓库的 Discussions，站点只是视图 |
| G3 | **零注册**：用户凭 GitHub 身份进入，不建任何成员表 |
| G4 | **双通道认证**：自带 PAT 或 App 授权二选一，登录态由浏览器持有，刷新不重登 |

### 1.3 非目标
- 不做业务服务端、不做私有成员表、不做加入/退出/在线状态。
- 不做 Category 分组、话题列表/详情页、楼中楼回复。
- 不做 WebSocket 实时、不做消息撤回广播、不做站内审核后台。
- 不替代 GitHub 原生 Discussions 页面；删消息、锁流、移除协作者都在 GitHub 侧完成。

### 1.4 成功指标

| 指标 | 目标 |
|---|---|
| 首次可用 | 粘贴 token 或完成一次设备码授权到看见消息 ≤ 60s |
| 会话保持 | 刷新页面 0 次重新授权，顶栏直接恢复 `@login` |
| 发送成功率 | 有效令牌下 ≥ 99%（排除限流与权限错误） |
| 数据面纯度 | 消息读写 100% 直连 `api.github.com`，**不经过交换层** |

---

## 2. 定稿口径

| 项 | 结论 |
|---|---|
| 群组 | **一个仓库 = 一个房间**，构建期配置仓库列表，侧栏切换 |
| 成员 | 不建表、不判断、不展示；准入 = GitHub 仓库协作者权限 |
| 私密性 | **私有仓库**；站点 URL 公开 ≠ 内容公开，无 token 读不到任何内容 |
| 聊天流 | 每个仓库挂**一个固定 Discussion**（标题 `general`），`DiscussionComment` = 消息 |
| 认证 | 双通道：① 自带 PAT ② GitHub App 设备流授权，用户二选一 |
| 登录态 | 浏览器 `localStorage` 持有 token + 身份快照；**不是**复用 github.com 的 Cookie |
| 令牌存放 | `localStorage`（已确认接受，不额外加机制） |
| 交换层 | **Cloudflare Workers**，只转发两个 OAuth 端点；不存 token、不碰 Discussions |
| 后端 | 无业务后端。Worker 是认证链路上的无状态转发节点，不是服务端 |

> **术语澄清**：用户所说的「App OAuth」落地为 **GitHub App + Device Flow**。设备流没有回调、只需出站请求，适合静态页。传统带回调的 Web Application Flow 换取令牌时要求 `client_secret`，本方案不采用；`client_secret` 是否需要、以及是否需用于刷新，统一由 Worker 侧持有（见 6.5），绝不进前端。

---

## 3. 领域模型

| IM 概念 | GitHub 实体 | 说明 |
|---|---|---|
| 房间 / 群组 | `Repository` | 配置里的 `owner/name`，解析出 `repositoryId` |
| 聊天流 | 固定 `Discussion` | 一仓库一条；不存在时自动创建 |
| 消息 | `DiscussionComment` | 平铺追加，天然是时间线 |
| 「我」 | `viewer { login avatarUrl }` | 仅用于气泡左右分栏与顶栏展示 |
| 权限 | 仓库协作者关系 | 由 GitHub 判定，前端不重复实现 |

一个仓库只挂一条流，这是「极简」的边界。要多频道时再允许一仓库挂多条 Discussion，属后续扩展。

---

## 4. 角色与核心场景

| 角色 | 描述 | 诉求 |
|---|---|---|
| 成员 | 有仓库权限、已完成任一通道认证 | 进房间即见消息，发消息，翻历史 |
| 维护者 | 仓库管理员 | 在 GitHub 侧开启 Discussions、注册 App、部署 Worker |

**用户故事**
- US1 打开站点，任选一种方式登录，顶栏显示 `@login`，直接进入房间。
- US2 在 `general` 流里发一条消息，气泡立刻出现，GitHub 原生页面同步可见。
- US3 刷新页面，登录态自动恢复，不弹登录框、不丢草稿。
- US4 向上滚动加载更早消息，轮询带回的新消息自动追加且不重复。
- US5 令牌过期或权限不足时，页面给出可操作提示，消息不静默丢失。
- US6 切换房间、登出，本地凭据与未读标记一并清除。

---

## 5. 功能需求

### P0 · 必须有

| 编号 | 功能 | 验收标准 |
|---|---|---|
| F1 | 登录门禁 | 未认证只显示登录页，不渲染消息区；私有仓库无匿名只读 |
| F2 | 通道 A · 自带 PAT | 粘贴 → 查 `viewer` → 落盘；无效 token 明确报错 |
| F3 | 通道 B · App 设备流 | 经 Worker 展示 8 位码 + 一键打开授权页 → 轮询 → 拿 token → 落盘 |
| F4 | 会话恢复 | 启动读 `localStorage`，有 Session 直接进房间，顶栏常驻身份与登出 |
| F5 | 房间切换 | 侧栏列仓库，显示未读小红点（本地记录最后读到的 comment id） |
| F6 | 消息流 | 取最新 30 条 → 滚到底部；向上翻历史；轮询增量追加 |
| F7 | 发送消息 | 乐观插入 `pending` 气泡 → 成功后替换真实 id → 失败转红可重试 |
| F8 | 错误与限流态 | 401 / 403 / 限流 / 网络 / Worker 不可达分别给文案与操作，不白屏 |

### P1 · 应该有

| 编号 | 功能 |
|---|---|
| F9 | 令牌静默刷新（App 通道，**经 Worker**），失败降级重授权 |
| F10 | 草稿本地暂存，刷新/重登不丢未发送文案 |
| F11 | 深链接 `/#/r/{owner}/{repo}` 可直接打开房间 |
| F12 | 手动刷新按钮 + 「上次同步时间」显示 |

### P2 · 选做
暗色模式、@提及补全、消息前端过滤、多仓库批量配置导入。

---

## 6. 认证与会话（核心章节）

### 6.1 一个必须先说清的前提
**「浏览器持有登录态」不等于复用 github.com 的登录 Cookie。** 跨源页面读不到 GitHub 会话，第三方 Cookie 也被浏览器拦截。本产品的登录态 = **自己写入 `localStorage` 的一枚 token + `{login, avatarUrl}` 快照**；GitHub 侧只保留「该用户授权过此 App」的记录。刷新页面由前端自行恢复，全程不跳转、不重新授权。

### 6.2 双通道对比

| | A · 自带令牌 | B · App 设备流 |
|---|---|---|
| 入口 | 粘贴 PAT | 点「用 GitHub 登录」→ 输 8 位码 |
| 前置 | 用户自己造 token | 维护者注册 GitHub App + 部署 Worker |
| 令牌 | `ghp_` / `github_pat_` | `ghu_`（+ 可选 `ghr_`） |
| 权限 | fine-grained PAT 可锁单仓库 | App 注册时的 `Discussions: R/W`，可锁到安装仓库 |
| 网络依赖 | 仅 `api.github.com` | 额外依赖 `VITE_OAUTH_EXCHANGE_URL`（CF Worker） |
| 过期 | 随用户设定 | 默认 8h，可刷新 |
| 前端是否持有 secret | 否 | **否**，一律由 Worker 持有 |

两条通道互不依赖：Worker 不可用时 PAT 通道完全不受影响，产品仍可用。这是双通道最实际的价值。

### 6.3 通道 A：自带 PAT
```
粘贴 → POST https://api.github.com/graphql 查 viewer → 写入 localStorage
```
- **推荐** fine-grained PAT：Resource owner 指定该仓库、`Discussions: Read and write`、`Metadata: Read`，设置过期时间。
- **兜底** Classic PAT：私有仓库需 `repo` scope。登录页用一行小字提示——该 scope 覆盖账号能访问的全部仓库，权限远大于「发消息」。
- 组织仓库若要求细粒度令牌审批，流程需能显示「待审批」状态。

### 6.4 通道 B：GitHub App Device Flow（经 Worker）

```
前端 POST {EXCHANGE}/device/code
  → Worker 注入 client_id → github.com/login/device/code
  → device_code / user_code / verification_uri_complete / interval / expires_in
  → UI 展示大号 8 位码 + 倒计时 + 「打开授权页」（预填码）
  → 用户在 github.com/login/device 确认授权
  → 前端按 interval 轮询 POST {EXCHANGE}/access_token
       grant_type=urn:ietf:params:oauth:grant-type:device_code + device_code
       authorization_pending → 继续 | slow_down → 间隔 +5s
       expired_token / access_denied → 结束并给可重试文案
  → access_token → 查 viewer → 落盘 → 进房间
```

**注册侧检查清单**
- 勾选 **Enable Device Flow**；漏勾会得到 `device_flow_disabled` / 404。
- 填一个 Authorization callback URL（设备流不用回调，但表单必填，填 `http://localhost` 即可）。
- Client ID 形如 `Iv23...`，做格式校验与 trim，避免把 App ID 当 Client ID。
- 权限：`Discussions: Read and write` + `Metadata: Read`，安装到目标私有仓库。
- GitHub App 的权限由注册配置决定，设备流里的 `scope` 参数**不控制权限**；如需启用过期令牌，可传 `offline_access`。

user_code 约 15 分钟过期，UI 给倒计时与一键重发。

### 6.5 交换层契约：Cloudflare Workers（本版新增）

#### 职责边界（硬约束）

| Worker **做** | Worker **绝不做** |
|---|---|
| 把白名单内两个路径转发到 `github.com/login/*` | 不碰 `api.github.com/graphql`，不读、不写、不缓存任何 Discussions 内容 |
| 注入 `client_id`（及可选的 `client_secret`） | 不写 KV / D1 / R2 / 日志，不记录 `device_code`、`refresh_token`、`access_token` |
| 强制 `Accept: application/json` | 不设 Cookie、不向调用方以外的任何一方返回凭据 |
| 处理 CORS 预检与响应头 | 不开放任意 URL 转发（不是开放代理） |
| 原样透传 GitHub 的 status 与 error body | 不改写业务逻辑，不存储任何用户态 |

> **最关键的一条**：**数据面不经 Worker**。登录完成后，所有消息读写都是浏览器直连 `api.github.com/graphql`。Worker 只在「换 token / 刷 token」这几秒钟出现在链路上，且无状态。所以引入边缘函数并没有把消息交给第三方。

#### 接口

| 路径 | 上游 | 用途 |
|---|---|---|
| `POST /device/code` | `https://github.com/login/device/code` | 申请设备码 |
| `POST /access_token` | `https://github.com/login/oauth/access_token` | ① 轮询换取 `ghu_` ② **`grant_type=refresh_token` 静默刷新**（同一端点，白名单已覆盖） |

请求体 `application/x-www-form-urlencoded`；响应原样透传（含 GitHub 用 HTTP 400 + `error` 字段表达 `authorization_pending` 的情况，前端不得当作网络故障抛出）。

> **刷新也走这里**——这是容易漏的一点。开启过期令牌后，8h 到期的静默刷新同样打到 `/access_token`，因此 Worker 天然覆盖，无需新增端点。

#### CORS 与安全约束
- `ALLOWED_ORIGIN` 白名单精确匹配，**不用 `*`**；不匹配的 Origin 直接 403。
- 显式拦截 `OPTIONS` 预检，返回 `204` + CORS 头，**不请求上游**。
- 实际响应必须**新建 Response 对象**再挂 `Access-Control-Allow-Origin`（不能直接改上游响应头），并带 `Vary: Origin`。
- 所有响应带 `Cache-Control: no-store`。
- 前端不传 `client_id`，由 Worker 从 env 注入；同时主动剔除请求体里任何 `client_secret`，防止篡改。
- `client_secret` 若实测需要（部分 App 类型 / 刷新流程可能要求），用 `wrangler secret put` 注入，只在 Worker 进程内使用，**绝不写进 `wrangler.toml`、绝不返回给前端**。M0 用真实 App 实测确认是否需要，架构不受影响。

#### 部署
```bash
npx wrangler deploy
npx wrangler secret put GITHUB_CLIENT_SECRET   # 仅当实测需要
```
得到 `https://gh-im-oauth-exchange.<subdomain>.workers.dev`，填入前端 `VITE_OAUTH_EXCHANGE_URL`。

`ALLOWED_ORIGIN` 填 **origin**（协议 + 域名 + 端口），不含路径。Pages 项目页 `https://<user>.github.io/<repo>/` 的 origin 是 `https://<user>.github.io`。

#### 参考实现（可直接粘贴为 `worker.js`）

```js
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
    params.set('client_id', env.GITHUB_CLIENT_ID)   // 由 Worker 注入，前端不可篡改
    params.delete('client_secret')                   // 兜底：绝不透传前端传来的 secret
    if (env.GITHUB_CLIENT_SECRET) {
      params.set('client_secret', env.GITHUB_CLIENT_SECRET) // 可选，仅服务端持有
    }

    const resp = await fetch(upstream, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': 'gh-discussions-im-exchange',
      },
      body: params.toString(),
    })

    // 原样透传 status / body / GitHub error 字段；新建 Response 挂 CORS 头
    return new Response(resp.body, {
      status: resp.status,
      headers: {
        ...cors,
        'Content-Type': resp.headers.get('Content-Type') || 'application/json',
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
```

```toml
# wrangler.toml
name = "gh-im-oauth-exchange"
main = "worker.js"
compatibility_date = "2026-11-27"

[vars]
ALLOWED_ORIGIN = "https://<user>.github.io"
GITHUB_CLIENT_ID = "Iv23xxxxxxxxxxxxxxxx"
# GITHUB_CLIENT_SECRET 用 wrangler secret put 注入，不要写在这里
```

前端调用封装（`400 + error` 是正常答案，不 throw）：
```ts
const EXCHANGE = import.meta.env.VITE_OAUTH_EXCHANGE_URL

export async function postOAuth(path: '/device/code' | '/access_token',
                                params: Record<string, string>) {
  const res = await fetch(`${EXCHANGE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params).toString(),
  })
  return { status: res.status, data: await res.json() }
}
```

验证：
```bash
curl -i -X OPTIONS -H "Origin: https://<user>.github.io" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type" \
  https://gh-im-oauth-exchange.<subdomain>.workers.dev/device/code
# 期望 204 + Access-Control-Allow-Origin: https://<user>.github.io
```

### 6.6 会话与令牌生命周期

```ts
type Session = {
  kind: 'pat' | 'app'
  token: string
  login: string
  avatarUrl: string
  expiresAt?: number      // app 令牌
  refreshToken?: string   // ghr_
  loginAt: number
}
```

| 事件 | 处理 |
|---|---|
| 启动 / 刷新 | 读 Session → 直接恢复，不弹登录 |
| App 令牌将到期 | 经 Worker `/access_token` 用 `ghr_` 调 `grant_type=refresh_token` 换新对；**先把新对落盘再继续发请求**——刷新后旧 access/refresh 立即作废 |
| 刷新失败 | 沿用旧令牌；遇 401 重试一次，仍失败则清会话并提示「重新用 GitHub 登录」 |
| refresh token 也过期 | 引导重走一次设备流 |
| Worker 不可达 | 仅阻断通道 B 的登录与刷新；**已登录会话与 PAT 通道不受影响**，页面顶部给一条非阻断提示 |
| 登出 | 清 token / refreshToken / 草稿 / 未读标记，并提示可到 GitHub → Settings → Applications 撤销授权 |

开启「过期用户访问令牌」后 access token 8 小时、refresh token 6 个月，官方建议开启。对 IM 而言**静默刷新是必做项**，否则用户每 8 小时输一次码，产品不成立。

### 6.7 统一抽象
```ts
interface AuthProvider {
  id: 'pat' | 'device-flow'
  signIn(): Promise<Session>
  getToken(): Promise<string | null>   // 内部 ensureValid / refresh
  signOut(): Promise<void>
  capabilities: { canWrite: boolean }
}
```
`graphql()` 只认 `getToken()`，发消息只检查 `canWrite`。**两条通道的差异全部锁在 AuthProvider 内**，消息流、房间切换、轮询代码一行不改。

### 6.8 配置清单

| 项 | 位置 | 说明 |
|---|---|---|
| `VITE_OAUTH_EXCHANGE_URL` | 前端构建期 | Worker 地址，不含尾斜杠 |
| `VITE_GITHUB_ROOMS` | 前端构建期 | 房间列表 JSON（`[{owner, repo}]`） |
| `GITHUB_CLIENT_ID` | Worker `[vars]` | GitHub App Client ID，公开值，由 Worker 注入 |
| `GITHUB_CLIENT_SECRET` | Worker secret | **可选**，实测需要时才注入，永不进前端 |
| `ALLOWED_ORIGIN` | Worker `[vars]` | Pages 站点 origin，精确匹配 |
| GitHub App 权限 | GitHub 设置 | `Discussions: Read and write` + `Metadata: Read`，安装到目标私有仓库 |
| token | **仅运行时** | 永不进源码、`VITE_*`、日志、URL、错误上报 |

> 前端**不再**配置 `VITE_GITHUB_CLIENT_ID`：改由 Worker 注入，构建产物里连 Client ID 都不暴露，也避免前端传参被篡改。

---

## 7. 消息流与交互规格

**读取方向**：IM 是倒着长的。取最新一批用 `comments(last: 30)`，向上翻页用 `before` 游标分页——若沿用论坛式 `first/after`，会做成话题列表而不是聊天窗口。

**伪实时**：8–10s 轮询最新一批，按 comment `id` 与本地末条比对做增量追加；不做 WebSocket，不宣称实时。顶栏显示「上次同步时间」与手动刷新。

**发送**
1. 本地立刻插入 `pending` 气泡（临时 id + 时间戳）。
2. `addDiscussionComment` 成功后用返回的 `id` 替换；失败转红、保留文案可重试。
3. 轮询回来的批次按 `id` 去重，避免乐观更新与轮询撞出两条。
4. 回车发送 / Shift+Enter 换行；正文按纯文本提交，展示时净化 `bodyHTML`。

**限流**：读 `X-RateLimit-Remaining`，接近耗尽时自动把轮询退避到 30s 并提示；**写操作不做自动重试**（防重复发消息）。

**界面**：左侧房间列表 + 未读小红点，右侧单列消息流 + 底部输入框，顶栏 `@login` / 令牌状态 / 登出。总共两个视图（登录页、聊天页），无详情页。

---

## 8. 技术方案

### 8.1 架构

```
浏览器（GitHub Pages 静态托管）
  ├─ Vue 3 SPA · Vue Router(hash) · Pinia
  ├─ AuthProvider ─┬─ pat          → 直接出 token
  │                └─ device-flow  → CF Worker ──→ github.com/login/*
  │                     ↓ 汇合            ↑ 仅认证链路，无状态
  │              localStorage Session（浏览器持有登录态）
  └─ GraphQL Client (fetch, 注入 Authorization)
        ↓ POST https://api.github.com/graphql   ← 数据面，不经过 Worker
  GitHub Discussions（私有仓库）← 唯一数据源
```
GitHub API 对跨源 AJAX 请求开放 CORS，浏览器可直连 GraphQL 端点，这是数据面不经任何中间节点的前提。

### 8.2 工程配置
```ts
// vite.config.ts
export default defineConfig({
  base: '/<repo-name>/',        // 项目页必须带子路径，否则资源全 404
  plugins: [vue()],
})
```
- 产物根目录放空文件 `.nojekyll`，跳过 Jekyll 处理。
- 路由用 `createWebHashHistory()`；若改 history 模式需生成 `404.html` 回退到 `index.html`。
- 构建链路：`vite build` → `dist/` → GitHub Actions → Pages。

```
src/
  auth/            pat.ts  deviceFlow.ts  session.ts  index.ts(AuthProvider)
  github.ts        graphql() 封装 + 错误码映射 + postOAuth()
  stores/          session.ts  rooms.ts  messages.ts  composer.ts
  views/           Gate.vue   Chat.vue
  components/      RoomList.vue  MessageList.vue  Composer.vue  DeviceCodeModal.vue
public/.nojekyll
.github/workflows/deploy.yml
cf-oauth-exchange/  worker.js  wrangler.toml    ← 独立目录，单独 wrangler deploy
```

### 8.3 GraphQL 契约
```graphql
query Me { viewer { login avatarUrl } }

query Room($owner:String!, $name:String!) {
  repository(owner:$owner, name:$name) {
    id
    discussionCategories(first: 1) { nodes { id } }
    discussions(first: 1) { nodes { id number title } }
  }
}

query Messages($id:ID!, $before:String) {          # 最新一批 + 向上翻页
  node(id:$id) {
    ... on Discussion {
      comments(last:30, before:$before) {
        pageInfo { startCursor hasPreviousPage }
        nodes { id bodyHTML createdAt author { login avatarUrl } }
      }
    }
  }
}

mutation Send($discussionId:ID!, $body:String!) {   # 只需 discussionId 与正文
  addDiscussionComment(input:{ discussionId:$discussionId, body:$body }) {
    comment { id createdAt }
  }
}

mutation EnsureRoom($repo:ID!, $cat:ID!) {          # repositoryId/categoryId 必须是 node ID
  createDiscussion(input:{ repositoryId:$repo, categoryId:$cat,
                          title:"general", body:"IM channel" }) {
    discussion { id number }
  }
}
```
`graphql()` 统一注入 bearer、解析 `errors`，把 `BAD_CREDENTIALS / INSUFFICIENT_SCOPES / RATE_LIMITED / FORBIDDEN` 映射成用户可读文案。

### 8.4 状态、缓存与错误
- Pinia 分 `session / rooms / messages / composer`；GraphQL 响应做 60s 内存缓存，写操作后按 key 失效。
- 错误码映射：`BAD_CREDENTIALS` → 重新登录；`INSUFFICIENT_SCOPES` → 提示补 Discussions 权限；`RATE_LIMITED` → 退避 + 显示重置时间；`FORBIDDEN` → 无仓库权限 / 未完成 SSO；`Worker 不可达` → 非阻断提示 + 引导用 PAT 登录。
- 不采集消息内容，错误仅本地 console 记录，不上报 token。

---

## 9. 非功能需求

| 维度 | 要求 |
|---|---|
| 安全 | token 不进源码/构建变量/日志/URL；`bodyHTML` 必须净化；Worker 白名单 Origin；全站 HTTPS |
| 性能 | 首屏 JS < 200KB gzip；消息分页 30 条；Markdown 按需渲染；Worker 只做一次透传，无存储 |
| 兼容 | 现代浏览器最新两个大版本；移动端房间侧栏折叠可用 |
| 可用 | 登录态刷新不中断；发送失败保留文案；限流不阻断已加载消息；Worker 挂掉不影响已登录用户聊天 |
| 可维护 | GraphQL 查询集中管理、AuthProvider 可插拔、Worker 与前端独立部署、配置与代码分离 |

---

## 10. 风险与边界

| 风险 / 边界 | 影响 | 缓解 |
|---|---|---|
| token 存 `localStorage`，XSS 即失守 | 高 | 净化 HTML、不引第三方脚本、显眼登出入口；公用电脑用完需登出。已按确认口径采纳，不加额外机制 |
| **设备流钓鱼**：设备流无重定向 URI，攻击者可诱导用户在别处输入码并冒用 App | 高 | Worker 校验 Origin 白名单，防止他人白嫖本站点交换层；UI 固定展示 `github.com/login/device` 并提示核对域名；Client ID 绑定自有 App |
| `client_secret` 是否必需存在实现差异 | 中 | Worker 预留可选 secret 注入位，实测需要才开启；无论哪种情况都不进前端 |
| Worker 成为认证链路单点 | 中 | PAT 通道完全独立；已登录会话不受影响；Worker 无状态、可随时重新部署或换区域 |
| 8h 短令牌 + 刷新在浏览器执行 | 中 | 静默刷新走 Worker；失败降级重授权；刷新期间不发消息，草稿保留 |
| 组织私有仓库 / SAML SSO | 中 | App 需组织管理员安装批准；未完成时提示「请先完成 SSO 授权」 |
| Classic PAT 的 `repo` 权限过大 | 中 | 默认引导 fine-grained PAT，登录页明示差异 |
| 无业务后端 → 无真正实时、无在线状态 | 中 | 轮询 + 「上次同步时间」，不宣称实时 |
| 评论不可嵌套 | 低 | 回复靠引用块 / @ 呈现，不做楼中楼 |
| GitHub 侧即后台 | 低 | 删消息、锁流、移除协作者均在 GitHub 页面操作 |
| 仓库未开启 Discussions | 低 | 首次进入查不到 Category 时提示「请先在仓库 Settings 开启 Discussions」 |
| SPA 无 SSR，SEO 弱 | 低 | 接受；定位是内部工具而非内容站 |

> v1.0 中「`github.com/login/*` 浏览器直连 CORS 表现未确证」一项，已由本版方案一**从架构上规避**：前端只与 Worker 同源策略内的地址通信，跨域由 Worker 处理。

---

## 11. 里程碑与验收

| 阶段 | 产出 | 关键验证 |
|---|---|---|
| **M0 技术验证** | 最小页面 + Worker | ① 浏览器直连 GraphQL 读私有 Discussions + 发一条 comment；② `curl` 验证 Worker OPTIONS 预检与两个端点转发；③ GitHub App 装到私有仓库后 `ghu_` 能否读写 Discussions；④ 实测 `client_secret` 在换取/刷新时是否需要 |
| **M1 单房间闭环** | F1/F2/F5/F6/F7/F8 | PAT 通道收发 + 轮询 + 历史翻页 + 错误态齐全 |
| **M2 双通道与会话** | F3/F4/F9/F10 | 设备流经 Worker 授权可用；刷新恢复登录态 0 重授权；静默刷新与失败降级 |
| **M3 部署与打磨** | F11/F12 + P2 选做 | `base` / `.nojekyll` / hash 路由在 Pages 全通；Worker 与前端分别部署；移动端可用 |

> M0 不能省。`repo` scope 到底够不够、组织审批会不会卡住、Worker 转发是否被 GitHub 拒绝、`client_secret` 是否需要——这四项只有实跑一次才知道，不过就别排 M1。

---

## 12. 决策记录与部署清单

**已决策（本版收口）**：采用**方案一**——引入 Cloudflare Workers 极薄交换层。理由：保留「点一下就登录」的 App 授权体验，同时守住三条底线：**token 始终由浏览器持有、Worker 不落盘任何凭据、消息数据面 100% 直连 GitHub**。被放弃的方案二是「通道 B 降级、只保留 PAT」。

**上线顺序**
1. 私有仓库开启 Discussions，建好默认 Category。
2. 注册 GitHub App：启用 Device Flow、填 callback URL、配 `Discussions: R/W` + `Metadata: Read`、安装到目标仓库、（建议）开启过期用户令牌。
3. 部署 Worker：`wrangler deploy`；按需 `wrangler secret put GITHUB_CLIENT_SECRET`；用 curl 验证预检与转发。
4. 配置前端 `VITE_OAUTH_EXCHANGE_URL` / `VITE_GITHUB_ROOMS`，`npm run build` 推 Pages。
5. 走一遍 M0 四项实测，再放行 M1。

**验收红线**
- Worker 日志/KV/D1 中不得出现 `device_code`、`access_token`、`refresh_token`。
- 前端构建产物全局搜索不得出现 `client_secret`。
- 抓包确认：`api.github.com/graphql` 的请求**不经过** Worker 域名。
