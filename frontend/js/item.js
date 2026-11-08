/**
 * 物品详情页
 * ---------------------------------------------------------------------------
 * 流程：URL 取 id → 骨架屏 → GET /items/:id → 渲染详情 / 404 提示返回首页
 * 依赖：utils/request.js、utils/constants.js、components/feedback.js
 */

import { request, apiUrl } from '../utils/request.js';
import { debounce } from '../utils/utils.js';
import { ensureToken } from '../utils/auth.js';
import { categoryLabel } from '../utils/constants.js';
import { resolveItemImage, DEFAULT_ITEM_IMAGE } from '../utils/item-image.js';
import { getItemImages } from '../utils/item-images.js';
import { showToast, openModal, closeModal } from '../components/feedback.js';
import { openChat } from './chat.js';

/* ------------------------------------------------------------------ 常量 */

const ITEMS_ENDPOINT = '/items';

/**
 * 出借人兜底信息：/items 暂未下发出借人昵称与信用等级，
 * 且 /users/me 需要 Token（详情页是公开页，不能强制登录），
 * 因此按 owner_id 做本地兜底，待服务端补字段后自动切换真实数据。
 */
/** 信用等级 → 名称（对齐计划书 5.4.1） */
const LEVEL_NAME = {
  0: '冻结',
  1: '受限',
  2: '观察',
  3: '正常',
  4: '良好',
  5: '校园信用之星',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

const rootEl = document.getElementById('detail-root');
const backBtn = document.getElementById('back-btn');

/** 当前挂在 body 上的底部操作栏（重绘 / 错误态时需移除） */
let actionBarEl = null;
/** 当前详情上下文（聊天需要） */
let currentItem = null;
let currentOwner = null;
/** PC 端操作栏插槽 */
let detailActionsSlot = null;
/** 底部「申请借用」按钮，成功后需要改成「已申请，待交接」 */
let borrowBtnEl = null;
/** 提交中标记：防重复提交的第二道闸（第一道是 debounce leading） */
let submitting = false;

/* --------------------------------------------------------------- 本地存储 */

const USER_STORAGE_KEY = 'yxx_user';
const ORDER_STORAGE_KEY = 'yxx_orders';
/** 默认借用时长：3 天 */
const DEFAULT_LOAN_DAYS = 3;

/* ------------------------------------------------------------------ 工具 */

/** 定位图标 */
function createPinIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'detail-loc-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('aria-hidden', 'true');

  const pin = document.createElementNS(SVG_NS, 'path');
  pin.setAttribute('d', 'M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z');

  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('cx', '12');
  dot.setAttribute('cy', '10');
  dot.setAttribute('r', '2.4');

  svg.append(pin, dot);
  return svg;
}

/** 解析出借人（优先服务端字段，缺失则本地兜底） */
function resolveOwner(item) {
  if (item.owner && item.owner.nickname) {
    return {
      id: item.owner.id || item.owner_id,
      nickname: item.owner.nickname,
      level: Number(item.owner.credit_level) || 4,
    };
  }

  // 接口未返回出借人信息时的中性兜底（不含任何写死的姓名）
  return {
    id: item.owner_id,
    nickname: '校园用户',
    level: 4,
  };
}

/** 信用等级徽章配色 */
function levelBadgeClass(level) {
  if (level >= 4) return 'badge--success';
  if (level >= 2) return 'badge--warning';
  return 'badge--danger';
}

/* --------------------------------------------------------------- 骨架屏 */

/** 详情页骨架：大图块 + 标题与信息占位 */
function renderSkeleton() {
  if (!rootEl) return;
  clearActionBar();
  rootEl.textContent = '';

  const hero = document.createElement('div');
  hero.className = 'skeleton detail-skeleton__hero';
  hero.setAttribute('aria-hidden', 'true');

  const body = document.createElement('div');
  body.className = 'detail-skeleton__body';
  body.setAttribute('aria-hidden', 'true');

  const line1 = document.createElement('div');
  line1.className = 'skeleton skeleton-text skeleton-text--lg skeleton-text--medium';
  const line2 = document.createElement('div');
  line2.className = 'skeleton skeleton-text skeleton-text--short';
  const line3 = document.createElement('div');
  line3.className = 'skeleton skeleton-text';

  body.append(line1, line2, line3);
  rootEl.append(hero, body);
}

