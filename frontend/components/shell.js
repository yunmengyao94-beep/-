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
        <span class="sidebar__logo-text">易校圈</span>
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
        <span class="topbar__brand">易校圈</span>
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

        <a class="topbar__user" href="./profile.html" title="个人中心">
          <span class="topbar__avatar">${user.name.slice(0, 1)}</span>
          <span class="topbar__name">${user.name}</span>
        </a>
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

export default mountShell;
