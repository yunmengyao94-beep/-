'use strict';

/**
 * 本地开发用「热刷新」服务（Server-Sent Events）
 * ---------------------------------------------------------------------------
 * 作用：监听 frontend/ 目录的文件变化，通过 SSE 通知浏览器刷新页面。
 * 端点：GET /__live（text/event-stream）
 * 说明：
 *   · 仅用于本地 Mock 开发，生产环境不会启用（由 server/app.js 按需挂载）
 *   · 事件名 `reload`，数据为时间戳；前端收到后清空 Cache Storage 再 reload，
 *     避免 Service Worker 的 Cache First 策略把旧文件喂给页面
 */

const fs = require('fs');

/** 心跳间隔：防止中间层断开空闲连接 */
const HEARTBEAT_MS = 20000;
/** 文件变化去抖：编辑器一次保存可能触发多个事件 */
const DEBOUNCE_MS = 120;

/**
 * @param {{ dirs: string[], log?: (msg: string) => void }} options
 */
function createLiveReload(options = {}) {
  const dirs = options.dirs || [];
  const log = options.log || (() => {});

  /** 活跃的 SSE 连接 */
  const clients = new Set();
  let timer = null;

  function send(res, chunk) {
    try {
      res.write(chunk);
    } catch {
      clients.delete(res);
    }
  }

  function broadcast() {
    const payload = `event: reload\ndata: ${Date.now()}\n\n`;
    clients.forEach((res) => send(res, payload));
    if (clients.size > 0) {
      log(`[yxx-live] 已通知 ${clients.size} 个页面刷新`);
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      broadcast();
    }, DEBOUNCE_MS);
  }

  function shouldIgnore(file) {
    if (!file) return false;
    const name = String(file);
    return (
      name.includes('node_modules') ||
      name.includes('.git') ||
      name.startsWith('.') ||
      name.endsWith('.tmp') ||
      name.endsWith('~') ||
      name.endsWith('.swp')
    );
  }

  function watch(dir) {
    try {
      fs.watch(dir, { recursive: true }, (_event, filename) => {
        if (shouldIgnore(filename)) return;
        schedule();
      });
      log(`[yxx-live] 正在监听 ${dir}`);
    } catch (error) {
      log(`[yxx-live] 监听失败 ${dir}：${error.message}`);
    }
  }

  /** Express 中间件：GET /__live */
  function middleware(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 1000\n\n');

    clients.add(res);

    const heartbeat = setInterval(() => send(res, ': ping\n\n'), HEARTBEAT_MS);

    req.on('close', () => {
      clearInterval(heartbeat);
      clients.delete(res);
    });
  }

  return {
    middleware,
    start() {
      dirs.forEach(watch);
    },
    get size() {
      return clients.size;
    },
    /** 供测试/命令行手动触发一次刷新 */
    trigger: broadcast,
  };
}

module.exports = { createLiveReload, HEARTBEAT_MS, DEBOUNCE_MS };