/* --------------------------------------------------------- 借用流程支撑 */

/** 读本地 JSON（容错：隐私模式下 localStorage 可能不可用） */
function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

/** 写本地 JSON */
function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 写入失败不影响主流程
  }
}

/** 当前用户（本地缓存，缺省初始化一个同学） */
function loadUser() {
  const stored = readJson(USER_STORAGE_KEY, null);
  if (stored && typeof stored === 'object') return stored;

  // 未登录/本地被清空：返回中性占位，不写死任何姓名，也不落盘伪造用户
  return {
    user_id: null,
    nickname: '校园用户',
    credit_score: 100,
    credit_available: 100,
    credit_level: 4,
  };
}

/** 从服务端同步可用信用分（借用成功后冻结分变化） */
async function syncUserFromServer() {
  const data = await request('/users/me');
  const credit = (data && data.credit) || {};
  const user = loadUser();

  const next = Object.assign({}, user, {
    credit_score: credit.score ?? user.credit_score,
    credit_available: credit.available ?? user.credit_available,
    credit_level: credit.level ?? user.credit_level,
  });

  writeJson(USER_STORAGE_KEY, next);
  return next;
}

/** 本地订单记录 */
function readOrders() {
  const list = readJson(ORDER_STORAGE_KEY, []);
  return Array.isArray(list) ? list : [];
}

/** 追加一笔订单到本地 */
function saveOrder(order) {
  const list = readOrders();
  list.unshift(order);
  writeJson(ORDER_STORAGE_KEY, list.slice(0, 50));
}

/** 该物品是否已有待交接订单 */
function hasPendingOrder(itemId) {
  return readOrders().some(
    (order) => String(order.item_id) === String(itemId) && order.state === 0
  );
}

/** 默认归还日期：今天 + 3 天，格式 YYYY-MM-DD */
function defaultDueDate() {
  const date = new Date();
  date.setDate(date.getDate() + DEFAULT_LOAN_DAYS);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 把底部按钮切成「已申请，待交接」 */
function markApplied(label = '已申请，待交接') {
  if (!borrowBtnEl) return;
  borrowBtnEl.disabled = true;
  borrowBtnEl.textContent = label;
  borrowBtnEl.dataset.applied = '1';
}

/* ------------------------------------------------------- 借用确认弹窗 */

/**
 * 打开借用确认弹窗
 * @param {object} item 详情数据
 */
function openBorrowModal(item) {
  const deposit = Number(item.deposit_score ?? 0);
  const due = defaultDueDate();

  openModal(
    '确认借用',
    `<div class="borrow-form">
      <label class="input-group">
        <span class="input-group__label">借用期限（归还日期）</span>
        <input class="input-group__control" type="date" id="due-date" value="${due}" min="${due}" />
      </label>
      <p class="borrow-tip">本次借用将冻结您 <strong class="borrow-tip__num">${deposit}</strong> 点信用分</p>
      <label class="borrow-agree">
        <input type="checkbox" id="agree-check" />
        <span>我已阅读并同意《借用协议》与《损坏赔偿条款》</span>
      </label>
      <button class="btn btn--primary btn--block" id="confirm-borrow" type="button" disabled>确认借用</button>
    </div>`
  );

  const agree = document.getElementById('agree-check');
  const confirmBtn = document.getElementById('confirm-borrow');
  const dateInput = document.getElementById('due-date');

  // 未勾选协议 → 禁止提交
  if (agree && confirmBtn) {
    agree.addEventListener('change', () => {
      confirmBtn.disabled = !agree.checked;
    });
  }

  if (confirmBtn) {
    // leading 防抖：首次点击立即执行，400ms 内的连点直接丢弃
    const submit = debounce(
      () => submitBorrow(item, dateInput ? dateInput.value : '', confirmBtn),
      400,
      { leading: true }
    );

    confirmBtn.addEventListener('click', () => {
      if (confirmBtn.disabled) return;
      submit();
    });
  }
}

/**
 * 提交借用申请
 * @param {object} item
 * @param {string} dueDate YYYY-MM-DD
 * @param {HTMLButtonElement} btn 确认按钮（用于 loading 态）
 */
async function submitBorrow(item, dueDate, btn) {
  if (submitting) return;

  const deposit = Number(item.deposit_score ?? 0);
  const user = loadUser();
  const available = Number(user.credit_available ?? 0);

  // 信用分不足：直接拦在前端，不打扰服务端
  if (available < deposit) {
    showToast('信用分不足', 'error');
    return;
  }

  submitting = true;
  const originalText = btn ? btn.textContent : '确认借用';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '提交中...';
  }

  try {
    await ensureToken();

    const body = { item_id: item.id };
    if (dueDate) body.due_at = `${dueDate}T18:00:00+08:00`;

    const data = await request('/orders/create', { method: 'POST', body });

    closeModal();
    showToast('借用申请已提交，等待交接', 'success');

    saveOrder({
      order_id: data.order_id,
      item_id: item.id,
      item_title: item.title,
      due_at: body.due_at || null,
      frozen_score: data.frozen_score,
      state: data.state,
      created_at: new Date().toISOString(),
    });

    markApplied('已申请，待交接');
    syncUserFromServer().catch(() => {
      // 同步失败不影响本次结果，下次进入详情页会重新拉取
    });
  } catch (error) {
    const code = error && error.code;
    const message = (error && error.message) || '提交失败';

    if (code === 40301) {
      showToast('信用分不足', 'error');
    } else {
      showToast(`提交失败：${message}`, 'error');
    }

    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  } finally {
    submitting = false;
  }
}

