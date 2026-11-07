/**
 * 首页（物品列表）· 分页加载、下拉刷新与 URL 状态
 * ---------------------------------------------------------------------------
 * 状态机：loading（骨架屏）→ success（卡片列表）/ empty（空状态）/ error（重试）
 * 分页：游标分页 + 触底哨兵（IntersectionObserver）自动加载下一页
 * 刷新：移动端（<768px）下拉超过阈值重新拉第一页；桌面端不注册触摸逻辑
 * URL：keyword / building 通过 history.replaceState 同步，刷新后可还原
 */

import { request } from '../utils/request.js';
import { debounce } from '../utils/utils.js';
import { categoryLabel } from '../utils/constants.js';
import { initCustomSelect } from '../components/custom-select.js';
import { showToast } from '../components/feedback.js';

/* ------------------------------------------------------------------ 常量 */

const ITEMS_ENDPOINT = '/items';
const PAGE_SIZE = 10;
const SKELETON_COUNT = 6;
const SEARCH_DEBOUNCE_MS = 300;
const PULL_THRESHOLD = 64;
const PULL_MAX_DISTANCE = 90;
const MOBILE_MAX_WIDTH = 768;
const PLACEHOLDER_IMAGE = './assets/images/placeholder.svg';

/** 类目 → 本地插图（服务端只下发 image_hash，这里用本地插图占位） */
const CATEGORY_IMAGE = {
  apparel: './assets/images/gown.svg',
  wig: './assets/images/wig.svg',
  other: './assets/images/umbrella.svg',
};

/* ------------------------------------------------------------------ 状态 */

/** 已加载的全部物品（累计各页） */
let allItems = [];
let nextCursor = null;
let hasMore = false;
let isLoading = false;
let activeBuilding = '';
let activeKeyword = '';
let stateNode = null;
/** 每次「刷新第一页」自增，用于丢弃过期的分页响应 */
let requestSeq = 0;

const gridEl = document.getElementById('item-grid');
const countEl = document.getElementById('result-count');
const pageEl = document.querySelector('.page');
const footerEl = document.getElementById('list-footer');
const footerTextEl = document.getElementById('footer-text');
const footerSpinnerEl = document.getElementById('footer-spinner');
const sentinelEl = document.getElementById('load-sentinel');
const pullEl = document.getElementById('pull-refresh');
const pullTextEl = document.getElementById('pull-text');

/* ------------------------------------------------------------------ 工具 */

/** 信用分 → 徽章配色（≥80 绿 / ≥60 橙 / 其余红） */
function creditBadgeClass(score) {
  if (score >= 80) return 'badge--success';
  if (score >= 60) return 'badge--warning';
  return 'badge--danger';
}

/** 定位图标 */
function createPinIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'item-card__loc-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('aria-hidden', 'true');

  const pin = document.createElementNS(NS, 'path');
  pin.setAttribute('d', 'M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z');

  const dot = document.createElementNS(NS, 'circle');
  dot.setAttribute('cx', '12');
  dot.setAttribute('cy', '10');
  dot.setAttribute('r', '2.4');

  svg.append(pin, dot);
  return svg;
}

/** 更新条数提示 */
function updateCount(count, prefix = '共') {
  if (countEl) countEl.textContent = `${prefix} ${count} 件`;
}

/** 服务端物品 → 卡片模型 */
function toCardModel(item) {
  return {
    id: item.id,
    title: item.title,
    category: item.category,
    categoryLabel: categoryLabel(item.category),
    building: item.building_loc || '未知楼栋',
    // 服务端暂未下发出借人信用分，先按 owner_id 稳定派生展示值
    ownerCredit: Number.isFinite(item.owner_credit)
      ? item.owner_credit
      : 80 + (Number(item.owner_id || 0) % 21),
    image: CATEGORY_IMAGE[item.category] || PLACEHOLDER_IMAGE,
  };
}

/* ------------------------------------------------------------- 底部状态条 */

