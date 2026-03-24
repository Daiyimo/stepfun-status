# StepFun Status 项目架构文档

## 概述

StepFun Status 是一个 StepFun Token-Plan 使用状态监控工具，支持 CLI 命令和 Claude Code 状态栏集成。

**注意**: 此工具需要 StepFun 官方开放用量查询 API 后才能显示完整额度信息。

---

## API 接口汇总

### 1. Platform API (需要浏览器 Cookie)

**Base URL**: `https://platform.stepfun.com`

**认证方式**: 完整 Cookie 字符串（包含 `Oasis-Token` 和 `Oasis-Webid`）

**获取方式**:
1. 登录 https://platform.stepfun.com/plan-subscribe
2. F12 → Network 标签
3. 刷新页面
4. 点击任意 API 请求（如 `GetStepPlanStatus`）
5. 滚动到 Request Headers → 找到 `Cookie` 行
6. 右键 → Copy value

---

#### 1.1 GetStepPlanStatus - 获取订阅信息

**Endpoint**: `POST /api/step.openapi.devcenter.Dashboard/GetStepPlanStatus`

**请求体**: `{}`

**响应格式**:
```json
{
  "status": 1,
  "desc": "",
  "subscription": {
    "plan_type": 4,
    "name": "Mini",
    "status": 1,
    "pay_channel": 1,
    "activated_at": "1774255868",
    "expired_at": "1776847868",
    "auto_renew": false,
    "plan_id": "5"
  },
  "plan_definition": {
    "type": 4,
    "price": "2500",
    "support_models": ["step-3.5-flash"],
    "available": true,
    "original_price": "4900",
    "plan_id": "5"
  }
}
```

**字段说明**:
- `subscription.name`: 套餐名称 (Mini/Pro等)
- `subscription.activated_at`: 激活时间戳(秒)
- `subscription.expired_at`: 到期时间戳(秒)
- `plan_definition.support_models`: 支持的模型列表

---

#### 1.2 QueryStepPlanRateLimit - 获取用量信息

**Endpoint**: `POST /api/step.openapi.devcenter.Dashboard/QueryStepPlanRateLimit`

**请求体**: `{}`

**响应格式**:
```json
{
  "status": 1,
  "desc": "",
  "five_hour_usage_left_rate": 0.9999867,
  "five_hour_usage_reset_time": "1774324800",
  "weekly_usage_left_rate": 0.9103905,
  "weekly_usage_reset_time": "1774857600"
}
```

**字段说明**:
- `five_hour_usage_left_rate`: 5小时窗口剩余比例 (0-1)
- `five_hour_usage_reset_time`: 5小时窗口重置时间戳(秒)
- `weekly_usage_left_rate`: 每周剩余比例 (0-1)
- `weekly_usage_reset_time`: 每周重置时间戳(秒)

---

### 2. Developer API (API Key 方式) - [待开放]

**Base URL**: `https://api.stepfun.com`

**认证方式**: `Authorization: Bearer <API_KEY>`

**API Key 获取**: https://platform.stepfun.com/interface-key

#### 2.1 Models - 模型列表

**Endpoint**: `GET /v1/models`

**响应格式**:
```json
{
  "data": [
    {
      "id": "step-3.5-flash",
      "object": "model",
      "created": 1769580037,
      "owned_by": "stepai"
    }
  ],
  "object": "list"
}
```

#### 2.2 Chat Completions - 对话

**Endpoint**: `POST /v1/chat/completions`

**请求示例**:
```json
{
  "model": "step-3.5-flash",
  "messages": [{"role": "user", "content": "hi"}]
}
```

#### 2.3 Usage API - [待 StepFun 官方开放]

**Endpoint**: `GET /v1/usage` (待确认)

此接口将允许使用 API Key 查询账户用量，无需浏览器 Cookie。

---

## 配置文件

**路径**: `~/.stepfun-config.json`

**格式**:
```json
{
  "cookie": "Oasis-Webid=xxx; Oasis-Token=xxx; ..."
}
```

---

## 与 MiniMax 的对比

| 功能 | MiniMax | StepFun |
|------|---------|---------|
| AI API | ✅ OpenAI Compatible | ✅ OpenAI Compatible |
| 用量查询 API | ✅ 有 | ⏳ 待开放 |
| 认证方式 | API Key | Cookie (当前) / API Key (待开放) |
| 配置文件 | `~/.minimax-config.json` | `~/.stepfun-config.json` |

---

## 页面显示数据来源

页面 https://platform.stepfun.com/plan-subscribe 显示的数据：

```
5小时用量: 剩余 100%, 重置时间: 2026-03-24 12:00:00
每周用量: 剩余 91%, 重置时间: 2026-03-30 16:00:00
```

这些数据来自 `QueryStepPlanRateLimit` 接口。