/* ------------------------------------------------------- 定损表与操作栏 */

/** 联系出借人（占位） */
function handleContact() {
  openChat({ item: currentItem, owner: currentOwner });
}

/**
 * 按钮状态：只有 status === 0（待借）才可申请借用
 * 1 已借出 / 2 下架 / 3 审核中 一律禁用
 * @param {object} item
 * @returns {{enabled: boolean, label: string}}
 */
function resolveBorrowState(item) {
  // 自己的物品不允许借用（与服务端 40902 保持一致）
  if (isOwnItem(item)) return { enabled: false, label: '自己的物品', reason: 'own' };
  if (item.status === 0) return { enabled: true, label: '申请借用' };
  if (item.status === 1) return { enabled: false, label: '已被借出' };
  return { enabled: false, label: '不可借用' };
}

/** 当前浏览者是否就是出借人 */
function isOwnItem(item) {
  const user = loadUser();
  const myId = user && user.user_id;
  if (!myId || !item) return false;
  return Number(item.owner_id) === Number(myId);
}

/** 移除已有操作栏 */
function clearActionBar() {
  if (actionBarEl && actionBarEl.parentNode) actionBarEl.remove();
  actionBarEl = null;
}

/**
 * 《损坏赔偿明细表》：只读两列表格（损坏级别 / 扣除信用分）
 * damage_rules 既支持数组，也支持 { rules: [...] } 的字典形态
 * @param {object|Array} damageRules
 * @returns {HTMLElement|null} 无规则时返回 null
 */