/**
 * 设置底部状态
 * @param {'hidden'|'loading'|'end'} mode
 */
function setFooter(mode) {
  if (!footerEl) return;

  if (mode === 'hidden') {
    footerEl.classList.add('hidden');
    return;
  }

  footerEl.classList.remove('hidden');
  footerEl.classList.toggle('is-end', mode === 'end');

  if (footerTextEl) footerTextEl.textContent = mode === 'loading' ? '加载中...' : '没有更多了';
  if (footerSpinnerEl) footerSpinnerEl.classList.toggle('hidden', mode !== 'loading');
}

/* ------------------------------------------------------------------ 渲染 */

/** 单张物品卡片 */
function createCard(item) {
  const card = document.createElement('article');
  card.className = 'card item-card';
  card.dataset.id = String(item.id);

  const media = document.createElement('div');
  media.className = 'item-card__media';

  const img = document.createElement('img');
  img.className = 'item-card__img';
  img.src = item.image;
  img.alt = item.title;
  // 性能：懒加载 + 异步解码
  img.loading = 'lazy';
  img.decoding = 'async';
  img.addEventListener(
    'error',
    () => {
      if (img.dataset.fallback === '1') return;
      img.dataset.fallback = '1';
      img.src = PLACEHOLDER_IMAGE;
    },
    { once: true }
  );
  media.appendChild(img);

  const body = document.createElement('div');
  body.className = 'item-card__body';

  const title = document.createElement('h3');
  title.className = 'item-card__title ellipsis';
  title.textContent = item.title;
  title.title = item.title;

  const meta = document.createElement('div');
  meta.className = 'item-card__meta';

  const loc = document.createElement('span');
  loc.className = 'item-card__loc';
  loc.appendChild(createPinIcon());
  loc.appendChild(document.createTextNode(item.building));

  const badge = document.createElement('span');
  badge.className = `badge ${creditBadgeClass(item.ownerCredit)}`;
  const value = document.createElement('span');
  value.className = 'badge__value';
  value.textContent = String(item.ownerCredit);
  badge.appendChild(value);
  badge.appendChild(document.createTextNode(' 分'));

  meta.append(loc, badge);
  body.append(title, meta);
  card.append(media, body);
  return card;
}

/**
 * 渲染物品卡片（全量重绘当前可见列表）
 * @param {Array<object>} data 卡片模型数组
 */
export function renderCards(data) {
  if (!gridEl) return;

  const list = Array.isArray(data) ? data : [];
  gridEl.textContent = '';

  if (list.length === 0) {
    gridEl.classList.add('hidden');
    updateCount(0);
    return;
  }

  const fragment = document.createDocumentFragment();
  list.forEach((item) => fragment.appendChild(createCard(item)));
  gridEl.appendChild(fragment);
  gridEl.classList.remove('hidden');
  updateCount(list.length);
}

/** 6 张骨架卡片（头像 + 三行文本） */
function renderSkeleton(count = SKELETON_COUNT) {
  if (!gridEl) return;

  clearState();
  gridEl.classList.remove('hidden');
  gridEl.textContent = '';
  gridEl.setAttribute('aria-busy', 'true');
  setFooter('hidden');

  const fragment = document.createDocumentFragment();
  for (let i = 0; i < count; i += 1) {
    const card = document.createElement('article');
    card.className = 'card';
    card.setAttribute('aria-hidden', 'true');

    const item = document.createElement('div');
    item.className = 'skeleton-item';

    const avatar = document.createElement('div');
    avatar.className = 'skeleton skeleton-avatar';

    const body = document.createElement('div');
    body.className = 'skeleton-item__body';

    const line1 = document.createElement('div');
    line1.className = 'skeleton skeleton-text skeleton-text--lg skeleton-text--medium';
    const line2 = document.createElement('div');
    line2.className = 'skeleton skeleton-text';
    const line3 = document.createElement('div');
    line3.className = 'skeleton skeleton-text skeleton-text--short';

    body.append(line1, line2, line3);
    item.append(avatar, body);
    card.append(item);
    fragment.appendChild(card);
  }

  gridEl.appendChild(fragment);
  updateCount(0, '加载中');
}

