#!/usr/bin/env node

// Force color output even in non-TTY environments (e.g., Claude Code statusline)
process.env.FORCE_COLOR = "1";

const { execSync } = require("child_process");
const { Command } = require("commander");
const chalk = require("chalk").default;
const ora = require("ora").default;
const { default: boxen } = require("boxen");
const { StepFunAPI, CONFIG_PATH } = require("./api");
const packageJson = require("../package.json");
const fs = require("fs");

// ─── 全局错误兜底 ─────────────────────────────────────────────────────────────
process.on("uncaughtException", (error) => {
  console.error(chalk.red("💥 未捕获的错误:"), error.message);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error(
    chalk.red("💥 未处理的 Promise 错误:"),
    reason instanceof Error ? reason.message : reason
  );
  process.exit(1);
});

// ─── 常量 ────────────────────────────────────────────────────────────────────
const WATCH_INTERVAL = 10000; // watch 模式刷新间隔：10 秒

// ─── 阈值常量（避免魔法数字） ─────────────────────────────────────────────────
const THRESHOLD = {
  USAGE_CRITICAL: 85,  // 用量 >= 85% 时显示红色告警
  USAGE_WARNING: 60,   // 用量 >= 60% 时显示黄色警告
  EXPIRY_CRITICAL: 3,  // 订阅剩余 <= 3 天时显示红色
  EXPIRY_WARNING: 7,   // 订阅剩余 <= 7 天时显示黄色
};

const program = new Command();
const api = new StepFunAPI();

program
  .name("stepfun-status")
  .description("StepFun Claude Code 使用状态监控工具")
  .version(packageJson.version);

// ─── 公共工具函数 ─────────────────────────────────────────────────────────────

/** 根据已用百分比返回对应的 chalk 颜色函数 */
function getUsageColor(percentage) {
  if (percentage >= THRESHOLD.USAGE_CRITICAL) return chalk.red;
  if (percentage >= THRESHOLD.USAGE_WARNING) return chalk.yellow;
  return chalk.green;
}

/** 根据订阅剩余天数返回对应的 chalk 颜色函数 */
function getExpiryColor(daysRemaining) {
  if (daysRemaining <= THRESHOLD.EXPIRY_CRITICAL) return chalk.red;
  if (daysRemaining <= THRESHOLD.EXPIRY_WARNING) return chalk.yellow;
  return chalk.green;
}

/**
 * 生成带颜色的进度条字符串
 * @param {number} percentage  0–100
 * @param {number} width       进度条总格数
 * @param {Function} colorFn   chalk 颜色函数
 */
function renderProgressBar(percentage, width, colorFn) {
  const filled = Math.round((Math.min(100, Math.max(0, percentage)) / 100) * width);
  const empty = width - filled;
  return colorFn("█".repeat(filled)) + chalk.dim("░".repeat(empty));
}

/** 清屏（仅在 TTY 环境，兼容各终端） */
function clearScreen() {
  if (process.stdout.isTTY) {
    process.stdout.write("\x1B[2J\x1B[0f");
  }
}

/** 获取当前 Git 分支信息，非 Git 目录返回 null */
function getGitBranch(cwd) {
  try {
    const branch = execSync("git symbolic-ref --short HEAD", {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
    }).trim();

    // 基本格式校验，防止异常值
    if (!branch || !/^[\w\-\./]+$/.test(branch)) return null;

    const status = execSync("git status --porcelain", {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
    }).trim();

    return { name: branch, hasChanges: Boolean(status) };
  } catch {
    return null;
  }
}