function renderDamageCard(damageRules) {
  const rules = Array.isArray(damageRules)
    ? damageRules
    : damageRules && Array.isArray(damageRules.rules)
      ? damageRules.rules
      : [];
  if (rules.length === 0) return null;

  const card = document.createElement('section');
  card.className = 'detail-card';

  const title = document.createElement('h2');
  title.className = 'detail-card__title';
  title.textContent = '损坏赔偿明细表';

  const table = document.createElement('table');
  table.className = 'damage-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const thLevel = document.createElement('th');
  thLevel.setAttribute('scope', 'col');
  thLevel.textContent = '损坏级别';
  const thDeduct = document.createElement('th');
  thDeduct.setAttribute('scope', 'col');
  thDeduct.textContent = '扣除信用分';
  headRow.append(thLevel, thDeduct);
  thead.appendChild(headRow);

  const tbody = document.createElement('tbody');
  rules.forEach((rule) => {
    const row = document.createElement('tr');

    const levelCell = document.createElement('td');
    levelCell.className = 'damage-table__level';
    levelCell.textContent = rule.level || '—';

    const deductCell = document.createElement('td');
    deductCell.className = 'damage-table__deduct';
    deductCell.textContent = `${rule.deduct ?? 0} 分`;

    row.append(levelCell, deductCell);
    tbody.appendChild(row);
  });

  table.append(thead, tbody);

  const note = document.createElement('p');
  note.className = 'detail-note';
  note.textContent = '借用即视为同意该赔偿条款';

  card.append(title, table, note);
  return card;
}

/**
 * 底部固定操作栏：联系Ta（次要） + 申请借用（主）
 * @param {object} item
 */
function renderActionBar(item) {
  clearActionBar();

  const bar = document.createElement('div');
  bar.className = 'action-bar';

  const inner = document.createElement('div');
  inner.className = 'action-bar__inner';

  const contactBtn = document.createElement('button');
  contactBtn.type = 'button';
  contactBtn.className = 'btn btn--secondary';
  contactBtn.textContent = '联系Ta';
  contactBtn.addEventListener('click', handleContact);

  const state = resolveBorrowState(item);
  const borrowBtn = document.createElement('button');
  borrowBtn.type = 'button';
  borrowBtn.className = 'btn btn--primary';
  borrowBtn.textContent = state.label;
  borrowBtn.disabled = !state.enabled;
  borrowBtn.addEventListener('click', () => {
    if (!state.enabled || borrowBtn.dataset.applied === '1') return;
    openBorrowModal(item);
  });

  inner.append(contactBtn, borrowBtn);
  bar.appendChild(inner);

  document.body.appendChild(bar);
  actionBarEl = bar;
  borrowBtnEl = borrowBtn;

  // 已提交过该物品 → 恢复「已申请，待交接」，避免刷新后重复下单
  if (state.enabled && hasPendingOrder(item.id)) markApplied('已申请，待交接');
}

/** 《物品简介》：旧数据没有 description 时优雅降级 */
function renderDescriptionCard(item) {
  const card = document.createElement('section');
  card.className = 'detail-card detail-desc';

  const title = document.createElement('h2');
  title.className = 'detail-card__title';
  title.textContent = '物品简介';

  const text = document.createElement('p');
  text.className = 'detail-desc__text';

  const description = typeof item.description === 'string' ? item.description.trim() : '';
  text.textContent = description || '卖家很懒，暂无简介';
  if (!description) card.classList.add('detail-desc--empty');

  card.append(title, text);
  return card;
}

/** 多图缩略图条：点击切换大图，滚动时高亮 */
function renderThumbs(images, gallery) {
  if (images.length <= 1) return null;

  const strip = document.createElement('div');
  strip.className = 'detail-thumbs';

  const buttons = images.map((src, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `detail-thumb${index === 0 ? ' is-active' : ''}`;
    btn.setAttribute('aria-label', `查看第 ${index + 1} 张图片`);

    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.loading = 'lazy';
    btn.appendChild(img);

    btn.addEventListener('click', () => {
      gallery.scrollTo({ left: gallery.clientWidth * index, behavior: 'smooth' });
    });

    strip.appendChild(btn);
    return btn;
  });

  gallery.addEventListener(
    'scroll',
    () => {
      const width = gallery.clientWidth || 1;
      const index = Math.round(gallery.scrollLeft / width);
      buttons.forEach((btn, i) => btn.classList.toggle('is-active', i === index));
    },
    { passive: true }
  );

  return strip;
}

