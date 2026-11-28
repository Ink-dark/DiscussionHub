# Discussions Hub

把私有仓库的 GitHub Discussions 变成极简 IM：仓库即房间，`general` 讨论即聊天流，评论即消息。无业务后端、无账号系统、无数据库，前端静态托管在 GitHub Pages。

完整产品定义见 [PRD-DiscussionsHub.md](./PRD-DiscussionsHub.md)。

## 技术栈

- Vite + Vue 3 + Pinia + Vue Router（hash 路由）
- 消息读写直连 `api.github.com/graphql`
- 可选 Cloudflare Worker 作为 GitHub App 设备流的无状态认证交换层

## 本地开发

```bash
npm install
cp .env.example .env.local   # 填入房间与 Worker 地址
npm run dev
```

环境变量：

| 变量 | 说明 |
|---|---|
| `VITE_GITHUB_ROOMS` | 房间列表 JSON：`[{"owner":"org","repo":"team-chat","label":"团队聊天"}]` |
| `VITE_OAUTH_EXCHANGE_URL` | Worker 地址（不含尾斜杠）；留空则只启用 PAT 登录 |

`BASE_PATH` 仅构建时使用：GitHub Pages 项目页需要设置为 `/<repo-name>/`。

## 登录方式

1. **自带 PAT**：fine-grained token 需勾选 `Discussions: Read and write` 与 `Metadata: Read`；Classic token 需要 `repo`。
2. **GitHub App 设备流**：经 Worker 申请设备码、轮询换 token，令牌只落在浏览器 `localStorage`。

## 部署

### Cloudflare Worker

```bash
cd cf-oauth-exchange
npx wrangler deploy
# 如实测需要 client_secret：
npx wrangler secret put GITHUB_CLIENT_SECRET
```

编辑 `wrangler.toml` 中的 `ALLOWED_ORIGIN`（Pages 站点 origin，如 `https://<user>.github.io`）与 `GITHUB_CLIENT_ID`。

### GitHub Pages

1. 仓库 Settings → Pages → Source 选择 GitHub Actions。
2. Settings → Secrets and variables → Actions → Variables 配置：
   - `VITE_GITHUB_ROOMS`
   - `VITE_OAUTH_EXCHANGE_URL`
3. 推送到 `main`，工作流 [deploy.yml](./.github/workflows/deploy.yml) 会自动构建并发布。

### GitHub App 注册检查清单

- 勾选 **Enable Device Flow**（漏勾会得到 `device_flow_disabled`）。
- Authorization callback URL 必填，设备流不使用，填 `http://localhost` 即可。
- 权限：`Discussions: Read and write` + `Metadata: Read`，并安装到目标私有仓库。
- 建议开启过期用户令牌，前端会经 Worker 静默刷新。

## 上线前检查

- 私有仓库已开启 Discussions 并存在默认 Category。
- Worker 的 `ALLOWED_ORIGIN` 与 Pages origin 精确一致（不含路径）。
- 构建产物中搜索不到 `client_secret`。
- 抓包确认 `api.github.com/graphql` 请求不经过 Worker 域名。
