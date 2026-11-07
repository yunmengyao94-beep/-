/**
 * 个人中心页
 * ---------------------------------------------------------------------------
 * 数据：GET /api/v1/users/me（需要 Token，未登录时由路由守卫拦截）
 * 展示：头像 / 昵称 / 掩码学号 / 学院与楼栋、环形信用分、可用分与冻结分、升级提示
 * 环形进度用 SVG viewBox 绘制，随容器缩放，任何 DPI 下都不会模糊。
 */

import { request } from '../utils/request.js';
import { ensureToken } from '../utils/auth.js';
import { formatTime } from '../utils/format.js';
import { showToast, openModal, closeModal } from '../components/feedback.js';
import { isValidRoom } from '../utils/accounts-db.js';
import { fingerprintText } from '../utils/fingerprint.js';
import { checkThrottle, markThrottle } from '../utils/rate-limit.js';

/* ------------------------------------------------------------------ 常量 */

/** 环形进度：viewBox 120×120，半径 52 → 周长 2πr */
const RING_RADIUS = 52;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** 信用等级区间（对齐计划书 5.4.1） */
const LEVELS = [
  { code: 'L0', name: '冻结', min: 0, max: 39 },
  { code: 'L1', name: '受限', min: 40, max: 59 },
  { code: 'L2', name: '观察', min: 60, max: 79 },
  { code: 'L3', name: '正常', min: 80, max: 99 },
  { code: 'L4', name: '良好', min: 100, max: 119 },
  { code: 'L5', name: '校园信用之星', min: 120, max: null },
];

const USER_STORAGE_KEY = 'yxx_user';

/* ------------------------------------------------------------------ 元素 */

const els = {
  avatar: document.getElementById('profile-avatar'),
  name: document.getElementById('profile-name'),
  no: document.getElementById('profile-no'),
  college: document.getElementById('profile-college'),
  building: document.getElementById('profile-building'),
  ringBar: document.getElementById('credit-ring-bar'),
  score: document.getElementById('credit-score'),
  available: document.getElementById('credit-available'),
  frozen: document.getElementById('credit-frozen'),
  level: document.getElementById('credit-level'),
  upgrade: document.getElementById('upgrade-hint'),
  logList: document.getElementById('log-list'),
  logEmpty: document.getElementById('log-empty'),
  logMore: document.getElementById('log-more'),
  logCount: document.getElementById('log-count'),
  aiBtn: document.getElementById('ai-upload-btn'),
  aiInput: document.getElementById('ai-file-input'),
  aiOverlay: document.getElementById('ai-overlay'),
  aiOverlayText: document.getElementById('ai-overlay-text'),
  aiPreview: document.getElementById('ai-preview'),
  aiHint: document.getElementById('ai-hint'),
  aiProgress: document.getElementById('ai-progress'),
  aiProgressText: document.getElementById('ai-progress-text'),
  aiProgressBar: document.getElementById('ai-progress-bar'),
  editBtn: document.getElementById('edit-profile'),
};

/** 流水首屏渲染条数 */
const LOG_PAGE_SIZE = 10;

/** 全部流水 / 已渲染条数 */
let allLogs = [];
let renderedLogs = 0;

/** 当前用户数据（含信用分与流水），供本地加分后就地更新 */
let profileState = null;
/** OCR 进行中标记，避免重复触发 */
let ocrBusy = false;
/** 预览图令牌：作废过期的 FileReader 回调 */
let previewToken = 0;
/** 最近一次识别的截图 dataURL 与内容指纹（奖励接口需要） */
let previewDataUrl = '';
let recognizedHash = '';

/* ------------------------------------------------------------------ 工具 */

/** 分数 → 等级对象 */
function levelOf(score) {
  const value = Number(score) || 0;
  const hit = LEVELS.find(
    (level) => value >= level.min && (level.max === null || value <= level.max)
  );
  return hit || LEVELS[0];
}

/** 读取当前登录账号（姓名 / 学号 / 学院 / 楼栋 / 宿舍） */
function readAccount() {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return null;
    const user = JSON.parse(raw);
    if (!user) return null;

    return {
      name: user.nickname || user.real_name || '',
      studentNo: user.student_no || '',
      college: user.college_code || '',
      building: user.building_loc || '',
      room: user.room_no || '',
    };
  } catch {
    return null;
  }
}

/**
 * 环形进度：按当前等级区间内的完成度绘制
 * @param {number} score 当前分数
 */