/** 把操作栏放到 PC 右栏 / 移动端 body（fixed） */
function placeActionBar() {
  if (!actionBarEl) return;

  const isPc = window.matchMedia('(min-width: 768px)').matches;
  const target = isPc && detailActionsSlot ? detailActionsSlot : document.body;

  if (actionBarEl.parentNode !== target) target.appendChild(actionBarEl);
  actionBarEl.classList.toggle('action-bar--inline', Boolean(isPc && detailActionsSlot));
}

/* ------------------------------------------------------------------ 渲染 */

/** 渲染详情 */
function renderDetail(item) {
  if (!rootEl) return;
  rootEl.textContent = '';

  // 本地发布的图片优先；没有则回退到关键词插画
  const localImages = getItemImages(item.id);
  const images =
    localImages.length > 0
      ? localImages
      : [item.has_thumb ? apiUrl(`/items/${item.id}/thumb`) : resolveItemImage(item)];
  const owner = resolveOwner(item);
  const levelName = LEVEL_NAME[owner.level] || '良好';

  currentItem = item;
  currentOwner = owner;

  /* ---- 大图（scroll-snap 容器，当前仅一张） ---- */
  const gallery = document.createElement('div');
  gallery.className = 'detail-gallery';

  // 与列表卡片配对：共享元素转场的落点
  try {
    gallery.style.viewTransitionName = 'item-hero';
    sessionStorage.setItem('yxx_last_item', String(item.id));
  } catch {
    // 忽略
  }

  images.forEach((src) => {
    const slide = document.createElement('div');
    slide.className = 'detail-gallery__slide';

    const img = document.createElement('img');
    img.className = 'detail-gallery__img';
    img.src = src;
    img.alt = item.title;
    img.decoding = 'async';
    img.addEventListener(
      'error',
      () => {
        if (img.dataset.fallback === '1') return;
        img.dataset.fallback = '1';
        img.src = DEFAULT_ITEM_IMAGE;
      },
      { once: true }
    );

    slide.appendChild(img);
    gallery.appendChild(slide);
  });

  /* ---- 信息卡 ---- */
  const infoCard = document.createElement('section');
  infoCard.className = 'detail-card';

  const title = document.createElement('h1');
  title.className = 'detail-title';
  title.textContent = item.title;

  const meta = document.createElement('div');
  meta.className = 'detail-meta';

  const categoryTag = document.createElement('span');
  categoryTag.className = 'badge badge--outline';
  categoryTag.textContent = categoryLabel(item.category);

  const loc = document.createElement('span');
  loc.className = 'detail-loc';
  loc.appendChild(createPinIcon());
  loc.appendChild(document.createTextNode(item.building_loc || '未知楼栋'));

  meta.append(categoryTag, loc);

  const deposit = document.createElement('div');
  deposit.className = 'detail-deposit';

  const depositLabel = document.createElement('span');
  depositLabel.className = 'detail-deposit__label';
  depositLabel.textContent = '借用需冻结信用分';

  const depositBadge = document.createElement('span');
  depositBadge.className = 'badge badge--warning detail-deposit__badge';
  const depositValue = document.createElement('span');
  depositValue.className = 'badge__value';
  depositValue.textContent = String(item.deposit_score ?? 0);
  depositBadge.append(depositValue, document.createTextNode(' 分'));

  deposit.append(depositLabel, depositBadge);
  infoCard.append(title, meta, deposit);

  /* ---- 出借人卡 ---- */
  const ownerCard = document.createElement('section');
  ownerCard.className = 'detail-card';

  const ownerRow = document.createElement('div');
  ownerRow.className = 'owner';

  const avatar = document.createElement('div');
  avatar.className = 'owner__avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = owner.nickname.slice(0, 1);

  const ownerInfo = document.createElement('div');
  ownerInfo.className = 'owner__info';

  const ownerName = document.createElement('span');
  ownerName.className = 'owner__name';
  ownerName.textContent = owner.nickname;

  const ownerLevel = document.createElement('span');
  ownerLevel.className = 'owner__level';
  const levelBadge = document.createElement('span');
  levelBadge.className = `badge ${levelBadgeClass(owner.level)}`;
  levelBadge.textContent = `L${owner.level} ${levelName}`;
  ownerLevel.appendChild(levelBadge);

  ownerInfo.append(ownerName, ownerLevel);

  const contactBtn = document.createElement('button');
  contactBtn.type = 'button';
  contactBtn.className = 'btn btn--secondary btn--sm';
  contactBtn.id = 'contact-btn';
  contactBtn.textContent = '联系Ta';
  contactBtn.addEventListener('click', handleContact);

  ownerRow.append(avatar, ownerInfo, contactBtn);
  ownerCard.appendChild(ownerRow);

  /* ---- 左栏：大图 + 缩略图 ---- */
  const media = document.createElement('div');
  media.className = 'detail-media';
  media.append(gallery);

  const thumbs = renderThumbs(images, gallery);
  if (thumbs) media.appendChild(thumbs);

  /* ---- 右栏：文字信息 ---- */
  const side = document.createElement('div');
  side.className = 'detail-side';

  detailActionsSlot = document.createElement('div');
  detailActionsSlot.className = 'detail-actions';

  side.append(infoCard, renderDescriptionCard(item));
  const damageCard = renderDamageCard(item.damage_rules);
  if (damageCard) side.appendChild(damageCard);
  side.append(ownerCard, detailActionsSlot);

  rootEl.append(media, side);

  renderActionBar(item);
  placeActionBar();

  if (!window.__yxxDetailResizeBound) {
    window.__yxxDetailResizeBound = true;
    window.addEventListener('resize', () => placeActionBar());
  }
  document.title = `${item.title} · 庆师易校圈`;
}

