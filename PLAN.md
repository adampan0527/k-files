# k-files 实现计划

> 将 KAgent 的 K 线可视化能力从 VS Code 扩展解耦为独立 CLI 工具：在命令行运行一条命令，启动本地 Web 服务，浏览器中实时查看当前目录下所有文件的修改 K 线图。

## 一、项目目标

```
$ npx k-files
✔ Watching /home/user/my-project (127 files)
✔ Server running at http://localhost:3579
✔ Browser opened
```

- **编辑器无关**：Claude Code、Codex CLI、Cursor、vim、人工编辑……任何写入文件系统的行为都能被捕获
- **Agent Hook 优先**：对支持 hook 的 Agent（Claude Code、Cursor）走结构化 hook 路径，精度最高
- **文件系统监听兜底**：对不支持 hook 的 Agent 和人工编辑，走 chokidar 监听 + 内存快照
- **实时推送**：文件变化后 ~200ms 内浏览器 K 线图更新
- **前端零修改**：直接复用 KAgent 的 `market.js`、`market.css`、`lightweight-charts.js`

## 二、架构总览

```
 =============================  BROWSER  ================================
 |  index.html (generated)                                               |
 |    <link> cli-fallbacks.css   ← 29 个 --vscode-* CSS 变量默认值       |
 |    <link> market.css          ← 原样 serve，不改一行                   |
 |    <script> lightweight-charts.js  ← 原样 serve                       |
 |    <script> cli-bridge.js     ← ~25行，acquireVsCodeApi → WebSocket   |
 |    <script> market.js         ← 原样 serve，不改一行                   |
 ============================  WebSocket  ================================
         ↕  ws://localhost:3579/ws  (JSON)
 =============================  SERVER  ==================================
 |  cli.ts           入口：解析参数 → 启动 watcher + server               |
 |  server.ts        http.createServer, 6 条静态路由 + WS upgrade         |
 |  wsHub.ts         管理连接池，广播 marketUpdate，处理客户端消息          |
 |  watcher.ts       chokidar 监听 + 文件级防抖(300ms)                    |
 |  payloadBuilder.ts  编排现有模块，组装 MarketPayload                    |
 |  snapshotManager.ts 内存快照缓存，解决"修改前"内容问题                   |
 =============================  DOMAIN  ==================================
 |  复用 KAgent 核心（零 vscode 依赖）：                                   |
 |    types.ts, lineStats.ts, candleBuilder.ts, eventStore.ts,            |
 |    fileLock.ts, symbolDelist.ts, recordChange.ts                       |
 |  轻改 KAgent 核心（~15行）：                                           |
 |    paths.ts → 改为接受 workspaceRoot 参数                               |
 |    kfilesConfig.ts → 删 4 行 vscode 配置读取                           |
 ========================================================================
```

## 三、目录结构

```
k-files/
├── package.json                 # { "name": "k-files", "bin": { "k-files": "./dist/cli.js" } }
├── tsconfig.json
├── LICENSE                      # (已有)
├── PLAN.md                      # (本文件)
│
├── src/                         # TypeScript 源码
│   ├── cli.ts                   # CLI 入口：参数解析、启动 watcher + server、自动开浏览器
│   ├── server.ts                # HTTP server：6 条路由 + WebSocket upgrade
│   ├── wsHub.ts                 # WebSocket 连接管理 + 消息协议
│   ├── watcher.ts               # chokidar 文件监听 + 文件级防抖
│   ├── snapshotManager.ts       # 内存快照缓存（解决 before-image 问题）
│   ├── payloadBuilder.ts        # 编排 core 模块，生成 MarketPayload
│   ├── staticServer.ts          # 静态文件路由 + HTML 生成
│   │
│   ├── core/                    # 从 KAgent 移植的核心逻辑（保持独立，不依赖任何 server 代码）
│   │   ├── types.ts             # 直接复制
│   │   ├── lineStats.ts         # 直接复制
│   │   ├── candleBuilder.ts     # 直接复制
│   │   ├── fileLock.ts          # 直接复制
│   │   ├── eventStore.ts        # 直接复制
│   │   ├── symbolDelist.ts      # 直接复制
│   │   ├── recordChange.ts      # 直接复制
│   │   ├── paths.ts             # 轻改：getKfilesDir(root) 用参数代替 vscode.workspaceFolders
│   │   └── kfilesConfig.ts      # 轻改：isCaptureOnSaveEnabled 去掉 vscode 读取
│   │
│   └── hooks/                   # Agent hook 脚本（可选安装到项目中）
│       ├── claude-post-edit.mjs # Claude Code PostToolUse hook
│       └── claude-snapshot.mjs  # Claude Code PreToolUse hook (Write 工具的 before 快照)
│
├── static/                      # 前端静态资源（新写的适配层）
│   ├── cli-bridge.js            # VS Code API polyfill → WebSocket 桥接 (~25行)
│   └── cli-fallbacks.css        # --vscode-* CSS 变量默认值 (~30行)
│
├── vendor/                      # 从 KAgent 复制的前端资源（原样 serve，不修改）
│   ├── market.js                # 来源：KAgent/extension/media/market.js
│   ├── market.css               # 来源：KAgent/extension/media/market.css
│   └── lightweight-charts.js    # 来源：KAgent/extension/media/lightweight-charts.js
│
└── scripts/                     # 开发辅助脚本
    └── sync-vendor.mjs          # 从 KAgent 项目同步 vendor 文件
```