function renderRing(score) {
  const value = Number(score) || 0;
  const level = levelOf(value);

  let progress = 1;
  if (level.max !== null) {
    const span = level.max + 1 - level.min;
    progress = Math.min(1, Math.max(0, (value - level.min + 1) / span));
  }

  if (els.ringBar) {
    els.ringBar.style.strokeDasharray = String(RING_CIRCUMFERENCE);
    els.ringBar.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - progress));
  }

  if (els.score) els.score.textContent = String(value);
}

/** 等级徽章 + 升级提示 */
function renderLevel(score) {
  const value = Number(score) || 0;
  const level = levelOf(value);

  if (els.level) {
    els.level.textContent = `${level.code} ${level.name}`;
    els.level.className = `level-chip level-chip--${level.code.toLowerCase()}`;
  }

  if (!els.upgrade) return;

  const index = LEVELS.indexOf(level);
  const next = LEVELS[index + 1];

  if (!next) {
    els.upgrade.textContent = '已达最高信用等级';
    return;
  }

  const gap = Math.max(0, next.min - value);
  els.upgrade.textContent = `距离升级至 ${next.code} 还差 ${gap} 分`;
}

/** 用接口数据填充页面 */
function renderProfile(data) {
  const user = data || {};
  const credit = user.credit || {};
  const score = Number(credit.score) || 0;

  // 记住一份可变状态：认证加分后在本地更新
  profileState = {
    credit: {
      score,
      frozen: Number(credit.frozen) || 0,
      available: Number(credit.available) || 0,
    },
  };

  // 账号信息一律取自当前登录账号（本地账号库 → 登录时写入 yxx_user）
  const account = readAccount();
  const nickname = (account && account.name) || user.real_name || '同学';
  const studentNo = (account && account.studentNo) || user.student_no || '';
  const college = (account && account.college) || user.college_code || '';
  const building = (account && account.building) || user.building_loc || '';
  const room = (account && account.room) || '';

  if (els.avatar) els.avatar.textContent = nickname.slice(0, 1);
  if (els.name) els.name.textContent = nickname;
  if (els.no) els.no.textContent = studentNo || '——';
  if (els.college) els.college.textContent = college ? `学院 ${college}` : '未填写学院';
  if (els.building) {
    els.building.textContent = building ? `${building}${room ? ` ${room}` : ''}` : '未填写楼栋';
  }

  if (els.available) els.available.textContent = String(credit.available ?? 0);
  if (els.frozen) els.frozen.textContent = String(credit.frozen ?? 0);

  renderRing(score);
  renderLevel(score);
  renderLogs(user.credit_logs);

  document.title = `${nickname} · 易校圈`;
}

/* ------------------------------------------------------------ 信用流水 */

/** 进度条之后：渲染流水列表（首屏 10 条 + 加载更多） */

/** 追加若干条流水到列表 */
function appendLogs(count) {
  if (!els.logList) return;

  const next = allLogs.slice(renderedLogs, renderedLogs + count);
  const fragment = document.createDocumentFragment();
  next.forEach((log) => fragment.appendChild(createLogItem(log)));
  els.logList.appendChild(fragment);

  renderedLogs += next.length;
  updateMoreButton();
}

/** 刷新「加载更多」按钮状态 */
function updateMoreButton() {
  if (!els.logMore) return;

  const rest = allLogs.length - renderedLogs;
  const hasMore = rest > 0;

  els.logMore.classList.toggle('hidden', !hasMore);
  if (hasMore) els.logMore.textContent = `加载更多（还有 ${rest} 条）`;
}

/** 单条流水 */
function createLogItem(log) {
  const item = document.createElement('li');
  item.className = 'log-item';

  const main = document.createElement('div');
  main.className = 'log-item__main';

  const reason = document.createElement('span');
  reason.className = 'log-item__reason';

  const reasonText = document.createElement('span');
  reasonText.textContent = log.reason || '信用变动';
  reason.appendChild(reasonText);

  // 冻结 / 解冻的 delta 恒为 0，加一个小标签说明原因
  if (log.change_type === 'freeze' || log.change_type === 'unfreeze') {
    const tag = document.createElement('span');
    tag.className = 'log-item__tag';
    tag.textContent = log.change_type === 'freeze' ? '冻结' : '解冻';
    reason.appendChild(tag);
  }

  const time = document.createElement('span');
  time.className = 'log-item__time';
  time.textContent = formatTime(log.created_at) || '—';

  main.append(reason, time);

  const side = document.createElement('div');
  side.className = 'log-item__side';

  const delta = Number(log.delta) || 0;
  const deltaEl = document.createElement('span');
  if (delta > 0) {
    deltaEl.className = 'log-item__delta log-item__delta--plus';
    deltaEl.textContent = `+${delta}`;
  } else if (delta < 0) {
    deltaEl.className = 'log-item__delta log-item__delta--minus';
    deltaEl.textContent = String(delta);
  } else {
    deltaEl.className = 'log-item__delta log-item__delta--zero';
    deltaEl.textContent = '0';
  }

  const balance = document.createElement('span');
  balance.className = 'log-item__balance';
  balance.textContent = `余额 ${log.balance_after ?? 0}`;

  side.append(deltaEl, balance);
  item.append(main, side);
  return item;
}