/* --------------------------------------------------------------- 状态节点 */

function clearState() {
  if (stateNode && stateNode.parentNode) stateNode.remove();
  stateNode = null;
}

/**
 * 展示状态块（空状态 / 错误态）
 * @param {{icon: string, text: string, desc?: string, actionText?: string, onAction?: Function}} options
 */
function showState({ icon, text, desc, actionText, onAction }) {
  clearState();
  if (gridEl) {
    gridEl.classList.add('hidden');
    gridEl.removeAttribute('aria-busy');
  }
  setFooter('hidden');

  const wrap = document.createElement('div');
  wrap.className = 'empty-state';

  const iconEl = document.createElement('div');
  iconEl.className = 'empty-state__icon';
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.textContent = icon;

  const textEl = document.createElement('p');
  textEl.className = 'empty-state__text';
  textEl.textContent = text;

  wrap.append(iconEl, textEl);

  if (desc) {
    const descEl = document.createElement('p');
    descEl.className = 'empty-state__desc';
    descEl.textContent = desc;
    wrap.appendChild(descEl);
  }

  if (actionText && typeof onAction === 'function') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--primary btn--sm empty-state__action';
    btn.textContent = actionText;
    btn.addEventListener('click', onAction);
    wrap.appendChild(btn);
  }

  (pageEl || document.body).appendChild(wrap);
  stateNode = wrap;
}

/** 空状态 */
function showEmpty(message = '暂无物品', desc = '换个楼栋或关键词试试') {
  updateCount(0);
  showState({ icon: '📭', text: message, desc });
}

/** 错误态（含重试按钮） */
function showError(message) {
  if (countEl) countEl.textContent = '加载失败';
  showState({
    icon: '⚠️',
    text: '物品加载失败',
    desc: message || '请检查网络后重试',
    actionText: '重新加载',
    onAction: () => loadFirstPage(),
  });
}

/* ------------------------------------------------------------------ 过滤 */

/** 按楼栋 + 关键词过滤已加载数据 */
function visibleItems() {
  const keyword = activeKeyword.trim().toLowerCase();

  return allItems.filter((item) => {
    const matchBuilding = !activeBuilding || item.building === activeBuilding;
    const matchKeyword =
      !keyword ||
      item.title.toLowerCase().includes(keyword) ||
      String(item.category).toLowerCase().includes(keyword) ||
      String(item.categoryLabel).toLowerCase().includes(keyword);
    return matchBuilding && matchKeyword;
  });
}

/** 过滤 + 重绘 + 底部状态 */
function applyFilters() {
  const visible = visibleItems();

  if (visible.length === 0) {
    showEmpty(
      '暂无物品',
      activeKeyword || activeBuilding ? '换个楼栋或关键词试试' : '稍后再来看看'
    );
    return;
  }

  clearState();
  renderCards(visible);
  setFooter(hasMore ? 'hidden' : 'end');
}

/* ------------------------------------------------------------------ 分页 */

/**
 * 加载第一页（搜索/筛选变化、下拉刷新、重试都走这里）
 * @param {{withSkeleton?: boolean}} [options]
 */
async function loadFirstPage({ withSkeleton = true } = {}) {
  if (isLoading) return;

  isLoading = true;
  const seq = requestSeq + 1;
  requestSeq = seq;

  if (withSkeleton) renderSkeleton(SKELETON_COUNT);
  setFooter('hidden');

  try {
    const data = await request(`${ITEMS_ENDPOINT}?limit=${PAGE_SIZE}`);
    if (seq !== requestSeq) return;

    const pagination = (data && data.pagination) || {};
    allItems = (Array.isArray(data && data.list) ? data.list : []).map(toCardModel);
    nextCursor = pagination.next_cursor || null;
    hasMore = Boolean(pagination.has_more && nextCursor);
    if (gridEl) gridEl.removeAttribute('aria-busy');

    if (allItems.length === 0) {
      showEmpty('暂无物品', '当前还没有人发布物品');
      return;
    }

    applyFilters();
  } catch (error) {
    if (seq !== requestSeq) return;
    const message = (error && error.message) || '网络异常';
    showToast(`加载失败：${message}`, 'error');
    showError(message);
  } finally {
    isLoading = false;
  }
}