## 四、实施步骤

### Phase 1：项目脚手架

**目标**：空项目能编译、能运行 `k-files --help`。

- [ ] 1.1 初始化 `package.json`（name: `k-files`, type: `module`, bin, dependencies: `ws`, devDependencies: `typescript`, `@types/node`, `@types/ws`）
- [ ] 1.2 创建 `tsconfig.json`（target: ES2022, module: Node16, outDir: `dist/`）
- [ ] 1.3 创建 `src/cli.ts` 骨架：解析 `--port`、`--dir`、`--no-open`、`--help` 参数
- [ ] 1.4 创建 `scripts/sync-vendor.mjs`：从 `../KAgent/extension/media/` 复制三个 vendor 文件
- [ ] 1.5 运行 sync-vendor，确认 vendor 文件就位
- [ ] 1.6 配置 `.gitignore`（node_modules/, dist/, .kfiles/）

### Phase 2：核心逻辑移植

**目标**：8 个零依赖模块 + 2 个轻改模块就位，能独立运行 `recordFileChange()`。

- [ ] 2.1 创建 `src/core/` 目录
- [ ] 2.2 直接复制 7 个文件（保持原有 import 路径不变）：
  - `types.ts` ← `KAgent/extension/src/types.ts`
  - `lineStats.ts` ← `KAgent/extension/src/lineStats.ts`
  - `candleBuilder.ts` ← `KAgent/extension/src/candleBuilder.ts`
  - `fileLock.ts` ← `KAgent/extension/src/fileLock.ts`
  - `eventStore.ts` ← `KAgent/extension/src/eventStore.ts`
  - `symbolDelist.ts` ← `KAgent/extension/src/symbolDelist.ts`
  - `recordChange.ts` ← `KAgent/extension/src/recordChange.ts`
- [ ] 2.3 移植 `paths.ts`：将 `getKagentWorkspaceFolder()` 和 `getKfilesDir()` 改为接受 `workspaceRoot: string` 参数，去掉 `vscode.workspace.workspaceFolders` 调用
- [ ] 2.4 移植 `kfilesConfig.ts`：`isCaptureOnSaveEnabled()` 中删除 `vscode.workspace.getConfiguration()` 调用（4 行），改为只读 `config.json`
- [ ] 2.5 从 `saveCapture.ts` 中提取 `primeSnapshot()` 函数到 `snapshotManager.ts`
- [ ] 2.6 编写单元测试验证 `recordFileChange()` 能独立工作（可选）

### Phase 3：文件监听 + 快照

**目标**：CLI 启动后能检测到任意文件修改并调用 `recordFileChange()`。

- [ ] 3.1 创建 `src/snapshotManager.ts`：
  - `loadAll(files)` — 启动时扫描工作区，加载所有源文件内容到内存 Map
  - `getSnapshot(file)` — 获取修改前内容
  - `updateAfterRecord(file)` — 记录事件后刷新快照
  - `delete(file)` — 文件删除时移除快照
- [ ] 3.2 创建 `src/watcher.ts`：
  - chokidar 监听工作区（`ignoreInitial: true`，排除 node_modules/.git/.kfiles 等）
  - 文件级 300ms 防抖（format-on-save 链合并为一次事件）
  - `awaitWriteFinish.stabilityThreshold: 300`（处理原子写入 / 临时文件重命名）
  - 文件删除事件 → 标记为退市
- [ ] 3.3 集成 watcher + snapshotManager + recordFileChange：
  - watcher `change` → 读新内容 → 查快照取旧内容 → `recordFileChange({ oldText })` → 更新快照
  - watcher `add` → 新文件 IPO
  - watcher `unlink` → 退市
  - content hash 比对跳过无实际变化的事件（touch/utime）
