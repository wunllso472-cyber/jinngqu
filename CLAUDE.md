# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

景区 AI 旅拍平台，游客、商户、管理员三种身份共用一套登录。游客选择模板、上传人物照片、模拟支付后，后台队列制作打卡合拍、AI 换装照片或 AI 换装视频；商户为唯一绑定的景区购买各服务次数并申请提现；管理员管理景区、模板、账号、商户绑定和提现审核。所有付款均为模拟。界面文案、错误提示、代码注释和文档都使用中文，新增的面向用户的文字也保持中文。需求见 `docs/需求文档.md`，技术说明见 `docs/技术白皮书.md`。

## 常用命令

需要 Node ≥ 22.13（使用内置 `node:sqlite`，无需外部数据库）。后端依赖在根目录，前端依赖在 `web/`（独立的 `package.json`）。

```bash
npm run setup        # 安装后端 + 前端依赖
npm run build        # vite 构建到 web/dist（生产环境由 Express 托管）
npm start            # http://localhost:3000；users 表为空时首次启动自动初始化数据
npm run dev          # 后端，--watch-path=server 自动重启（:3000）
npm run dev:web      # Vite :5173，代理 /api 和 /files 到 BACKEND_URL（默认 :3000）
npm run seed:reset   # 清空数据目录并重新初始化
npm test             # node --test server/test/*.test.js
```

运行单个测试文件：`node --test server/test/extras.test.js`；运行单个用例可加 `--test-name-pattern="<名称>"`。项目没有配置 lint 或格式化工具；前端没有测试，前端改动用 `npm run build` 验证。

测试是基于 HTTP 的端到端测试：每个测试文件先把 `DATA_DIR` 设为新的临时目录，并设置 `AI_PROVIDER=mock`、`MOCK_SPEED=0.02`，**之后**才动态 import 服务端模块，然后初始化数据、在 0 端口启动应用并启动制作队列。顺序很重要：`server/config.js` 和 `server/db.js` 在 import 时就会打开数据目录和数据库，所以新增的测试或脚本必须在 import `server/` 下任何模块之前设好环境变量。

测试账号（见 README）：`trial_user` / `trial_merchant`（绑定老君山）/ `trial_admin`；密码见 README.md，也可通过 `SEED_*_PASSWORD` 覆盖。

## 后端架构（`server/`，Express 4，ESM）

- **数据层（`db.js`）**：单个同步的 `DatabaseSync`。表结构用 `CREATE TABLE IF NOT EXISTS`，新增字段写进 `COLUMNS` 列表，启动时通过 `ALTER TABLE` 补齐——加字段时改这里，不要改已有建表语句。查询工具 `one/all/run/scalar` 带预编译语句缓存（自动把 boolean/undefined 转换为 1/0/null）。`tx(fn)` 是同步、可重入的 `BEGIN IMMEDIATE` 事务——**事务内不得 `await`**。设置项（`getSetting/setSetting`）缓存在内存里，写入必须经过 `setSetting`。
- **领域逻辑（`domain.js`）**：各路由共用的业务规则和视图映射——服务可用性、`sceneView`/`templateView`/`orderView`（`audience: owner|merchant|admin`）、`merchantWallet`、`adjustQuota`（每次额度变动都写入 `quota_logs`）、`failAndRefund`、`createQuotaPurchase`、`templateUsage`。跨路由的逻辑放这里，不要写在路由文件里。
- **工具（`util.js`）**：`ApiError` 及 `bad/forbidden/notFound/conflict`、异步路由包装 `h()`、所有分页列表都用的 `paged(req, {from, where, params, select, order, map})`（返回 `{list,total,page,size}`）、`parseYuan`、`now()`（本地时间字符串 `YYYY-MM-DD HH:mm:ss`，存在 TEXT 列中）、管理员审计日志 `audit()`。
- **路由（`routes/*.js`）**：在 `app.js` 中挂载到 `/api` 下；`loadUser` 根据 Bearer 令牌设置 `req.user`（会话表只存令牌哈希）。权限用 `auth.js` 的 `requireAuth` / `requireRole(...)`。商户的景区通过 `routes/helpers.js` 的 `merchantScene(userId)` 获取（一个商户对应一个景区）。
- **文件（`storage.js`）**：上传文件以 key 标识，形如 `public|private/<目录>/<YYYYMM>/<uuid>.<扩展名>`，存放在 `data/files` 下。数据库只存 key，只在视图函数中用 `fileUrl(key)` 转成 URL；private 文件生成带有效期的 HMAC 签名链接，由 `app.js` 中的 `/files/*` 处理器校验。
- **制作队列（`ai/worker.js`）**：轮询 `status='QUEUED'` 的订单，用带条件的 UPDATE 认领，再调用 AI 提供方（`mock` = sharp 合成图片 + ffmpeg-static 生成视频；`runninghub` = 按 `config/runninghub.json` 调用远程工作流，未配置工作流的服务自动回退到 mock）。抛出的任何错误都进入 `failAndRefund`（退款并回补次数）。启动时把 `PROCESSING` 订单重新排队，RunningHub 任务通过 `provider_task` 继续轮询原任务。

### 需要保持的业务规则

- 金额一律以整数**分**存储（`constants.js` 的 `SERVICES` 定义默认游客价、商户额度价和标准成本）。
- 支付时扣减次数，下单时不扣；制作失败自动退款并回补次数。
- 订单收入归属下单时绑定的商户。可提现 = 成功订单收入 − 冻结中的提现 − 已打款的提现；购买次数不从收入中扣除。
- 景区暂停、服务停用、次数为 0 或未绑定商户时，停止接单。

## 前端架构（`web/src/`，React 19 + Vite + react-router 7，纯 JS/JSX）

- `api.js`：`api()` 请求封装及 `get/post/...` 快捷方法；令牌存在 localStorage，收到 401 时清除令牌并通知 `onUnauthorized` 监听者。`ctx.jsx` 提供 `useApp()`（当前用户、登录状态）。
- `ui.jsx`：共享基础组件与 hook——数据加载 `useLoad(fn, deps)`、操作中状态 `useBusy()`、`Modal`、命令式 `toast()`/`confirm()`、`Pager`、`StatusBadge`（由 `format.js` 中 `{status: {text, tone}}` 映射驱动）、`ImagePick`、`useObjectUrl`。优先复用这些，不要自己写请求和加载状态。
- `format.js`：显示映射和格式化（`yuan`、`shortTime`、各状态映射）。服务端返回分和原始状态码，格式化在前端完成。
- 路由在 `App.jsx`。游客页面（移动端优先）在 `pages/`；`pages/Merchant.jsx` 和 `pages/admin/*` 是宽屏布局，通过 `RequireAuth roles` 限制访问。商户与管理员共用的组件（额度明细、服务设置、客服工作台、模板使用统计）放在 `components/` 或从所在页面导出。

## 约定

- 换行符使用 LF（Windows 开发机上 `core.autocrlf=true`；如有工具写入 CRLF，需要转换回来）。
- 配置来自环境变量（见 `.env.example`）；npm 脚本通过 `--env-file-if-exists` 读取 `.env`。`data/`、`.env`、`config/runninghub.json` 不纳入 git。
