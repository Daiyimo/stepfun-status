const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const STEPFUN_HOST = "platform.stepfun.com";
const STEPFUN_ORIGIN = `https://${STEPFUN_HOST}`;

const CONFIG = {
  CACHE_TIMEOUT: 30000,       // 缓存超时：30 秒
  REQUEST_TIMEOUT: 8000,      // 网络请求超时：8 秒
  CONFIG_FILENAME: ".stepfun-config.json",
};

// ─── 跨平台 User-Agent ────────────────────────────────────────────────────────

/**
 * 根据当前操作系统返回对应的浏览器 User-Agent 字符串，
 * 避免 macOS/Linux 下使用 Windows UA 被服务端检测。
 */
function getPlatformUserAgent() {
  const platform = os.platform();
  if (platform === "darwin") {
    return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
  }
  if (platform === "linux") {
    return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
  }
  // Windows（默认）
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
}

// 配置文件路径（模块级常量，供外部共享，避免各处重复计算）
const CONFIG_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE,
  CONFIG.CONFIG_FILENAME
);

// ─── 模块级纯函数（提升出 parseUsageData，避免每次调用重新创建） ──────────────

/**
 * 将 Unix 时间戳转换为剩余时间对象
 * @param {string|number|null} timestamp  Unix 秒级时间戳
 * @returns {{ ts: number, date: string, hoursUntil: number, minutesUntil: number } | null}
 */
function formatResetTime(timestamp) {
  if (!timestamp) return null;
  const ts = parseInt(timestamp, 10);
  const date = new Date(ts * 1000);
  const diffMs = date.getTime() - Date.now();
  return {
    ts,
    date: date.toLocaleString(),
    hoursUntil: Math.max(0, Math.floor(diffMs / (1000 * 60 * 60))),
    minutesUntil: Math.max(0, Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))),
  };
}

/**
 * 将剩余时间对象格式化为可读文本
 * @param {{ hoursUntil: number, minutesUntil: number } | null} resetInfo
 * @returns {string}
 */
function calcRemainingText(resetInfo) {
  if (!resetInfo) return "未知";
  const { hoursUntil, minutesUntil } = resetInfo;
  return hoursUntil > 0
    ? `${hoursUntil} 小时 ${minutesUntil} 分钟后重置`
    : `${minutesUntil} 分钟后重置`;
}

// ─── StepFunAPI 类 ────────────────────────────────────────────────────────────

class StepFunAPI {
  constructor() {
    this.cookie = null;
    this.cache = {
      statusData: null,
      quotaData: null,
      statusTimestamp: 0,
      quotaTimestamp: 0,
    };
    this.loadConfig();
  }

  /** 是否已配置凭据 */
  isAuthenticated() {
    return Boolean(this.cookie);
  }