- [ ] 3.4 CLI 入口串联：`cli.ts` 中初始化 watcher，Ctrl+C 优雅退出

### Phase 4：Web Server + WebSocket

**目标**：`k-files` 启动后在浏览器中看到 K 线图。

- [ ] 4.1 创建 `src/staticServer.ts`：
  - 生成 `index.html`（参考 `marketViewProvider.ts` 的 `getHtml()` 方法，约 297-347 行）
  - `<body>` 上加 `class="vscode-dark"` 解决暗色模式检测问题
  - 加载顺序：`cli-fallbacks.css` → `market.css` → `lightweight-charts.js` → `cli-bridge.js` → `market.js`
  - 路由表：`GET /` → HTML，`GET /market.css` → vendor 文件，`GET /cli-bridge.js` → static 文件，以此类推
- [ ] 4.2 创建 `static/cli-bridge.js`（~25行）：
  - `window.acquireVsCodeApi()` → 返回 shim `{ postMessage: fn }`
  - shim 的 `postMessage()` 通过 WebSocket 发 JSON
  - `ws.onmessage` → `window.dispatchEvent(new MessageEvent('message', { data }))`
- [ ] 4.3 创建 `static/cli-fallbacks.css`（~30行）：
  - 定义 29 个 `--vscode-*` CSS 变量的默认值（VS Code Dark+ 主题配色）
- [ ] 4.4 创建 `src/wsHub.ts`：
  - 管理 `Set<WebSocket>` 连接池
  - 每连接独立状态（`selectedFile`、`colorScheme`、`colorTone`）
  - 处理客户端消息：`ready` → 推送初始 payload，`selectSymbol` → 切换选中文件，`setColorScheme`/`setColorTone` → 切换配色
  - 广播：`{ type: "marketUpdate", payload }` → 所有连接
- [ ] 4.5 创建 `src/payloadBuilder.ts`：
  - 编排 `readAllEvents()` + `readSymbols()` + `syncDelistedSymbols()` + `buildMarketPayload()`
  - 附加 `hooksOk`、`captureOnSave`、`kfilesDir`、`colorScheme`、`colorTone` 等元数据
- [ ] 4.6 创建 `src/server.ts`：
  - `http.createServer` + 6 条路由 + WebSocket upgrade（`ws` 包的 `WebSocketServer`）
  - 端口策略：默认 3579 → 被占用则随机端口 → 打印实际 URL
- [ ] 4.7 更新 `src/cli.ts`：
  - 启动 watcher → 启动 server → 自动打开浏览器（`start`/`open`/`xdg-open`）
  - watcher `dataChanged` 事件 → `payloadBuilder.loadPayload()` → `wsHub.broadcast()`
- [ ] 4.8 端到端验证：运行 `npx k-files` → 修改一个文件 → 浏览器 K 线图实时更新

### Phase 5：Claude Code Hook 集成（可选增强）

**目标**：在 Claude Code 项目中自动安装 hook，获得结构化编辑数据。

- [ ] 5.1 创建 `src/hooks/claude-post-edit.mjs`：
  - 从 stdin 读取 Claude Code 的 `PostToolUse` payload
  - 适配字段映射：`payload.tool_input.file_path` → `file_path`，`payload.tool_input.old_string/new_string` → `edits[]`
  - 调用 `recordFileChange()` 记录事件
- [ ] 5.2 创建 `src/hooks/claude-snapshot.mjs`：
  - `PreToolUse` + `Write` matcher → 在覆盖前读取文件当前内容存入快照
- [ ] 5.3 CLI 新增 `k-files install-hooks` 子命令：
  - 检测项目中是否有 `.claude/settings.json`
  - 注入 `PostToolUse` 和 `PreToolUse` hook 配置
  - 复制 hook 脚本到 `.claude/hooks/`
- [ ] 5.4 CLI 新增 `k-files init` 子命令：
  - 创建 `.kfiles/config.json`（默认忽略模式）
  - 安装 hooks
  - 打印使用说明

### Phase 6：打包发布

**目标**：`npm install -g k-files` 即可使用。

- [ ] 6.1 完善 `package.json`：
  - `files` 字段：`dist/`, `static/`, `vendor/`
  - `keywords`: `["kfiles", "k-line", "candlestick", "file-monitor", "ai-agent"]`
  - `repository`: `https://github.com/adampan0527/k-files`
- [ ] 6.2 构建流程：`tsc` 编译 TypeScript → `dist/`
- [ ] 6.3 `prepublishOnly` 脚本：编译 + 复制 vendor
- [ ] 6.4 README.md：安装方式、使用方式、截图、支持的 Agent 列表
- [ ] 6.5 发布到 npm（`npm publish`）
- [ ] 6.6 GitHub Release