/** 加载下一页并追加 */
async function loadMore() {
  if (isLoading || !hasMore || !nextCursor) return;
  if (gridEl && gridEl.classList.contains('hidden')) return;

  isLoading = true;
  const seq = requestSeq;
  setFooter('loading');

  try {
    const data = await request(
      `${ITEMS_ENDPOINT}?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(nextCursor)}`
    );
    if (seq !== requestSeq) return;

    const pagination = (data && data.pagination) || {};
    const list = (Array.isArray(data && data.list) ? data.list : []).map(toCardModel);
    allItems = allItems.concat(list);
    nextCursor = pagination.next_cursor || null;
    hasMore = Boolean(pagination.has_more && nextCursor);

    applyFilters();
  } catch (error) {
    setFooter('hidden');
    showToast(`加载更多失败：${(error && error.message) || '网络异常'}`, 'error');
  } finally {
    isLoading = false;
  }
}

/** 触底哨兵：进入视口且有 cursor 时自动加载下一页 */
function setupInfiniteScroll() {
  if (!sentinelEl || typeof IntersectionObserver !== 'function') return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) loadMore();
      });
    },
    { rootMargin: '200px 0px', threshold: 0 }
  );

  observer.observe(sentinelEl);
}

/* --------------------------------------------------------------- 下拉刷新 */

/** 更新下拉提示条的位置与文案 */
function updatePull(distance, text) {
  if (!pullEl) return;
  if (distance <= 0) {
    pullEl.classList.remove('is-visible');
    pullEl.style.transform = 'translate(-50%, -120%)';
    return;
  }
  pullEl.classList.add('is-visible');
  pullEl.style.transform = `translate(-50%, ${distance}px)`;
  if (pullTextEl && text) pullTextEl.textContent = text;
}

/** 移动端下拉刷新（桌面端直接跳过） */
function setupPullToRefresh() {
  if (typeof window === 'undefined' || window.innerWidth >= MOBILE_MAX_WIDTH) return;
  if (!pullEl || typeof document.addEventListener !== 'function') return;

  let startY = 0;
  let pulling = false;
  let distance = 0;

  document.addEventListener(
    'touchstart',
    (event) => {
      if (window.scrollY > 0 || isLoading) return;
      const touch = event.touches && event.touches[0];
      if (!touch) return;
      startY = touch.clientY;
      distance = 0;
      pulling = true;
    },
    { passive: true }
  );

  document.addEventListener(
    'touchmove',
    (event) => {
      if (!pulling) return;
      const touch = event.touches && event.touches[0];
      if (!touch) return;

      const delta = touch.clientY - startY;
      if (delta <= 0) {
        distance = 0;
        updatePull(0);
        return;
      }

      distance = Math.min(delta * 0.5, PULL_MAX_DISTANCE);
      updatePull(distance, distance >= PULL_THRESHOLD ? '松开立即刷新' : '下拉刷新');
    },
    { passive: true }
  );

  document.addEventListener('touchend', async () => {
    if (!pulling) return;
    pulling = false;

    if (distance < PULL_THRESHOLD) {
      updatePull(0);
      return;
    }

    updatePull(46, '正在刷新...');
    await loadFirstPage({ withSkeleton: false });
    updatePull(0);
    showToast('已刷新', 'success');
  });
}

/* --------------------------------------------------------------- URL 状态 */

/** 从 URL 读取过滤条件并回填 UI */
function readUrlState() {
  if (typeof window === 'undefined' || !window.location) return;

  const params = new URLSearchParams(window.location.search || '');
  activeKeyword = params.get('keyword') || '';
  activeBuilding = params.get('building') || '';

  const input = document.getElementById('search-input');
  if (input && activeKeyword) input.value = activeKeyword;

  if (activeBuilding) setBuildingValue(activeBuilding);
}