/** 空状态 */
function renderLogEmpty() {
  if (!els.logEmpty) return;

  els.logEmpty.textContent = '';
  els.logEmpty.classList.remove('hidden');

  const wrap = document.createElement('div');
  wrap.className = 'empty-state';

  const icon = document.createElement('div');
  icon.className = 'empty-state__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '📭';

  const text = document.createElement('p');
  text.className = 'empty-state__text';
  text.textContent = '暂无信用记录';

  const desc = document.createElement('p');
  desc.className = 'empty-state__desc';
  desc.textContent = '完成一次借用或归还后，这里会出现记录';

  wrap.append(icon, text, desc);
  els.logEmpty.appendChild(wrap);
}

/**
 * 渲染信用流水
 * @param {Array<object>} logs
 */
function renderLogs(logs) {
  allLogs = Array.isArray(logs) ? logs : [];
  renderedLogs = 0;

  if (els.logList) {
    els.logList.textContent = '';
    els.logList.classList.toggle('hidden', allLogs.length === 0);
  }
  if (els.logEmpty) {
    els.logEmpty.textContent = '';
    els.logEmpty.classList.add('hidden');
  }
  if (els.logCount) els.logCount.textContent = `共 ${allLogs.length} 条`;

  if (allLogs.length === 0) {
    renderLogEmpty();
    if (els.logMore) els.logMore.classList.add('hidden');
    return;
  }

  appendLogs(LOG_PAGE_SIZE);
}

/* --------------------------------------------------------- 编辑个人资料 */

/** HTML 属性转义（只用于 value="..." 场景） */
function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 打开资料编辑弹窗（转专业 / 换宿舍） */
function openProfileEditor() {
  const account = readAccount() || {};
  const buildings = Array.from({ length: 11 }, (_, i) => `第${i + 1}公寓`);
  const options = buildings
    .map(
      (name) =>
        `<option value="${name}"${name === account.building ? ' selected' : ''}>${name}</option>`
    )
    .join('');

  const html = [
    '<div class="profile-form">',
    '<label class="input-group__label" for="edit-college">学院代码</label>',
    `<input class="input-group__control" id="edit-college" maxlength="10" placeholder="如 0801" value="${escapeAttr(account.college)}" />`,
    '<label class="input-group__label" for="edit-building">所在公寓</label>',
    `<select class="input-group__control" id="edit-building"><option value="">请选择公寓</option>${options}</select>`,
    '<label class="input-group__label" for="edit-room">房间号</label>',
    `<input class="input-group__control" id="edit-room" maxlength="3" inputmode="numeric" placeholder="3 位数字，如 502" value="${escapeAttr(account.room)}" />`,
    '<p class="field-error hidden" id="edit-error"></p>',
    '<div class="ai-modal__actions">',
    '<button class="btn btn--secondary" id="edit-cancel" type="button">取消</button>',
    '<button class="btn btn--primary" id="edit-save" type="button">保存</button>',
    '</div>',
    '</div>',
  ].join('');

  const mask = openModal('编辑资料', html);
  if (!mask) return;

  const collegeInput = mask.querySelector('#edit-college');
  const buildingSelect = mask.querySelector('#edit-building');
  const roomInput = mask.querySelector('#edit-room');
  const errorNode = mask.querySelector('#edit-error');
  const cancelBtn = mask.querySelector('#edit-cancel');
  const saveBtn = mask.querySelector('#edit-save');

  const setError = (message) => {
    if (!errorNode) return;
    errorNode.textContent = message || '';
    errorNode.classList.toggle('hidden', !message);
  };

  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const college = collegeInput ? collegeInput.value.trim() : '';
      const building = buildingSelect ? buildingSelect.value : '';
      const room = roomInput ? roomInput.value.trim() : '';

      if (!college) return setError('请填写学院代码');
      if (!building) return setError('请选择所在公寓');
      if (!isValidRoom(room)) return setError('房间号需为 3 位数字');

      saveBtn.disabled = true;
      saveBtn.textContent = '保存中...';

      // 1) 先落本地（离线也能生效）
      persistProfile({ college, building, room });

      // 2) 再同步服务端（失败不阻塞本地生效）
      let synced = true;
      try {
        await request('/users/me', {
          method: 'PATCH',
          body: { college_code: college, building_loc: building, room_no: room },
        });
      } catch {
        synced = false;
      }

      closeModal();
      renderAccountInfo();
      showToast(synced ? '资料已更新' : '资料已保存到本机（网络异常，稍后自动同步）', 'success');
    });
  }
}

