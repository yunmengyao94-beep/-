'use strict';

/**
 * 易校圈 · 本地服务端（Express）
 * ---------------------------------------------------------------
 * Sprint 1：CORS / JSON 解析 / Morgan / 健康检查 / 假 JWT / 鉴权中间件
 * Sprint 2：seed_db 数据集、通用响应封装、核心业务路由（items / orders / users）、
 *           全局 300ms 网络延迟模拟
 *
 * 契约依据：7.1（协议/鉴权/时间/分页）、7.2（统一响应与错误码）、7.3.1（登录）、
 *          7.3.2（expires_in）、7.3.4（借用申请）、7.4（接口清单）
 *
 * 目录：server/routes/*（业务路由）、server/middlewares/auth.js（鉴权网关）、
 *      server/utils/*（响应/分页/脱敏）、server/store.js（数据仓）
 * 启动：node server/app.js    （默认 http://localhost:3000）
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const { fail } = require('./utils/http');
const auth = require('./middlewares/auth');
const { db: dataStore, backupDb, hasRecoveredFromBackup } = require('./store');
const { createAuthRouter } = require('./routes/auth');
const itemsRouter = require('./routes/items');
const ordersRouter = require('./routes/orders');
const usersRouter = require('./routes/users');
const notificationsRouter = require('./routes/notifications');
const { createLiveReload } = require('./live-reload');

const app = express();

/* ---------------------------------------------------------------- 基础配置 */

const PORT = Number(process.env.PORT) || 3000;
/** 生产必须注入 JWT_SECRET，此处仅为本地开发的兜底值 */
const JWT_SECRET = process.env.JWT_SECRET || 'yxx-dev-secret-change-me';
/** 7.3.2：token 有效期 604800 秒 = 7 天 */
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
/** 白名单：无需 Token 的公开路由（字符串=全方法公开；对象=仅指定方法公开） */
const PUBLIC_ROUTES = [
  '/api/v1/health',
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  // 校园 App 允许未登录浏览：列表与详情只放行 GET，发布/编辑仍需 Token
  { path: '/api/v1/items', methods: ['GET'] },
  { path: '/api/v1/items/:id', methods: ['GET'] },
];

/** 模拟网络延迟（毫秒）。NET_DELAY_MS=0 可关闭，便于压测 */
const DELAY_MS = process.env.NET_DELAY_MS === undefined ? 300 : Number(process.env.NET_DELAY_MS);

/* -------------------------------------------------------------- 全局中间件 */

app.disable('x-powered-by');
app.set('trust proxy', true);

// 1) CORS：本地开发允许所有源（不携带 Cookie，origin: '*' 安全）
app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    exposedHeaders: ['X-Trace-Id'],
    maxAge: 86400,
  })
);

// 2) 请求体解析（限制 1MB，防止大包打爆进程）
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// 3) 访问日志
app.use(morgan('dev'));

// 4) 链路追踪：每请求一个 trace_id，贯穿响应与日志（7.2）
app.use((req, res, next) => {
  req.traceId = crypto.randomUUID();
  res.set('X-Trace-Id', req.traceId);
  next();
});

// 5) 静态资源：直接预览 frontend 下的页面与样式
//    （原生 ES Module 在 file:// 下会被 CORS 拦截，故统一走 HTTP 预览）
//    放在延迟中间件之前，避免每个 CSS/JS 都被拖 300ms
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND_DIR, { extensions: ['html'] }));

// 5.1) 开发热刷新：GET /__live（SSE）
//      仅本地开发使用；同样放在延迟中间件之前，保证事件即时送达
const liveReload = createLiveReload({
  dirs: [FRONTEND_DIR],
  log: (msg) => console.info(msg),
});
app.get('/__live', liveReload.middleware);

// 6) 网络延迟模拟：所有接口统一延时，贴近真实移动网络体验
app.use((req, res, next) => {
  if (!Number.isFinite(DELAY_MS) || DELAY_MS <= 0) return next();
  return setTimeout(next, DELAY_MS);
});

/* ------------------------------------------------------------- 公开路由 */

/**
 * 健康探针（验收要求只返回三要素，不附加 trace_id / server_time，
 * 避免探活流量污染业务链路日志）。
 */
app.get('/api/v1/health', (req, res) => {
  res.json({ code: 200, msg: 'success', data: 'server is running' });
});

/* ------------------------------------------------------------- 鉴权中间件 */

// 统一网关：白名单（/health、/login、/register）放行，其余校验 Bearer Token
// 注意：auth 路由必须挂在网关「之后」——这样 /auth/logout 才能拿到 req.user / req.token，
//       而 /auth/login、/auth/register 已在白名单里，不受影响。
app.use(auth({ secret: JWT_SECRET, publicPaths: PUBLIC_ROUTES }));

/* ------------------------------------------------------------- 业务路由 */

// 登录 / 注册 / 退出登录：见 server/routes/auth.js（密码 scrypt 校验，JWT 含真实 user_id）
app.use('/api/v1/auth', createAuthRouter({ secret: JWT_SECRET, ttlSeconds: TOKEN_TTL_SECONDS }));

app.use('/api/v1/items', itemsRouter);
app.use('/api/v1/orders', ordersRouter);
app.use('/api/v1/users', usersRouter);
app.use('/api/v1/notifications', notificationsRouter);

