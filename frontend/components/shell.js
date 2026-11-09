import { request, clearToken } from '../utils/request.js';

/**
 * PC 端壳层（侧边栏 + 顶部栏）
 * ---------------------------------------------------------------------------
 * · < 768px：完全隐藏，移动端继续用底部 TabBar + FAB
 * · ≥ 768px：左侧固定侧边栏（可折叠 200px ↔ 64px）+ 固定顶部栏
 * · 折叠状态存 localStorage（yxx_sidebar_collapsed），跨页面/刷新保持
 *
 * 只挂载在主页面（index / orders / profile / notifications / settings），
 * 详情页与发布页不加壳层，保持沉浸式。
 */

const COLLAPSE_KEY = 'yxx_sidebar_collapsed';

/** 导航项定义 */
const NAV_ITEMS = [
  {
    key: 'home',
    href: './index.html',
    label: '首页',
    icon: '<path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4v-5H9v5H5a1 1 0 0 1-1-1v-8.5Z" />',
  },
  {
    key: 'orders',
    href: './orders.html',
    label: '订单',
    icon: '<path d="M7 4h10a2 2 0 0 1 2 2v14l-3-2-3 2-3-2-3 2V6a2 2 0 0 1 2-2Z" /><path d="M9 9h6M9 12.5h6" />',
  },
  {
    key: 'messages',
    href: './notifications.html',
    label: '消息',
    icon: '<path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6Z" /><path d="M10 19a2 2 0 0 0 4 0" />',
    badge: true,
  },
  {
    key: 'profile',
    href: './profile.html',
    label: '我的',
    icon: '<circle cx="12" cy="8.5" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" />',
  },
  {
    key: 'settings',
    href: './settings.html',
    label: '设置',
    icon:
      '<circle cx="12" cy="12" r="3" />' +
      '<path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.05A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.05A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.05A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.05a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.05a1.7 1.7 0 0 0-1.55 1Z" />',
  },
];

/** 读取本地用户信息（头像首字 + 昵称） */
function readUser() {
  try {
    const raw = localStorage.getItem('yxx_user');
    const user = raw ? JSON.parse(raw) : {};
    return {
      name: user.nickname || user.real_name || '同学',
      college: user.college_code || '',
    };
  } catch {
    return { name: '同学', college: '' };
  }
}

/** 折叠状态 */
function isCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

function applyCollapsed(collapsed) {
  document.body.classList.toggle('is-sidebar-collapsed', collapsed);
  const toggle = document.getElementById('sidebar-toggle');
  if (toggle) {
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? '展开侧边栏' : '折叠侧边栏');
  }
}

/**
 * 挂载 PC 壳层
 * @param {{active: string}} options
 */