/** 写入本地账号信息 */
function persistProfile({ college, building, room }) {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    const user = raw ? JSON.parse(raw) : {};
    user.college_code = college;
    user.building_loc = building;
    user.room_no = room;
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  } catch {
    // 存储不可用时忽略（页面仍会即时更新）
  }
}

/** 即时刷新用户信息区 */
function renderAccountInfo() {
  const account = readAccount() || {};
  const nickname = account.name || '同学';

  if (els.avatar) els.avatar.textContent = nickname.slice(0, 1);
  if (els.name) els.name.textContent = nickname;
  if (els.no) els.no.textContent = account.studentNo || '——';
  if (els.college)
    els.college.textContent = account.college ? `学院 ${account.college}` : '未填写学院';
  if (els.building) {
    els.building.textContent = account.building
      ? `${account.building}${account.room ? ` ${account.room}` : ''}`
      : '未填写楼栋';
  }
}

/* ------------------------------------------------------------------ 加载 */

async function loadProfile() {
  try {
    await ensureToken();
    const data = await request('/users/me');
    renderProfile(data);
  } catch (error) {
    const message = (error && error.message) || '加载失败';
    showToast(`加载失败：${message}`, 'error');

    if (els.name) els.name.textContent = '加载失败';
    if (els.upgrade) els.upgrade.textContent = '下拉或刷新重试';
  }
}

function init() {
  // 加载更多：一次追加剩余全部流水
  if (els.logMore) {
    els.logMore.addEventListener('click', () => appendLogs(allLogs.length - renderedLogs));
  }
  bindAiCertification();

  if (els.editBtn) {
    els.editBtn.addEventListener('click', openProfileEditor);
  }

  loadProfile();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

/* --------------------------------------------------- AI 信用认证（OCR） */

/** Tesseract.js：本地优先（HTML 里的 script 已尝试），缺失时临时走 CDN 兜底 */
const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
/** 识别语言：中文 + 英文（数字、符号） */
const OCR_LANGS = ['chi_sim', 'eng'];

/** 单例 Worker 与加载中的 Promise（避免重复初始化） */
let ocrWorker = null;
let tesseractLoading = null;
/** 识别进度回调：初始化时传给 Tesseract 的 logger */
let progressHandler = null;

/** 确保 window.Tesseract 可用（本地脚本未就绪时才去加载 CDN） */
function ensureTesseract() {
  if (typeof window !== 'undefined' && window.Tesseract) return Promise.resolve(window.Tesseract);
  if (tesseractLoading) return tesseractLoading;

  const loadScript = (src) =>
    new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () =>
        window.Tesseract ? resolve(window.Tesseract) : reject(new Error('Tesseract 未正确挂载'));
      script.onerror = () => reject(new Error(`脚本加载失败：${src}`));
      (document.head || document.body).appendChild(script);
    });

  tesseractLoading = loadScript(TESSERACT_CDN)
    .then((lib) => {
      tesseractLoading = null;
      return lib;
    })
    .catch((error) => {
      tesseractLoading = null;
      throw error;
    });

  return tesseractLoading;
}

/** 本地资源路径（由 scripts/fetch-ai-assets.mjs 下载到 frontend/assets/ai/） */
const OCR_LOCAL_PATHS = {
  workerPath: './assets/ai/worker.min.js',
  langPath: './assets/ai',
  corePath: './assets/ai',
};

/**
 * CDN 兜底：不传任何路径即使用 tesseract.js 默认源
 * （jsDelivr 上的 worker/core + @tesseract.js-data 的语言包）
 */
const OCR_CDN_PATHS = {};

/**
 * 初始化 OCR 引擎：优先本地资源，失败自动回退 CDN
 * @returns {Promise<object>} Tesseract Worker
 */