/* --------------------------------------------------------- 兜底与错误处理 */

app.use((req, res) => {
  return fail(req, res, 404, 40401, '资源不存在', { path: req.path });
});

// 统一错误处理（必须是 4 个参数，Express 才识别为错误中间件）
app.use((err, req, res, _next) => {
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
    return fail(req, res, 400, 40001, '请求体不是合法 JSON');
  }
  console.error('[yxx] unhandled error:', err);
  return fail(req, res, 500, 50001, '服务端内部错误');
});

/* ------------------------------------------------------------------ 启动 */

/** 是否需要启动后自动打开浏览器（node server/app.js --open） */
const SHOULD_OPEN = process.argv.includes('--open');
/** 端口被占用时最多顺延尝试的次数 */
const PORT_RETRY = 10;

/** 用系统默认浏览器打开地址 */
function openBrowser(url) {
  const { spawn } = require('child_process');
  const cmd =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];

  try {
    spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref();
    console.info(`[yxx] 已调用系统浏览器打开 ${url}`);
  } catch (error) {
    console.warn(`[yxx] 打开浏览器失败（请手动访问 ${url}）：${error.message}`);
  }
}

/* --------------------------------------------------------- 单实例锁 / 备份 */

/** 锁文件：记录本实例 pid + 端口，防止多开覆盖 db.json */
const LOCK_FILE = path.join(__dirname, '.yxx.lock');

/** 进程是否还活着 */
function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === 'EPERM';
  }
}

/**
 * 获取单实例锁
 * 已有存活实例 → 直接退出；残留的死锁 → 覆盖
 * @param {number} port
 */
function acquireInstanceLock(port) {
  try {
    const raw = fs.readFileSync(LOCK_FILE, 'utf8');
    const info = JSON.parse(raw);

    if (info && info.pid && info.pid !== process.pid && isProcessAlive(info.pid)) {
      console.error(
        `[yxx] 启动被拒绝：已有实例在运行（pid=${info.pid}，端口=${info.port}）。\n` +
          '[yxx] 如需重启，请先关闭旧实例，或删除 server/.yxx.lock 后重试。'
      );
      process.exit(1);
    }
  } catch {
    // 无锁文件 / 内容损坏 → 直接接管
  }

  try {
    fs.writeFileSync(
      LOCK_FILE,
      JSON.stringify({ pid: process.pid, port, started_at: new Date().toISOString() }, null, 2),
      'utf8'
    );
  } catch (error) {
    console.warn(`[yxx] 写入锁文件失败（不影响运行）：${error.message}`);
  }
}

/** 释放锁（只删自己写的那个） */
function releaseInstanceLock() {
  try {
    const info = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
    if (info && info.pid === process.pid) fs.unlinkSync(LOCK_FILE);
  } catch {
    // 忽略
  }
}

/** 启动时备份一次 + 每天凌晨 3 点再备份一次 */
function setupDailyBackup() {
  const ok = backupDb();
  console.info(
    ok ? '[yxx] 数据已备份到 server/db.backup.json' : '[yxx] 暂无可备份的数据文件（首次启动）'
  );

  /** 下一次凌晨 3 点 */
  function scheduleNext() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(3, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);

    const timer = setTimeout(() => {
      const done = backupDb();
      if (done) console.info('[yxx] 每日备份完成：server/db.backup.json');
      scheduleNext();
    }, next.getTime() - now.getTime());

    // 不阻止进程退出
    if (typeof timer.unref === 'function') timer.unref();
  }

  scheduleNext();
}

/**
 * 带端口顺延的监听：EADDRINUSE 时自动尝试下一个端口
 * @param {number} port
 * @param {number} remaining
 */
function listen(port, remaining = PORT_RETRY) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port);

    server.once('listening', () => resolve({ server, port }));
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE' && remaining > 0) {
        console.warn(`[yxx] 端口 ${port} 被占用，自动改用 ${port + 1} …`);
        resolve(listen(port + 1, remaining - 1));
        return;
      }
      reject(error);
    });
  });
}

if (require.main === module) {
  acquireInstanceLock(PORT);

  // 进程退出 / Ctrl+C 时释放锁
  process.on('exit', releaseInstanceLock);
  process.on('SIGINT', () => {
    releaseInstanceLock();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    releaseInstanceLock();
    process.exit(0);
  });

  setupDailyBackup();

  if (hasRecoveredFromBackup()) {
    console.warn('[yxx][告警] 本次启动使用了备份数据，请检查 db.json 是否曾被外部破坏');
  }

  listen(PORT)
    .then(({ port }) => {
      const url = `http://localhost:${port}`;
      console.info(`[yxx] 服务已启动：${url}（延迟 ${DELAY_MS}ms）`);
      console.info(
        `[yxx] 数据规模：users=${dataStore.users.length} items=${dataStore.items.length} orders=${dataStore.orders.length} credit_logs=${dataStore.credit_logs.length}`
      );
      console.info(`[yxx] 首页：${url}/index.html | 热刷新：已开启（改文件后浏览器自动刷新）`);

      liveReload.start();
      if (SHOULD_OPEN) openBrowser(`${url}/index.html`);
    })
    .catch((error) => {
      console.error(`[yxx] 启动失败：${error.message}`);
      process.exit(1);
    });
}

module.exports = app;
