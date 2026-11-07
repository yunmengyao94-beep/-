/**
 * 全局路由守卫（登录校验）
 * ---------------------------------------------------------------------------
 * 用法：在需要登录的页面 <head> 里、所有业务脚本之前，同步引入：
 *   <script src="./js/auth.js"></script>
 *
 * 注意区分：
 *   · js/auth.js        —— 本文件：路由守卫（有没有登录）
 *   · utils/auth.js     —— 换取/复用 Token 的工具函数（ensureToken）
 *
 * 规则：
 *   1. localStorage 无 yxx_token → 强制跳转 login.html（带 redirect 回跳参数）
 *   2. login.html / register.html 不校验
 *   3. 用 location.replace 跳转，避免用户按返回又回到需要登录的页面
 */

(function authGuard() {
  const TOKEN_KEY = 'yxx_token';
  const PUBLIC_PAGES = ['login.html', 'register.html'];

  const path = window.location.pathname || '';
  const page = path.split('/').pop() || 'index.html';

  // 登录/注册页放行
  if (PUBLIC_PAGES.indexOf(page) !== -1) return;

  let token = null;
  try {
    token = window.localStorage.getItem(TOKEN_KEY);
  } catch {
    token = null;
  }

  if (token) return;

  // 记录原地址，登录后跳回
  const redirect = path + (window.location.search || '') + (window.location.hash || '');
  let target = './login.html';

  try {
    target += '?redirect=' + encodeURIComponent(redirect);
  } catch {
    // 极端情况下（location 异常）直接去登录页
  }

  window.location.replace(target);
})();