export async function initOCR() {
  if (ocrWorker) return ocrWorker;

  const Tesseract = await ensureTesseract();

  const create = (paths) =>
    Tesseract.createWorker(OCR_LANGS, 1, {
      ...paths,
      cacheMethod: 'none',
      logger: (message) => {
        if (typeof progressHandler === 'function') progressHandler(message);
      },
    });

  try {
    // 本地资源存在时完全离线，速度也更快
    ocrWorker = await create(OCR_LOCAL_PATHS);
  } catch {
    // 本地缺失/损坏（例如未执行 fetch 脚本）：回退 CDN，保证点击不报错
    ocrWorker = await create(OCR_CDN_PATHS);
  }
  return ocrWorker;
}

/** 释放 Worker（识别结束后必须调用，避免内存泄漏） */
async function releaseOCR() {
  if (!ocrWorker) return;

  const worker = ocrWorker;
  ocrWorker = null;
  progressHandler = null;

  try {
    if (typeof worker.terminate === 'function') await worker.terminate();
  } catch {
    // 释放失败不影响主流程
  }
}

/**
 * 从 OCR 文本中提取芝麻信用分
 * 规则：优先匹配「芝麻分 / 芝麻信用 / 信用分」后紧跟的数字，再兜底全文 350–950 的三位数
 * @param {string} text
 * @returns {number|null}
 */
export function extractZhimaScore(text) {
  const source = String(text || '').replace(/\s+/g, ' ');

  const labeled = [
    /芝麻信用分[^\d]{0,10}(\d{2,4})/,
    /芝麻分[^\d]{0,10}(\d{2,4})/,
    /芝麻信用[^\d]{0,10}(\d{2,4})/,
    /信用分[^\d]{0,10}(\d{2,4})/,
  ];

  for (const pattern of labeled) {
    const match = source.match(pattern);
    if (!match) continue;
    const value = Number(match[1]);
    if (value >= 350 && value <= 950) return value;
  }

  // 兜底：全文扫描三位数，取落在合法区间内的最大值
  const candidates = (source.match(/\d{3}/g) || [])
    .map(Number)
    .filter((value) => value >= 350 && value <= 950);

  return candidates.length ? Math.max(...candidates) : null;
}

/* ------------------------------------------------- AI 认证 UI 交互 */

/** 显示全屏加载遮罩 */
function showAiOverlay(text) {
  if (!els.aiOverlay) return;
  if (els.aiOverlayText && text) els.aiOverlayText.textContent = text;
  els.aiOverlay.classList.remove('hidden');
}

/** 隐藏全屏加载遮罩 */
function hideAiOverlay() {
  if (els.aiOverlay) els.aiOverlay.classList.add('hidden');
}

/** 更新识别进度 */
function updateAiProgress(percent) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));

  if (els.aiProgressText) els.aiProgressText.textContent = `识别中: ${value}%`;
  if (els.aiProgressBar) els.aiProgressBar.style.width = `${value}%`;
  if (els.aiProgress) els.aiProgress.classList.remove('hidden');
}

/** 隐藏识别进度 */
function hideAiProgress() {
  if (els.aiProgress) els.aiProgress.classList.add('hidden');
  if (els.aiProgressBar) els.aiProgressBar.style.width = '0%';
  if (els.aiProgressText) els.aiProgressText.textContent = '识别中: 0%';
}