// ─── Auth 命令 ────────────────────────────────────────────────────────────────
program
  .command("auth")
  .description("设置认证凭据 (从浏览器 Network 面板复制)")
  .argument("[cookie]", "完整 Cookie 字符串（可选，可直接粘贴不带引号）")
  .action(async (cookie) => {
    // 无论是否已有参数，都先打印获取方式
    console.log(chalk.yellow("\n获取 Cookie 方式:"));
    console.log(chalk.gray("1. 登录 https://platform.stepfun.com/plan-subscribe"));
    console.log(chalk.gray("2. F12 -> Network 标签"));
    console.log(chalk.gray("3. 刷新页面"));
    console.log(chalk.gray("4. 点击任意 API 请求（如 GetStepPlanStatus）"));
    console.log(chalk.gray("5. 滚动到 Request Headers -> 找到 Cookie 行"));
    console.log(chalk.gray("6. 右键 -> Copy value"));

    if (!cookie) {
      const readline = require("readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      console.log(chalk.yellow("\n请粘贴完整的 Cookie 字符串:"));
      console.log(chalk.gray("(粘贴后按回车)"));

      cookie = await new Promise((resolve) => {
        rl.on("line", (input) => {
          rl.close();
          resolve(input.trim());
        });
      });
    }

    try {
      api.setCredentials(cookie);
    } catch (err) {
      console.error(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }

    console.log(chalk.green("\n✓ 认证信息已保存"));
    console.log(chalk.gray(`配置文件: ${CONFIG_PATH}`));
  });

// ─── Health 命令 ──────────────────────────────────────────────────────────────
program
  .command("health")
  .description("检查配置和连接状态")
  .action(async () => {
    const spinner = ora("正在检查...").start();

    if (!fs.existsSync(CONFIG_PATH)) {
      spinner.fail("配置文件检查");
      console.log(chalk.red("✗ 配置文件: ") + chalk.gray("未找到"));
      console.log(chalk.yellow("请先运行: stepfun-status auth <cookie>"));
      return;
    }

    spinner.succeed("配置文件检查");
    console.log(chalk.green("✓ 配置文件: ") + chalk.gray("已找到"));

    if (api.isAuthenticated()) {
      console.log(chalk.green("✓ Cookie: ") + chalk.gray("已配置"));
      try {
        await api.getUsageStatus();
        console.log(chalk.green("✓ API连接: ") + chalk.gray("正常"));
      } catch (error) {
        console.log(chalk.red("✗ API连接: ") + chalk.gray(error.message));
      }
    } else {
      console.log(chalk.red("✗ Cookie: ") + chalk.gray("未配置"));
    }
  });

// ─── Status 命令 ──────────────────────────────────────────────────────────────
program
  .command("status")
  .description("显示当前使用状态")
  .option("-c, --compact", "紧凑模式显示")
  .option("-w, --watch", "实时监控模式")
  .action(async (options) => {
    const spinner = ora("获取使用状态中...").start();

    try {
      const usageData = await api.getUsageStatus();
      spinner.succeed("状态获取成功");

      if (options.compact) {
        console.log(renderCompact(usageData));
      } else {
        console.log("\n" + renderDetailed(usageData) + "\n");
      }

      if (options.watch) {
        console.log(chalk.gray("监控中... 按 Ctrl+C 退出"));
        // 将已获取的数据和当前渲染函数传入，避免启动时重复请求，并保持显示模式一致
        const renderFn = options.compact ? renderCompact : renderDetailed;
        startWatching(usageData, renderFn);
      }
    } catch (error) {
      spinner.fail(chalk.red("获取状态失败"));
      console.error(chalk.red(`错误: ${error.message}`));
      process.exit(1);
    }
  });

// ─── Statusline 命令 ──────────────────────────────────────────────────────────
program
  .command("statusline")
  .description("Claude Code状态栏集成")
  .option("-w, --watch", "持续监控模式，用于Claude Code状态栏")
  .action(async (options) => {
    // 缓存一次，避免 renderStatusline 与 execSync 重复调用 process.cwd()
    const cwd = process.cwd();
    const cliCurrentDir = cwd.split(/[/\\]/).pop();

    const renderStatusline = async () => {
      try {
        const usageData = await api.getUsageStatus();
        const { usage, modelName, remaining, expiry, weekly } = usageData;
        const percentage = usage.percentage;
        const color = getUsageColor(percentage);

        const gitBranch = getGitBranch(cwd);

        const parts = [];

        if (cliCurrentDir) {
          parts.push(chalk.cyan(cliCurrentDir));
        }

        if (gitBranch) {
          const isMainBranch = gitBranch.name === "main" || gitBranch.name === "master";
          const branchColor = isMainBranch ? chalk.green : chalk.white;
          let branchStr = branchColor(gitBranch.name);
          if (gitBranch.hasChanges) branchStr += chalk.red(" *");
          parts.push(branchStr);
        }

        parts.push(chalk.magenta(modelName));

        const bar = renderProgressBar(percentage, 10, color);
        parts.push(`${bar} ${color(percentage + "%")} (${usage.remaining}/100)`);

        const remainingText =
          remaining.hours > 0
            ? `${remaining.hours}h${remaining.minutes}m`
            : `${remaining.minutes}m`;
        parts.push(`${chalk.yellow("⏱")} ${remainingText}`);

        if (weekly) {
          const weeklyColor = getUsageColor(weekly.percentage);
          const weeklyBar = renderProgressBar(weekly.percentage, 5, weeklyColor);
          parts.push(`${chalk.blue("W")} ${weeklyBar} ${weeklyColor(weekly.percentage + "%")}`);
        }

        if (expiry) {
          parts.push(getExpiryColor(expiry.daysRemaining)("到期 " + expiry.daysRemaining + "天"));
        }

        console.log(parts.join(" │ "));
      } catch {
        console.log(
          `${chalk.cyan(cliCurrentDir || "")} │ ${chalk.magenta("step-3.5-flash")} │ ${chalk.red("❌")}`
        );
      }
    };

    if (options.watch) {
      console.log(chalk.gray("Claude Code 状态栏已启动..."));

      let stopped = false;
      const shutdown = () => {
        stopped = true;
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      // 递归 setTimeout：等本次渲染完成后再安排下一次，避免并发请求
      const loop = async () => {
        if (stopped) return;
        clearScreen();
        await renderStatusline();
        if (!stopped) setTimeout(loop, WATCH_INTERVAL);
      };

      loop();
    } else {
      await renderStatusline();
    }
  });

// ─── 渲染函数 ─────────────────────────────────────────────────────────────────

function renderCompact(data) {
  const { usage, remaining, modelName, expiry, weekly } = data;
  const { percentage } = usage;
  const color = getUsageColor(percentage);

  const statusIcon =
    percentage >= THRESHOLD.USAGE_CRITICAL ? "⚠" :
    percentage >= THRESHOLD.USAGE_WARNING  ? "⚡" : "✓";
  const weeklyInfo = weekly ? ` ${chalk.blue("W")} ${weekly.percentage}%` : "";
  const expiryInfo = expiry ? ` ${chalk.gray("•")} 剩余: ${expiry.daysRemaining}天` : "";

  return (
    `${color("●")} ${modelName} ${percentage}% ` +
    `${chalk.dim(`(${usage.remaining}/100)`)} ${chalk.gray("•")} ` +
    `${remaining.text}${weeklyInfo} ${chalk.gray("•")} ${statusIcon}${expiryInfo}`
  );
}

function renderDetailed(data) {
  const { modelName, remaining, usage, weekly, expiry } = data;

  const barColor = getUsageColor(usage.percentage);
  const progressBar = renderProgressBar(usage.percentage, 30, barColor);

  const lines = [];
  lines.push(chalk.bold("StepFun Claude Code 使用状态"));
  lines.push("");
  lines.push(`${chalk.cyan("当前模型:")} ${modelName}`);
  lines.push(`${chalk.cyan("套餐:")} ${data.planName || "Mini"}`);
  lines.push("");
  lines.push(`${chalk.cyan("5小时用量:")} ${progressBar} ${usage.percentage}%`);
  lines.push(`${chalk.dim("     剩余:")} ${usage.remaining}%`);
  lines.push(`${chalk.dim("     重置:")} ${remaining.text}`);

  if (weekly) {
    const weeklyBar = renderProgressBar(weekly.percentage, 15, getUsageColor(weekly.percentage));
    lines.push("");
    lines.push(`${chalk.cyan("每周用量:")} ${weeklyBar} ${weekly.percentage}%`);
    lines.push(`${chalk.dim("     剩余:")} ${weekly.remaining}%`);
    lines.push(`${chalk.dim("     重置:")} ${weekly.text}`);
  }

  if (expiry) {
    lines.push("");
    lines.push(`${chalk.cyan("套餐到期:")} ${expiry.date} (${expiry.text})`);
  }

  lines.push("");

  const status =
    usage.percentage >= THRESHOLD.USAGE_CRITICAL ? "⚠ 即将用完" :
    usage.percentage >= THRESHOLD.USAGE_WARNING  ? "⚡ 注意使用" : "✓ 正常使用";
  lines.push(`${chalk.cyan("状态:")} ${getUsageColor(usage.percentage)(status)}`);

  return boxen(lines.join("\n"), {
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
    borderColor: "blue",
    borderStyle: "single",
    dimBorder: true,
  });
}

/**
 * 启动实时监控模式
 * @param {object|null} initialData  已获取的 usageData，传入可避免启动时重复请求
 * @param {Function} renderFn        渲染函数，默认 renderDetailed，可传 renderCompact 保持模式一致
 */
function startWatching(initialData = null, renderFn = renderDetailed) {
  const render = (data) => {
    clearScreen();
    console.log("\n" + renderFn(data) + "\n");
    console.log(chalk.gray(`最后更新: ${new Date().toLocaleTimeString()}`));
  };

  let stopped = false;
  const shutdown = () => {
    stopped = true;
    console.log(chalk.yellow("\n监控已停止"));
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // 递归 setTimeout：等本次请求完成后再安排下一次，避免慢网络下并发请求堆积
  const loop = async () => {
    if (stopped) return;
    try {
      const usageData = await api.getUsageStatus();
      render(usageData);
    } catch (error) {
      console.error(chalk.red(`更新失败: ${error.message}`));
    }
    if (!stopped) setTimeout(loop, WATCH_INTERVAL);
  };

  // 立即用已有数据渲染首帧，之后进入定时循环
  if (initialData) {
    render(initialData);
    setTimeout(loop, WATCH_INTERVAL);
  } else {
    loop();
  }
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

if (!process.argv.slice(2).length) {
  program.outputHelp();
  process.exit(1);
}

program.parse();
