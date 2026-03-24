# stepfun-status

> StepFun Token-Plan 使用状态监控工具，支持 Claude Code 状态栏常驻显示。

[![npm version](https://img.shields.io/npm/v/stepfun-status)](https://www.npmjs.com/package/stepfun-status)
[![npm downloads](https://img.shields.io/npm/dm/stepfun-status)](https://www.npmjs.com/package/stepfun-status?activeTab=downloads)
[![Node >=16](https://img.shields.io/node/v/stepfun-status)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## 效果预览

Claude Code 底部状态栏：

```
my-app │ main │ step-3.5-flash │ ██████░░░░ 60% (40/100) │ ⏱ 1h30m │ W ███░░ 58% │ 到期 12天
```

终端详细视图：

```
┌──────────────────────────────────────────────┐
│ StepFun Claude Code 使用状态                  │
│                                               │
│ 当前模型: step-3.5-flash                      │
│ 套餐:     Mini                                │
│                                               │
│ 5小时用量: ██████████████████░░░░░░░░░░ 60%  │
│      剩余: 40%                                │
│      重置: 1 小时 30 分钟后重置               │
│                                               │
│ 每周用量: ████████░░░░░░░ 58%                 │
│     剩余: 42%                                 │
│     重置: 3 小时 12 分钟后重置                │
│                                               │
│ 套餐到期: 2025/6/1 00:00:00 (还剩 12 天)      │
│                                               │
│ 状态: ⚡ 注意使用                             │
└──────────────────────────────────────────────┘
```

## 安装

```bash
npm install -g stepfun-status
```

## 快速开始

### 1. 获取 Cookie 并认证

运行下方命令，会自动打印获取步骤：

```bash
stepfun auth
```

按提示操作：
1. 登录 [https://platform.stepfun.com/plan-subscribe](https://platform.stepfun.com/plan-subscribe)
2. F12 → Network 标签 → 刷新页面
3. 点击任意 API 请求（如 `GetStepPlanStatus`）
4. 滚动到 Request Headers → 找到 `Cookie` 行
5. **右键 → Copy value**（必须用此方式，直接框选会截断）
6. 粘贴到终端并回车

> **提示**：Cookie 较长，建议使用交互式 `stepfun auth`（无参数），避免命令行参数截断问题。

### 2. 验证连接

```bash
stepfun health
```

### 3. 查看状态

```bash
stepfun status
```

## Claude Code 状态栏集成

### 配置

编辑 `~/.claude/settings.json`，添加：

```json
{
  "statusLine": {
    "type": "command",
    "command": "stepfun statusline"
  }
}
```

重启 Claude Code 后生效。


### 状态栏格式

```
目录 │ 分支 │ 模型 │ 5小时用量进度条(剩余) │ ⏱ 倒计时 │ W 周用量 │ 到期天数
```

**颜色说明**：

| 指标 | 绿色 | 黄色 | 红色 |
|------|------|------|------|
| 用量 | < 60% | 60–85% | ≥ 85% |
| 到期 | > 7 天 | ≤ 7 天 | ≤ 3 天 |
| 分支 | main/master | — | 有未提交改动（`*`） |

## 命令参考

| 命令 | 选项 | 说明 |
|------|------|------|
| `stepfun auth [cookie]` | — | 设置认证 Cookie（推荐无参数交互式输入） |
| `stepfun health` | — | 检查配置文件、Cookie 和 API 连通性 |
| `stepfun status` | — | 详细模式显示当前使用状态 |
| `stepfun status` | `-c, --compact` | 紧凑单行模式 |
| `stepfun status` | `-w, --watch` | 实时监控，每 10 秒刷新 |
| `stepfun status` | `-c -w` | 紧凑模式 + 实时监控 |
| `stepfun statusline` | — | 输出状态行（供 Claude Code 调用） |
| `stepfun statusline` | `-w, --watch` | 持续刷新状态行输出 |

## 配置文件

| 项目 | 说明 |
|------|------|
| 路径 | `~/.stepfun-config.json` |
| 内容 | `{ "cookie": "..." }` |
| 权限 | Unix/Mac 下自动设置为 `0600`（仅所有者可读写） |

> **Windows 注意**：不支持 Unix 文件权限位，Cookie 以明文存储，请妥善保管配置文件，避免他人访问。

> **macOS / Linux**：配置文件权限已自动设为 `0600`，只有当前用户可读写，无需额外操作。

## 常见问题

**Q: 状态栏显示 ❌**
A: Cookie 未配置或已过期，运行 `stepfun health` 诊断，再用 `stepfun auth` 重新设置。

**Q: Cookie 粘贴后提示"不能为空"**
A: 可能复制到了空内容，请确保在 Network 面板使用"右键 → Copy value"而非框选复制。

**Q: 状态栏不显示**
A: 确认 `~/.claude/settings.json` 中 `statusLine.command` 为 `stepfun statusline`，且 `stepfun-status` 已全局安装（`npm install -g stepfun-status`）。

**Q: macOS / Linux 上 `stepfun` 命令找不到**
A: 确认 npm 全局 bin 目录已加入 `PATH`。可运行 `npm bin -g` 查看路径，并将其添加到 `~/.zshrc` 或 `~/.bashrc`：
```bash
export PATH="$(npm bin -g):$PATH"
```

## 开发

```bash
git clone https://github.com/Daiyimo/stepfun-status.git
cd stepfun-status
npm install
npm link          # 本地全局链接，方便调试

npm start         # 查看当前状态
npm test          # 检查连通性
npm run lint      # 语法检查
```

## 许可证

[MIT](LICENSE)

## 相关链接

- [StepFun 开放平台](https://platform.stepfun.com)
- [StepFun 接口密钥](https://platform.stepfun.com/interface-key)
- [StepFun 订阅情况](https://platform.stepfun.com/plan-subscribe)
- [StepFun 接入指南](https://platform.stepfun.com/docs/zh/step-plan/integrations)