/** 在模块内展示所选截图 */
function showAiPreview(file) {
  if (!els.aiPreview) return;

  // 每次展示递增，用于丢弃被 clearAiState 作废的异步回调
  previewToken += 1;
  const token = previewToken;

  const reader = new FileReader();
  reader.onload = () => {
    if (token !== previewToken) return;

    els.aiPreview.textContent = '';

    previewDataUrl = String(reader.result || '');
    recognizedHash = '';

    const img = document.createElement('img');
    img.className = 'ai-preview__img';
    img.src = previewDataUrl;
    img.alt = '芝麻信用截图';

    els.aiPreview.appendChild(img);
    els.aiPreview.classList.remove('hidden');
    if (els.aiHint) els.aiHint.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

/**
 * 选中截图后的完整流程：
 *   初始化遮罩 → 初始化引擎 → 隐藏遮罩 → 页面内进度条识别 → 正则提取 → 成功弹窗 / 失败提示
 *   结束后释放 Worker
 * @param {File} file
 */
async function handleAiScreenshot(file) {
  if (!file) return;

  if (!String(file.type || '').startsWith('image/')) {
    showToast('请选择图片文件', 'error');
    return;
  }

  if (ocrBusy) return;
  ocrBusy = true;

  showAiPreview(file);
  showAiOverlay('AI 引擎初始化中，请稍候...');

  try {
    const worker = await initOCR();
    hideAiOverlay();

    // 进度：Tesseract 通过 logger 回报 { status, progress }
    updateAiProgress(0);
    progressHandler = (message) => {
      if (!message || message.status !== 'recognizing text') return;
      updateAiProgress((message.progress || 0) * 100);
    };

    const result = await worker.recognize(file);
    const text = (result && result.data && result.data.text) || '';

    hideAiProgress();
    const score = extractZhimaScore(text);

    if (score === null) {
      // 失败：提示并清空状态
      clearAiState();
      showToast('未识别到有效信用分，请确认截图为支付宝芝麻信用页面', 'error');
      return;
    }

    // 识别成功：对本次截图取内容指纹，奖励接口必须携带（防直接 curl）
    try {
      recognizedHash = await fingerprintText(previewDataUrl);
    } catch {
      recognizedHash = '';
    }

    openScoreModal(score);
  } catch (error) {
    hideAiOverlay();
    hideAiProgress();
    clearAiState();
    showToast(`识别失败：${error.message}`, 'error');
  } finally {
    ocrBusy = false;
    await releaseOCR();
  }
}

/** 清空认证相关状态（预览、进度） */
function clearAiState() {
  previewToken += 1;
  hideAiProgress();
  if (els.aiPreview) {
    els.aiPreview.textContent = '';
    els.aiPreview.classList.add('hidden');
  }
  if (els.aiHint) els.aiHint.classList.add('hidden');
}

/**
 * 识别成功弹窗：确认后发放奖励
 * @param {number} score 识别到的芝麻分
 */
function openScoreModal(score) {
  const body = [
    `<p class="ai-modal__text">识别成功！您的芝麻信用分为 <span class="ai-modal__score">${score}</span> 分，确认绑定吗？</p>`,
    '<div class="ai-modal__actions">',
    '<button class="btn btn--secondary" id="ai-cancel" type="button">取消</button>',
    '<button class="btn btn--primary" id="ai-confirm" type="button">确认绑定</button>',
    '</div>',
  ].join('');

  const mask = openModal('信用认证', body);
  if (!mask) return;

  const cancelBtn = mask.querySelector('#ai-cancel');
  const confirmBtn = mask.querySelector('#ai-confirm');

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      closeModal();
      clearAiState();
    });
  }

  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      closeModal();
      grantCreditBonus(10);
    });
  }
}

/**
 * 发放信用奖励：本地即时生效 + 插入流水 + 持久化
 * @param {number} points 加分数
 * @param {string} reason 流水事由
 */
async function grantCreditBonus(points) {
  if (!profileState) {
    showToast('用户数据未就绪，请稍后重试', 'error');
    return;
  }

  // 前端限流：同一设备 60 秒一次（服务端还有一层）
  const gate = checkThrottle('credit-bonus');
  if (!gate.allowed) {
    clearAiState();
    showToast(`操作过于频繁，请 ${gate.waitSeconds} 秒后再试`, 'error');
    return;
  }

  try {
    // 先换取一次性挑战，再携带截图指纹提交，服务端校验后才加分
    const challengeRes = await request('/users/credit/challenge', { method: 'POST' });
    const challenge = challengeRes && challengeRes.challenge;

    const data = await request('/users/credit/bonus', {
      method: 'POST',
      body: {
        source: 'ai_cert',
        image_hash: recognizedHash || '00000000',
        challenge,
      },
    });

    markThrottle('credit-bonus');

    clearAiState();
    showToast(`认证成功，信用分 +${(data && data.bonus) || points}`, 'success');

    // 重新拉取个人中心数据（信用分 + 流水都以服务端为准）
    await loadProfile();
  } catch (error) {
    clearAiState();
    showToast((error && error.message) || '认证奖励发放失败，请稍后重试', 'error');
  }
}

/** 绑定「上传截图认证」按钮与隐藏的 file input */
function bindAiCertification() {
  if (els.aiBtn && els.aiInput) {
    els.aiBtn.addEventListener('click', () => els.aiInput.click());
  }

  if (els.aiInput) {
    els.aiInput.addEventListener('change', () => {
      const file = els.aiInput.files && els.aiInput.files[0];
      els.aiInput.value = '';
      handleAiScreenshot(file);
    });
  }
}
