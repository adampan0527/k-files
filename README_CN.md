# k-files

> 将文件编辑行为可视化为股票 K 线图 —— 浏览器中实时查看，编辑器无关。

k-files 是一个独立的命令行工具，监听项目目录中的文件修改（来源不限 —— Claude Code、Codex CLI、Cursor、vim、人工编辑），并以实时 K 线图的形式展示哪些文件被修改了、何时修改、修改了多少。

## 快速开始

```bash
# 全局安装
npm install -g k-files

# 进入项目目录
cd my-project

# 启动监听并打开仪表盘
k-files
```

这会在 `http://localhost:13579` 启动一个本地 Web 服务并自动打开浏览器。每次文件修改会在 ~200ms 内反映到 K 线图上。

## 功能特性

- **编辑器无关** —— 支持 Claude Code、Codex CLI、Cursor、vim、VS Code 或任何写文件的工具
- **实时可视化** —— WebSocket 驱动的实时更新，无需手动刷新
- **K 线图展示** —— 每个文件是一只"股票"，每轮编辑是一根 K 线（OHLC = 编辑前/最高/最低/编辑后行数）
- **语义波动检测** —— 即使行数不变也能检测到内容变化
- **ST 退市机制** —— 被删除的文件会显示退市标签，30 秒后从列表移除
- **Claude Code Hook 集成** —— 可选的 `PostToolUse` hook，提供结构化的编辑数据
- **A 股/美股配色** —— A 股风格（红涨绿跌）或美股风格（绿涨红跌）

## 命令说明

### `k-files`

启动文件监听和 Web 服务。

```
k-files [选项]

选项:
  -p, --port <number>   Web 服务端口（默认: 13579）
  -d, --dir <path>      工作区根目录（默认: 当前目录）
  --no-open             不自动打开浏览器
  -h, --help            显示帮助
  --version             显示版本号
```

### `k-files init`

初始化项目：

- 创建 `.kfiles/config.json` 默认配置
- 安装 Claude Code hooks（如果存在 `.claude/` 目录）
- 将 `.kfiles/` 添加到 `.gitignore`

```bash
k-files init
```

### `k-files install-hooks`

仅安装 Claude Code hooks：

```bash
k-files install-hooks
```

这会在 `.claude/hooks/` 中创建两个 hook 脚本，并更新 `.claude/settings.json`：

- **`PostToolUse` hook**（matcher: `Edit|Write`）—— 每次文件编辑后记录事件，包含结构化的 old/new 差异
- **`PreToolUse` hook**（matcher: `Write`）—— 在文件覆盖前快照当前内容，用于精确的差异计算

## 工作原理

### 数据采集

k-files 使用分层策略捕获文件修改：

| 层级 | 机制 | 覆盖范围 |
|------|------|----------|
| **Hook** | Claude Code `PostToolUse` / Cursor `afterFileEdit` | 结构化编辑（old/new 字符串） |
| **文件监听** | chokidar 文件系统监听器 | 任何写文件的工具 |
| **对账扫描** | 定期内容 hash 比对 | 兜底捕获遗漏事件 |

### 数据存储

所有数据存储在 `.kfiles/` 目录下：

- `events.ndjson` —— 追加写入的事件日志（每次编辑一行 JSON）
- `symbols.json` —— 文件注册表，包含元数据（IPO 时间、编辑次数、行数、内容 hash）
- `config.json` —— 忽略模式和采集设置

### K 线映射

| 股市概念 | k-files 对应 |
|----------|-------------|
| 股票代码 | 工作区中的一个文件 |
| IPO（上市） | 文件首次被记录编辑 |
| 一根 K 线 | 一轮编辑（OHLC = 编辑前/最高/最低/编辑后行数） |
| 成交量 | 增删的行数 |
| ST 退市 | 文件从工作区中删除 |

### 架构总览

```
浏览器 (localhost:13579)
  ├── cli-fallbacks.css    ← CSS 变量默认值（Dark+ 主题）
  ├── market.css           ← 原始 KFiles 样式（不修改）
  ├── lightweight-charts.js ← TradingView 图表库
  ├── cli-bridge.js        ← VS Code API polyfill → WebSocket 桥接
  └── market.js            ← 原始 KFiles 前端（不修改）
         ↕ WebSocket (JSON)
服务端 (Node.js)
  ├── HTTP 服务（6 条路由）
  ├── WebSocket 管理（ws）
  ├── 文件监听器（chokidar + 300ms 防抖）
  ├── 快照管理器（内存中的修改前内容缓存）
  └── 核心模块（复用自 KFiles，零 vscode 依赖）
```

## 支持的 Agent

| Agent | 采集方式 | 编辑粒度 |
|-------|----------|----------|
| **Claude Code** | `PostToolUse` hook + 文件监听 | 每次编辑（old/new 字符串） |
| **Cursor** | `afterFileEdit` hook + 文件监听 | 每次编辑（old/new 字符串） |
| **Codex CLI** | 仅文件监听 | 每次写入（整个文件） |
| **GitHub Copilot** | 仅文件监听 | 每次写入（整个文件） |
| **vim / 任何编辑器** | 仅文件监听 | 每次写入（整个文件） |
| **人工编辑** | 仅文件监听 | 每次写入（整个文件） |

## 配置

编辑 `.kfiles/config.json` 自定义行为：

```json
{
  "ignore": [
    "**/node_modules/**",
    "**/.git/**",
    "**/.kfiles/**",
    "**/dist/**",
    "**/out/**"
  ],
  "capture": {
    "onSave": true
  },
  "coalesceWindowMs": 1500
}
```

## 开发指南

```bash
# 克隆仓库
git clone https://github.com/adampan0527/k-files.git
cd k-files

# 安装依赖
npm install

# 构建
npm run build

# 本地运行
node dist/cli.js

# 从 KAgent 同步 vendor 文件
npm run sync-vendor
```

## 与 KAgent 的关系

k-files 是 [KAgent](../KAgent) 的独立 CLI 提取版本 —— KAgent 是一个 VS Code/Cursor 扩展，将 AI Agent 的编辑行为可视化为 K 线图。两个项目共享核心的记录和 K 线构建逻辑：

- **KAgent** 作为 VS Code/Cursor 侧边栏扩展运行
- **k-files** 作为独立的 CLI 工具 + Web 服务运行

两个项目使用相同的 `.kfiles/` 数据格式，完全互通。

## 许可证

[MIT](LICENSE)