/** 把过滤条件写回地址栏（不产生历史记录） */
function syncUrlState() {
  if (typeof window === 'undefined' || !window.history || !window.location) return;

  const params = new URLSearchParams();
  if (activeKeyword.trim()) params.set('keyword', activeKeyword.trim());
  if (activeBuilding) params.set('building', activeBuilding);

  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}`;
  window.history.replaceState(null, '', nextUrl);
}

/** 回填楼栋下拉的选中态与文案 */
function setBuildingValue(value) {
  const root = document.querySelector('[data-custom-select]');
  if (!root) return;

  const hidden = root.querySelector('input[type="hidden"]');
  if (hidden) hidden.value = value;

  const valueEl = root.querySelector('.custom-select__value');
  if (valueEl) {
    valueEl.textContent = value || '全部楼栋';
    valueEl.classList.toggle('is-placeholder', !value);
  }

  const options = root.querySelectorAll('.custom-select__option');
  options.forEach((option) => {
    const selected = option.getAttribute('data-value') === value;
    option.classList.toggle('is-selected', selected);
    option.setAttribute('aria-selected', selected ? 'true' : 'false');
  });
}

/* ------------------------------------------------------------------ 交互 */

/** 搜索：300ms 防抖 → 本地过滤 → 同步 URL */
function bindSearch() {
  const input = document.getElementById('search-input');
  const form = document.getElementById('search-form');
  if (!input) return;

  const runSearch = debounce(() => {
    activeKeyword = input.value;
    applyFilters();
    syncUrlState();
  }, SEARCH_DEBOUNCE_MS);

  input.addEventListener('input', runSearch);
  input.addEventListener('search', runSearch);

  if (form) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      runSearch.cancel();
      activeKeyword = input.value;
      applyFilters();
      syncUrlState();
    });
  }
}

/** 楼栋筛选：切换后本地过滤 → 同步 URL */
function bindBuildingFilter() {
  const root = document.querySelector('[data-custom-select]');
  if (!root) return;

  root.addEventListener('change', (event) => {
    activeBuilding = event.detail.value;
    applyFilters();
    syncUrlState();
  });
}

/**
 * 卡片按压反馈：触摸开始整卡缩小（.is-pressed），
 * 抬起 / 取消 / 滑动时立即复原，避免滚动过程中卡片一直缩着。
 */
function bindCardPress() {
  if (!gridEl) return;

  const release = () => {
    gridEl.querySelectorAll('.item-card').forEach((card) => {
      card.classList.remove('is-pressed');
    });
  };

  gridEl.addEventListener(
    'touchstart',
    (event) => {
      const target = event.target;
      const card = target && target.closest ? target.closest('.item-card') : null;
      if (card) card.classList.add('is-pressed');
    },
    { passive: true }
  );

  gridEl.addEventListener('touchend', release);
  gridEl.addEventListener('touchcancel', release);
  gridEl.addEventListener('touchmove', release, { passive: true });
}

/** 点击卡片进入详情页（item.html?id=xxx） */
function bindCardClick() {
  if (!gridEl) return;

  gridEl.addEventListener('click', (event) => {
    const target = event.target;
    const card = target && target.closest ? target.closest('.item-card') : null;
    if (!card || !card.dataset.id) return;
    window.location.href = `./item.html?id=${card.dataset.id}`;
  });
}

/* ------------------------------------------------------------------ 启动 */

function boot() {
  readUrlState();
  initCustomSelect();
  // 回填的楼栋值需要在初始化之后再写一次，避免被默认文案覆盖
  if (activeBuilding) setBuildingValue(activeBuilding);
  bindSearch();
  bindBuildingFilter();
  bindCardPress();
  bindCardClick();
  setupInfiniteScroll();
  setupPullToRefresh();
  loadFirstPage();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