export function mountShell(options = {}) {
  if (typeof document === 'undefined') return;
  if (document.getElementById('app-sidebar')) return;

  const active = options.active || 'home';
  const user = readUser();

  const navHtml = NAV_ITEMS.map(
    (item) => `
      <a class="sidebar__item${item.key === active ? ' is-active' : ''}"
         href="${item.href}"
         title="${item.label}"
         ${item.key === active ? 'aria-current="page"' : ''}>
        <svg class="sidebar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          ${item.icon}
        </svg>
        <span class="sidebar__label">${item.label}</span>
        ${item.badge ? '<b class="sidebar__badge hidden" data-unread></b>' : ''}
      </a>`
  ).join('');

  const html = `
    <aside class="app-sidebar" id="app-sidebar" aria-label="侧边导航">
      <div class="sidebar__logo">
        <svg class="sidebar__logo-mark" viewBox="0 0 32 32" role="img" aria-hidden="true">
          <rect x="1" y="1" width="30" height="30" rx="9" fill="currentColor" />
          <path d="M9 11h14M9 16h9M9 21h11" stroke="#fff" stroke-width="2.4"
                stroke-linecap="round" fill="none" />
        </svg>
        <span class="sidebar__logo-text">庆师易校圈</span>
      </div>

      <nav class="sidebar__nav">${navHtml}</nav>

      <a class="sidebar__publish" href="./publish.html" title="发布物品">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
             stroke-linecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span class="sidebar__label">发布物品</span>
      </a>

      <button class="sidebar__toggle" id="sidebar-toggle" type="button"
              aria-expanded="true" aria-label="折叠侧边栏" title="折叠 / 展开">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M15 6 9 12l6 6" />
        </svg>
        <span class="sidebar__label">收起</span>
      </button>
    </aside>

    <header class="app-topbar" id="app-topbar">
      <!-- 左：侧边栏折叠 + 品牌 -->
      <div class="topbar__left">
        <button class="topbar__toggle" id="topbar-toggle" type="button"
                aria-label="折叠侧边栏" title="折叠 / 展开侧边栏">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span class="topbar__brand">庆师易校圈</span>
      </div>

      <!-- 中：全局搜索（自适应剩余宽度） -->
      <form class="topbar__search" id="topbar-search" role="search">
        <svg class="topbar__search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M16.5 16.5 21 21" />
        </svg>
        <input class="topbar__search-input" id="topbar-search-input" type="search"
               placeholder="搜索物品 / 楼栋 / 类目" autocomplete="off" aria-label="搜索物品" />
      </form>

      <!-- 右：消息 + 用户（始终贴右） -->
      <div class="topbar__right">
        <a class="topbar__bell" href="./notifications.html" title="消息中心" aria-label="消息中心">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6Z" />
            <path d="M10 19a2 2 0 0 0 4 0" />
          </svg>
          <b class="topbar__badge hidden" data-unread></b>
        </a>

        <div class="topbar__account">
          <button class="topbar__user" id="topbar-account" type="button"
                  aria-haspopup="menu" aria-expanded="false" title="账号菜单">
            <span class="topbar__avatar">${user.name.slice(0, 1)}</span>
            <span class="topbar__name">${user.name}</span>
            <svg class="topbar__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          <div class="topbar__menu hidden" id="topbar-menu" role="menu" aria-label="账号菜单">
            <button
              class="topbar__menu-item topbar__menu-item--icon"
              type="button"
              role="menuitem"
              data-action="download"
              data-download-client
            >
              <svg class="topbar__menu-icon" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="1.9" stroke-linecap="round"
                   stroke-linejoin="round" aria-hidden="true">
                <path d="M12 3v11" />
                <path d="m7 10 5 5 5-5" />
                <path d="M5 20h14" />
              </svg>
              <span>下载客户端</span>
            </button>
            <button class="topbar__menu-item" type="button" role="menuitem" data-action="switch">
              切换账号
            </button>
            <button class="topbar__menu-item topbar__menu-item--danger" type="button"
                    role="menuitem" data-action="logout">
              退出登录
            </button>
          </div>
        </div>
      </div>
    </header>
  `;

  document.body.insertAdjacentHTML('afterbegin', html);
  document.body.classList.add('has-shell');
  applyCollapsed(isCollapsed());

  /* ---- 折叠 ---- */
  const toggleCollapse = () => {
    const next = !document.body.classList.contains('is-sidebar-collapsed');
    applyCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
    } catch {
      // 忽略
    }
  };

  const topbarToggle = document.getElementById('topbar-toggle');
  if (topbarToggle) topbarToggle.addEventListener('click', toggleCollapse);

  const toggle = document.getElementById('sidebar-toggle');
  if (toggle) {
    toggle.addEventListener('click', toggleCollapse);
  }

  /* ---- 账号下拉菜单 ---- */
  bindAccountMenu();

  /* ---- 顶部搜索 ---- */
  const form = document.getElementById('topbar-search');
  const input = document.getElementById('topbar-search-input');
  if (form && input) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const keyword = input.value.trim();
      const pageSearch = document.getElementById('search-input');

      // 在首页：直接驱动页面内搜索（同步 URL 与列表）
      if (pageSearch) {
        pageSearch.value = keyword;
        pageSearch.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }

      window.location.href = `./index.html${keyword ? `?keyword=${encodeURIComponent(keyword)}` : ''}`;
    });
  }
}

/**
 * 账号下拉菜单：切换账号 / 退出登录
 * 菜单用 fixed 定位（项目禁止 absolute），位置由按钮矩形实时计算
 */
function bindAccountMenu() {
  const trigger = document.getElementById('topbar-account');
  const menu = document.getElementById('topbar-menu');
  if (!trigger || !menu) return;

  const close = () => {
    menu.classList.add('hidden');
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onOutside, true);
    document.removeEventListener('keydown', onKeydown, true);
    window.removeEventListener('resize', close);
    window.removeEventListener('scroll', close, true);
  };

  const place = () => {
    const rect = trigger.getBoundingClientRect();
    const width = 168;
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.right - width));
    menu.style.left = `${left}px`;
    menu.style.top = `${rect.bottom + 8}px`;
  };

  function onOutside(event) {
    if (menu.contains(event.target) || trigger.contains(event.target)) return;
    close();
  }

  function onKeydown(event) {
    if (event.key === 'Escape') close();
  }

  const open = () => {
    place();
    menu.classList.remove('hidden');
    trigger.setAttribute('aria-expanded', 'true');

    document.addEventListener('click', onOutside, true);
    document.addEventListener('keydown', onKeydown, true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
  };

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    if (menu.classList.contains('hidden')) open();
    else close();
  });

  menu.addEventListener('click', async (event) => {
    const item = event.target.closest('[data-action]');
    if (!item) return;

    // 下载入口由 client-entry.js 的事件委托负责弹窗，这里不做退出逻辑
    if (item.dataset.action === 'download') {
      close();
      return;
    }

    close();

    // 两种操作都先让服务端拉黑当前 Token（失败也继续本地退出）
    try {
      await request('/auth/logout', { method: 'POST' });
    } catch {
      // 网络失败不阻塞
    }

    clearToken();
    window.location.href = './login.html';
  });
}

export default mountShell;