/** 错误态：提示 + 返回首页（网络类错误额外给重试） */
function renderError(message, { withRetry = false } = {}) {
  if (!rootEl) return;
  clearActionBar();
  rootEl.textContent = '';

  const wrap = document.createElement('div');
  wrap.className = 'empty-state';

  const icon = document.createElement('div');
  icon.className = 'empty-state__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '⚠️';

  const text = document.createElement('p');
  text.className = 'empty-state__text';
  text.textContent = message;

  const desc = document.createElement('p');
  desc.className = 'empty-state__desc';
  desc.textContent = '返回首页看看其他物品';

  const actions = document.createElement('div');
  actions.className = 'flex items-center gap-2';

  const homeBtn = document.createElement('button');
  homeBtn.type = 'button';
  homeBtn.className = 'btn btn--primary btn--sm';
  homeBtn.textContent = '返回首页';
  homeBtn.addEventListener('click', () => {
    window.location.href = './index.html';
  });
  actions.appendChild(homeBtn);

  if (withRetry) {
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'btn btn--secondary btn--sm';
    retryBtn.textContent = '重试';
    retryBtn.addEventListener('click', () => load());
    actions.appendChild(retryBtn);
  }

  wrap.append(icon, text, desc, actions);
  rootEl.appendChild(wrap);
  document.title = '物品详情 · 庆师易校圈';
}

/* ------------------------------------------------------------------ 加载 */

/** 读取 URL 中的 id */
function readItemId() {
  const params = new URLSearchParams(window.location.search || '');
  return (params.get('id') || '').trim();
}

/** 拉取详情并渲染 */
async function load() {
  const rawId = readItemId();

  if (!/^\d+$/.test(rawId)) {
    renderError('链接缺少有效的物品 id');
    return;
  }

  renderSkeleton();

  try {
    const item = await request(`${ITEMS_ENDPOINT}/${rawId}`);
    renderDetail(item);
  } catch (error) {
    const code = error && error.code;
    const message = (error && error.message) || '加载失败，请稍后重试';

    if (code === 40401) {
      renderError('物品不存在或已下架');
      showToast('物品不存在或已下架', 'error');
      return;
    }

    renderError(message, { withRetry: true });
    showToast(`加载失败：${message}`, 'error');
  }
}

/* ------------------------------------------------------------------ 启动 */

function bindBack() {
  if (!backBtn) return;
  backBtn.addEventListener('click', () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = './index.html';
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      bindBack();
      load();
    },
    { once: true }
  );
} else {
  bindBack();
  load();
}