  loadConfig() {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
        this.cookie = config.cookie || null;
      }
    } catch (error) {
      console.error("Failed to load config:", error.message);
    }
  }

  saveConfig() {
    try {
      const config = { cookie: this.cookie };
      // 0o600：仅所有者可读写，在 Unix/Mac 上防止其他用户读取 Cookie
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
    } catch (error) {
      console.error("Failed to save config:", error.message);
    }
  }

  setCredentials(cookie) {
    if (!cookie || typeof cookie !== "string" || !cookie.trim()) {
      throw new Error("Cookie 不能为空");
    }
    this.cookie = cookie.trim();
    this.saveConfig();
  }

  /** 从 Cookie 字符串中提取指定字段 */
  extractFromCookie() {
    if (!this.cookie) return { oasisWebid: null };

    const cookies = {};
    this.cookie.split(/;\s*/).forEach((c) => {
      const idx = c.indexOf("=");
      if (idx === -1) return;
      const key = c.slice(0, idx).trim();
      const val = c.slice(idx + 1);
      if (!key) return;
      try {
        cookies[key] = decodeURIComponent(val);
      } catch {
        cookies[key] = val;
      }
    });

    return { oasisWebid: cookies["Oasis-Webid"] || null };
  }

  async makePlatformRequest(endpoint, data = {}) {
    if (!this.cookie) {
      throw new Error(
        'Missing cookie. Please run "stepfun auth <cookie>" first.\n' +
          "获取方式:\n" +
          "1. 登录 https://platform.stepfun.com/plan-subscribe\n" +
          "2. F12 -> Network -> 刷新页面\n" +
          "3. 点击任意 API 请求 -> Copy -> Copy request headers -> 复制 Cookie 行"
      );
    }

    const { oasisWebid } = this.extractFromCookie();
    const postData = JSON.stringify(data);

    const headers = {
      accept: "*/*",
      "content-type": "application/json",
      "oasis-appid": "10300",
      "oasis-platform": "web",
      "oasis-webid": oasisWebid || "",
      origin: STEPFUN_ORIGIN,
      referer: `${STEPFUN_ORIGIN}/plan-subscribe`,
      "user-agent": getPlatformUserAgent(),
      "content-length": Buffer.byteLength(postData),
      Cookie: this.cookie,
    };

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: STEPFUN_HOST,   // 与 STEPFUN_ORIGIN 保持同一数据源
          port: 443,
          path: endpoint,
          method: "POST",
          headers,
          rejectUnauthorized: true, // 显式启用 SSL 证书验证
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => { body += chunk; });
          res.on("end", () => {
            if (res.statusCode === 200) {
              try {
                resolve(JSON.parse(body));
              } catch {
                reject(new Error("Failed to parse response: invalid JSON"));
              }
            } else if (res.statusCode === 401) {
              reject(new Error("Cookie 已失效或过期，请重新运行 auth 命令"));
            } else {
              reject(new Error(`API error: HTTP ${res.statusCode}`));
            }
          });
        }
      );

      // 超时保护
      req.setTimeout(CONFIG.REQUEST_TIMEOUT, () => {
        req.destroy();
        reject(new Error(`Request timeout after ${CONFIG.REQUEST_TIMEOUT / 1000}s`));
      });

      req.on("error", (e) => {
        reject(new Error(`Network error: ${e.message}`));
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * 带缓存的请求封装，消除 getSubscriptionStatus / getQuotaInfo 的重复逻辑
   * @param {'statusData'|'quotaData'} dataKey       缓存数据字段名
   * @param {'statusTimestamp'|'quotaTimestamp'} tsKey 缓存时间戳字段名
   * @param {string} endpoint                         API 路径
   * @param {boolean} forceRefresh                    是否强制跳过缓存
   */
  async _cachedRequest(dataKey, tsKey, endpoint, forceRefresh) {
    const now = Date.now();
    if (
      !forceRefresh &&
      this.cache[dataKey] &&
      now - this.cache[tsKey] < CONFIG.CACHE_TIMEOUT
    ) {
      return this.cache[dataKey];
    }
    const data = await this.makePlatformRequest(endpoint);
    this.cache[dataKey] = data;
    this.cache[tsKey] = now;
    return data;
  }

  async getSubscriptionStatus(forceRefresh = false) {
    return this._cachedRequest(
      "statusData",
      "statusTimestamp",
      "/api/step.openapi.devcenter.Dashboard/GetStepPlanStatus",
      forceRefresh
    );
  }

  async getQuotaInfo(forceRefresh = false) {
    return this._cachedRequest(
      "quotaData",
      "quotaTimestamp",
      "/api/step.openapi.devcenter.Dashboard/QueryStepPlanRateLimit",
      forceRefresh
    );
  }

  // ── 预留扩展区 ──────────────────────────────────────────────────────────────
  // 后续新增接口时，只需：
  //   1. 在 this.cache 里加对应的 data/timestamp 字段
  //   2. 仿照下方模板写一个 get 方法
  //   3. 在 getUsageStatus / parseUsageData 里消费新数据
  //
  // 模板（等 Token 用量明细接口开放后接入）：
  //
  // async getTokenUsage(forceRefresh = false) {
  //   return this._cachedRequest(
  //     "tokenData",
  //     "tokenTimestamp",
  //     "/api/step.openapi.devcenter.Dashboard/QueryTokenUsage",  // 待确认
  //     forceRefresh
  //   );
  // }
  // ────────────────────────────────────────────────────────────────────────────

  async getUsageStatus(forceRefresh = false) {
    const [statusData, quotaData] = await Promise.all([
      this.getSubscriptionStatus(forceRefresh),
      this.getQuotaInfo(forceRefresh),
    ]);
    return this.parseUsageData(statusData, quotaData);
  }

  parseUsageData(statusData, quotaData) {
    const subscription = statusData.subscription || {};
    const planDefinition = statusData.plan_definition || {};

    const fiveHourLeftRate = quotaData.five_hour_usage_left_rate || 0;
    const weeklyLeftRate = quotaData.weekly_usage_left_rate || 0;

    const fiveHourUsedPercent = Math.round((1 - fiveHourLeftRate) * 100);
    const weeklyUsedPercent = Math.round((1 - weeklyLeftRate) * 100);

    const fiveHourReset = formatResetTime(quotaData.five_hour_usage_reset_time);
    const weeklyReset = formatResetTime(quotaData.weekly_usage_reset_time);

    let expiry = null;
    if (subscription.expired_at) {
      const expiryDate = new Date(parseInt(subscription.expired_at, 10) * 1000);
      const daysRemaining = Math.ceil(
        (expiryDate.getTime() - Date.now()) / (1000 * 3600 * 24)
      );
      expiry = {
        date: expiryDate.toLocaleString(),
        daysRemaining,
        text:
          daysRemaining > 0
            ? `还剩 ${daysRemaining} 天`
            : daysRemaining === 0
            ? "今天到期"
            : `已过期 ${Math.abs(daysRemaining)} 天`,
      };
    }

    return {
      modelName: planDefinition.support_models?.[0] || "step-3.5-flash",
      planName: subscription.name || "Mini",
      remaining: {
        hours: fiveHourReset?.hoursUntil || 0,
        minutes: fiveHourReset?.minutesUntil || 0,
        text: calcRemainingText(fiveHourReset),
      },
      usage: {
        percentage: fiveHourUsedPercent,
        remaining: Math.round(fiveHourLeftRate * 100),
      },
      weekly: {
        percentage: weeklyUsedPercent,
        remaining: Math.round(weeklyLeftRate * 100),
        text: calcRemainingText(weeklyReset),
        daysUntilReset: weeklyReset?.hoursUntil
          ? Math.floor(weeklyReset.hoursUntil / 24)
          : 0,
      },
      expiry,
    };
  }

  clearCache() {
    this.cache = {
      statusData: null,
      quotaData: null,
      statusTimestamp: 0,
      quotaTimestamp: 0,
    };
  }
}

module.exports = { StepFunAPI, CONFIG_PATH };