## 五、关键设计决策

### 5.1 文件监听方案

| 方案 | 选择 | 理由 |
|------|------|------|
| 监听库 | **chokidar** | 处理原子写入（write-rename-flush）、跨平台递归、glob ignore、久经考验 |
| 主检测 | 事件驱动 | 低延迟、近零 CPU |
| 兜底 | 每 5 秒 hash 对账扫描 | 捕获 watcher 遗漏的边界情况 |
| 防抖 | 300ms 文件级 + 1500ms coalesce 窗口 | 合并 format-on-save 链 |

### 5.2 "修改前"快照策略

文件系统监听只能在**写入完成后**触发，无法像 VS Code 的 `onWillSaveTextDocument` 那样在写入前拦截。解法：

1. **启动时**：扫描工作区所有源文件，内容加载到内存 `Map<path, content>`
2. **每次记录后**：刷新该文件的快照为当前磁盘内容
3. **下次触发时**：Map 中存的就是"修改前"的内容

这是 `saveCapture.ts` 中 `lastRecordedContent` 模式的泛化版本，从 VS Code 事件驱动改为文件系统事件驱动。

### 5.3 前端适配策略

| 组件 | 策略 | 修改量 |
|------|------|--------|
| `market.js` | 原样 serve，通过 `cli-bridge.js` polyfill `acquireVsCodeApi()` | 0 行 |
| `market.css` | 原样 serve，通过 `cli-fallbacks.css` 提供 CSS 变量默认值 | 0 行 |
| `lightweight-charts.js` | 原样 serve | 0 行 |
| `cli-bridge.js` | 新写，~25 行 | WebSocket ↔ postMessage 桥接 |
| `cli-fallbacks.css` | 新写，~30 行 | 29 个 `--vscode-*` 变量默认值 |
| `index.html` | 服务器生成，参考 `marketViewProvider.ts` 的 `getHtml()` | 模板 ~50 行 |

### 5.4 多 Agent 兼容

```
Claude Code  ──PostToolUse hook──→  结构化 old/new  ──→  recordFileChange()
Cursor       ──afterFileEdit hook──→  结构化 old/new  ──→  recordFileChange()
Codex CLI    ──(无 hook)──→  chokidar 监听  ──→  snapshot diff  ──→  recordFileChange()
vim/人工      ──(无 hook)──→  chokidar 监听  ──→  snapshot diff  ──→  recordFileChange()
```

所有路径汇聚到同一个 `recordFileChange()`，通过事件的 `source` 字段区分来源。

### 5.5 npm 依赖

| 依赖 | 用途 | 是否必须 |
|------|------|----------|
| `ws` | WebSocket server | 是 |
| `chokidar` | 文件系统监听 | 是（比原生 fs.watch 可靠，尤其在 Windows） |
| `typescript` | 编译 (devDep) | 开发时 |

运行时仅 2 个依赖，保持轻量。

## 六、工作量估算

| Phase | 新增代码 | 复用代码 | 核心难点 |
|-------|----------|----------|----------|
| Phase 1 脚手架 | ~100 行 | 0 | 项目配置 |
| Phase 2 核心移植 | ~30 行改动 | ~1200 行 | paths.ts / kfilesConfig.ts 适配 |
| Phase 3 监听+快照 | ~200 行 | ~1200 行 | 快照一致性、防抖策略 |
| Phase 4 Server+WS | ~350 行 | ~1200 行 | WebSocket 协议、HTML 生成 |
| Phase 5 Hook 集成 | ~150 行 | ~1200 行 | Claude Code payload 适配 |
| Phase 6 打包发布 | ~50 行 | 0 | npm 发布流程 |
| **总计** | **~880 行新代码** | **~1200 行复用** | |

## 七、里程碑

| 里程碑 | 交付物 | 验收标准 |
|--------|--------|----------|
| **M1** | CLI 能编译运行 | `k-files --help` 输出帮助信息 |
| **M2** | 核心逻辑移植完成 | 独立调用 `recordFileChange()` 能写入 events.ndjson |
| **M3** | 文件监听工作 | 运行 CLI 后修改文件，events.ndjson 有新事件 |
| **M4** | Web 界面可看 | `k-files` 启动后浏览器显示 K 线图，修改文件后实时更新 |
| **M5** | Claude Code 集成 | `k-files install-hooks` 后 Claude Code 的编辑自动出现在 K 线图中 |
| **M6** | 发布 | `npm install -g k-files` 可用 |
