'use strict';

/**
 * 预加载脚本
 * ---------------------------------------------------------------------------
 * 在页面任何脚本执行前，把 API 地址注入主世界，避免登录页重定向丢失 ?api= 参数。
 */

const { contextBridge, ipcRenderer } = require('electron');

let apiOrigin = '';
try {
  apiOrigin = ipcRenderer.sendSync('yxx:api-origin') || '';
} catch {
  apiOrigin = '';
}

contextBridge.exposeInMainWorld('__YXX_API_ORIGIN__', apiOrigin);
