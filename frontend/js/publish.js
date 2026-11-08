/**
 * 发布物品页
 * ---------------------------------------------------------------------------
 * Batch 1：页面结构 + 图片选择 / 拖拽 / 预览 / 删除
 * Batch 2：动态定损表（随高值开关显隐、可增删行）+ Canvas 压缩为 WebP(512px, 0.7)
 *          并在缩略图旁展示压缩前后体积对比
 * 发布提交在后续批次接入。
 */

import { initCustomSelect } from '../components/custom-select.js';
import { showToast } from '../components/feedback.js';
import { ensureToken } from '../utils/auth.js';
import { request } from '../utils/request.js';
import { saveItemImages } from '../utils/item-images.js';
import {
  getPublishLock,
  recordSensitiveHit,
  clearSensitiveHits,
  MAX_HITS,
} from '../utils/publish-guard.js';

/* ------------------------------------------------------------------ 常量 */

/** 单次最多上传张数 */
const MAX_IMAGES = 9;
/** 压缩后最长边（px） */
const MAX_EDGE = 512;
/** WebP 质量 */
const WEBP_QUALITY = 0.7;
/** 定损表最少保留行数 */
const MIN_DAMAGE_ROWS = 1;
/** 提交按钮最短 Loading 时长（配合 300ms 网络延迟，视觉上约 1 秒） */
const SUBMIT_MIN_MS = 1000;
/** 楼栋取值：优先当前账号的楼栋，未知则留空要求用户选择 */
const DEFAULT_BUILDING = '';

/** 已选图片：{ id, name, dataUrl, originalBytes, compressedBytes } */
const selectedImages = [];
let imageSeq = 0;
let damageSeq = 0;

const backBtn = document.getElementById('back-btn');
const formEl = document.getElementById('publish-form');
const areaEl = document.getElementById('upload-area');
const inputEl = document.getElementById('upload-input');
const thumbsEl = document.getElementById('upload-thumbs');
const countEl = document.getElementById('upload-count');
const highSwitch = document.getElementById('field-high-value');
const damageSection = document.getElementById('damage-section');
const damageRowsEl = document.getElementById('damage-rows');
const addRowBtn = document.getElementById('add-damage-row');
const publishBtn = document.getElementById('publish-btn');
const titleInput = document.getElementById('field-title');
const descInput = document.getElementById('field-description');
const descCount = document.getElementById('desc-count');
const depositInput = document.getElementById('field-deposit');
const buildingSelect = document.getElementById('field-building');
const categoryRoot = document.querySelector('[data-custom-select]');
const categoryValueEl = categoryRoot ? categoryRoot.querySelector('input[type="hidden"]') : null;

/** 字段 → 错误提示节点 */
const ERROR_NODES = {
  title: document.getElementById('err-title'),
  category: document.getElementById('err-category'),
  deposit: document.getElementById('err-deposit'),
  image: document.getElementById('err-image'),
  building: document.getElementById('err-building'),
  damage: document.getElementById('err-damage'),
};

/** 提交状态 */
let submitting = false;
let submitted = false;

/* ------------------------------------------------------------------ 工具 */

/** 字节数 → 人类可读（B / KB / MB） */
function formatSize(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

/** dataURL 的真实字节数（base64 解码后的长度） */
function base64Bytes(dataUrl) {
  const base64 = String(dataUrl).split(',')[1] || '';
  const padding = (base64.match(/=+$/) || [''])[0].length;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/** 用 <img> 解码（绝大多数格式走这条路） */
function loadViaImageElement(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片解析失败'));
    };
    img.src = url;
  });
}

/**
 * 解码图片：<img> 失败时尝试 createImageBitmap
 * （部分浏览器对 HEIC/HEIF 或超大图只在 ImageBitmap 路径下可用）
 */
async function loadImage(file) {
  try {
    return await loadViaImageElement(file);
  } catch (error) {
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(file);
        return bitmap;
      } catch {
        // 继续抛出原始错误
      }
    }
    throw error;
  }
}

/**
 * 是否为 HEIC / HEIF（iOS 默认拍照格式）
 *
 * 【降级方案】浏览器没有原生 HEIC 解码能力，纯前端无法转码：
 *   · 首选：iOS 通过 <input type="file"> 选择照片时，系统通常自动转成 JPEG（无需处理）
 *   · 兜底：<img> 失败 → createImageBitmap 再试 → 仍失败给出明确文案，引导转 JPG/截图
 *   · 彻底解决需服务端引入 sharp / libheif 做转码（本地演示版不引入原生依赖）
 */
function isHeicFile(file) {
  const name = String((file && file.name) || '');
  const type = String((file && file.type) || '');
  return /\.heic$/i.test(name) || /\.heif$/i.test(name) || /heic|heif/i.test(type);
}

/**
 * Canvas 等比压缩：最长边限制 512px，输出 WebP(0.7)
 * @param {File} file
 * @returns {Promise<{dataUrl: string, width: number, height: number}>}
 */
async function compressImage(file) {
  const img = await loadImage(file);
  const longest = Math.max(img.width || 0, img.height || 0) || MAX_EDGE;
  const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1;

  const width = Math.max(1, Math.round((img.width || MAX_EDGE) * scale));
  const height = Math.max(1, Math.round((img.height || MAX_EDGE) * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);

  return { dataUrl: canvas.toDataURL('image/webp', WEBP_QUALITY), width, height };
}

/* ------------------------------------------------------------------ 预览 */

/** 更新张数提示 */
function updateCount() {
  if (!countEl) return;

  const total = selectedImages.reduce((sum, item) => sum + (item.compressedBytes || 0), 0);
  const suffix = selectedImages.length ? ` · 压缩后共 ${formatSize(total)}` : '';
  countEl.textContent = `已选 ${selectedImages.length} 张（最多 ${MAX_IMAGES} 张）${suffix}`;
}

/** 追加一张缩略图（图片与删除按钮叠放在同一网格单元，下方显示体积对比） */
function appendThumb(item) {
  if (!thumbsEl) return;

  const thumb = document.createElement('figure');
  thumb.className = 'upload-thumb';
  thumb.dataset.id = String(item.id);

  const media = document.createElement('div');
  media.className = 'upload-thumb__media';

  const img = document.createElement('img');
  img.className = 'upload-thumb__img';
  img.src = item.dataUrl;
  img.alt = item.name || '物品图片';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'upload-thumb__remove';
  removeBtn.setAttribute('aria-label', `删除 ${item.name || '该图片'}`);
  removeBtn.textContent = '×';
  removeBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    removeImage(item.id);
  });

  media.append(img, removeBtn);

  const meta = document.createElement('figcaption');
  meta.className = 'upload-thumb__meta';
  meta.textContent = `${formatSize(item.originalBytes)} → `;
  const compressed = document.createElement('span');
  compressed.className = 'upload-thumb__size';
  compressed.textContent = formatSize(item.compressedBytes);
  meta.appendChild(compressed);

  thumb.append(media, meta);
  thumbsEl.appendChild(thumb);
}

/** 删除一张图片 */
function removeImage(id) {
  const index = selectedImages.findIndex((item) => item.id === id);
  if (index === -1) return;

  selectedImages.splice(index, 1);

  if (thumbsEl) {
    const node = Array.from(thumbsEl.children).find((el) => el.dataset.id === String(id));
    if (node && node.parentNode) node.remove();
  }

  applyAccountBuilding();
  updateCount();
  applyPublishLock();
}

/**
 * 读取 → 压缩 → 预览
 * @param {FileList|File[]} fileList
 */
async function addFiles(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return;

  const images = files.filter((file) => String(file.type || '').startsWith('image/'));
  if (images.length < files.length) {
    showToast('已忽略非图片文件', 'error');
  }

  let overflow = false;

  for (const file of images) {
    if (selectedImages.length >= MAX_IMAGES) {
      overflow = true;
      break;
    }

    imageSeq += 1;
    const id = imageSeq;

    try {
      const compressed = await compressImage(file);
      const item = {
        id,
        name: file.name,
        dataUrl: compressed.dataUrl,
        originalBytes: file.size || 0,
        compressedBytes: base64Bytes(compressed.dataUrl),
      };

      selectedImages.push(item);
      appendThumb(item);
      updateCount();
    } catch (error) {
      if (isHeicFile(file)) {
        showToast('不支持 HEIC 格式，请在相册里转为 JPG（或直接截图）后重试', 'error');
      } else {
        showToast(`「${file.name}」压缩失败：${error.message}`, 'error');
      }
    }
  }

  if (overflow) showToast(`最多上传 ${MAX_IMAGES} 张图片`, 'error');
}

/**
 * 计算图片内容指纹（SHA-256 前 16 字节；不安全环境降级为 FNV-1a）
 * 用途：作为 image_hash 随发布请求上报，便于服务端识别"同一张图"
 * @param {string} dataUrl
 * @returns {Promise<string>}
 */
async function fingerprintOf(dataUrl) {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const bytes = new TextEncoder().encode(dataUrl);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest))
        .slice(0, 16)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    // 降级到下面的简易哈希
  }

  let hash = 2166136261;
  for (let i = 0; i < dataUrl.length; i += 1) {
    hash ^= dataUrl.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** 锁定倒计时定时器 */
let lockTimer = null;

/** 应用「敏感词连击锁」：禁用按钮并显示剩余时间 */
function applyPublishLock() {
  const lock = getPublishLock();

  if (!lock.locked) {
    if (lockTimer) {
      clearInterval(lockTimer);
      lockTimer = null;
    }
    if (publishBtn) {
      publishBtn.disabled = false;
      publishBtn.textContent = '发布';
    }
    return;
  }

  if (!publishBtn) return;

  publishBtn.disabled = true;
  const tick = () => {
    const current = getPublishLock();
    if (!current.locked) {
      applyPublishLock();
      return;
    }
    const minutes = Math.floor(current.remainSeconds / 60);
    const seconds = current.remainSeconds % 60;
    publishBtn.textContent = `已锁定 ${minutes}:${String(seconds).padStart(2, '0')}`;
  };

  tick();
  if (lockTimer) clearInterval(lockTimer);
  lockTimer = setInterval(tick, 1000);
}

/** 打开系统文件选择框 */
function openPicker() {
  if (inputEl) inputEl.click();
}

/* ------------------------------------------------------------ 动态定损表 */

/** 创建一行定损档位 */
function createDamageRow() {
  damageSeq += 1;

  const row = document.createElement('tr');
  row.className = 'damage-row';
  row.dataset.rowId = String(damageSeq);

  const fields = [
    { key: 'level', placeholder: '如：轻微', numeric: false },
    { key: 'desc', placeholder: '如：表面抽丝', numeric: false },
    { key: 'deduct', placeholder: '0', numeric: true },
  ];

  fields.forEach((field) => {
    const cell = document.createElement('td');
    cell.className = 'damage-row__cell';

    const input = document.createElement('input');
    input.className = `input-group__control damage-row__input${
      field.numeric ? ' damage-row__input--num' : ''
    }`;
    input.type = field.numeric ? 'number' : 'text';
    input.dataset.field = field.key;
    input.placeholder = field.placeholder;
    input.setAttribute('aria-label', field.placeholder);
    if (field.numeric) {
      input.min = '0';
      input.step = '1';
      input.inputMode = 'numeric';
    }

    cell.appendChild(input);
    row.appendChild(cell);
  });

  const actionCell = document.createElement('td');
  actionCell.className = 'damage-row__cell';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'damage-row__remove';
  removeBtn.setAttribute('aria-label', '删除该档位');
  removeBtn.textContent = '×';
  removeBtn.addEventListener('click', () => removeDamageRow(row));

  actionCell.appendChild(removeBtn);
  row.appendChild(actionCell);

  return row;
}

/** 追加一行（供按钮与开关联动调用） */
function addDamageRow() {
  if (!damageRowsEl) return;
  damageRowsEl.appendChild(createDamageRow());
}

/** 删除一行，至少保留 MIN_DAMAGE_ROWS 行 */
function removeDamageRow(row) {
  if (!damageRowsEl) return;

  const rows = Array.from(damageRowsEl.querySelectorAll('.damage-row'));
  if (rows.length <= MIN_DAMAGE_ROWS) {
    showToast('至少保留一行损坏档位', 'error');
    return;
  }

  if (row && row.parentNode) row.remove();
}

/** 高值开关 ↔ 定损表显隐 */
function bindHighValueToggle() {
  if (!highSwitch || !damageSection) return;

  highSwitch.addEventListener('change', () => {
    const show = highSwitch.checked;
    damageSection.classList.toggle('hidden', !show);

    if (show && damageRowsEl && damageRowsEl.children.length === 0) {
      addDamageRow();
    }
  });
}

/* ---------------------------------------------------------------- 校验 */

/** 读取定损表当前行 → { rules, incomplete } */
function collectDamageRules() {
  const rows = damageRowsEl ? Array.from(damageRowsEl.querySelectorAll('.damage-row')) : [];
  const rules = [];
  let incomplete = false;

  rows.forEach((row) => {
    const levelEl = row.querySelector('[data-field="level"]');
    const descEl = row.querySelector('[data-field="desc"]');
    const deductEl = row.querySelector('[data-field="deduct"]');

    const level = levelEl ? levelEl.value.trim() : '';
    const desc = descEl ? descEl.value.trim() : '';
    const deductRaw = deductEl ? deductEl.value.trim() : '';

    // 整行空白：跳过（不算错误）
    if (!level && !desc && !deductRaw) return;

    const deduct = Number(deductRaw);
    if (!level || !desc || !deductRaw || !Number.isInteger(deduct) || deduct <= 0) {
      incomplete = true;
      return;
    }

    rules.push({ level, desc, deduct });
  });

  return { rules, incomplete };
}

/**
 * 表单校验
 * @returns {{valid: boolean, errors: Record<string,string>, values: object}}
 */
export function validateForm() {
  const errors = {};

  const title = titleInput ? titleInput.value.trim() : '';
  const description = descInput ? descInput.value.trim().slice(0, 200) : '';
  if (!title) {
    errors.title = '请填写物品标题';
  } else if (title.length <= 2) {
    errors.title = '标题至少需要 3 个字符';
  }

  const category = categoryValueEl ? String(categoryValueEl.value || '').trim() : '';
  if (!category) errors.category = '请选择物品分类';

  const depositRaw = depositInput ? depositInput.value.trim() : '';
  const deposit = Number(depositRaw);
  if (!depositRaw) {
    errors.deposit = '请填写要求的信用分';
  } else if (!Number.isInteger(deposit) || deposit <= 0) {
    errors.deposit = '信用分必须是大于 0 的整数';
  }

  const building = buildingSelect ? String(buildingSelect.value || '').trim() : '';
  if (!building) errors.building = '请选择所在楼栋';

  if (selectedImages.length === 0) errors.image = '请至少上传一张图片';

  let damageRules = null;
  const isHighValue = Boolean(highSwitch && highSwitch.checked);

  if (isHighValue) {
    const { rules, incomplete } = collectDamageRules();

    if (rules.length === 0 && incomplete) {
      // 有内容但填了一半，提示补全更可操作
      errors.damage = '有档位填写不完整，请补全级别 / 描述 / 扣分';
    } else if (rules.length === 0) {
      errors.damage = '请至少完整填写一行损坏档位（级别 / 描述 / 扣分）';
    } else if (incomplete) {
      errors.damage = '有档位填写不完整，请补全或删除该行';
    } else {
      damageRules = {
        item_category: category || 'other',
        rules,
        max_deduct: Math.max(...rules.map((rule) => rule.deduct)),
        agreed_at_publish: true,
      };
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    values: { title, description, category, deposit, building, isHighValue, damageRules },
  };
}

/** 渲染字段错误：红字提示 + 输入框红框 */
function renderErrors(errors) {
  Object.entries(ERROR_NODES).forEach(([key, node]) => {
    if (!node) return;
    const message = errors[key] || '';
    node.textContent = message;
    node.classList.toggle('hidden', !message);
  });

  const mark = (input, hasError) => {
    if (!input) return;
    const group = input.closest('.input-group');
    if (group) group.classList.toggle('has-error', hasError);
  };

  mark(titleInput, Boolean(errors.title));
  mark(depositInput, Boolean(errors.deposit));

  if (categoryRoot) categoryRoot.classList.toggle('has-error', Boolean(errors.category));
}

/* ---------------------------------------------------------------- 提交 */

/** 组装 7.3.3 发布请求体 */
function buildPayload(values) {
  return {
    title: values.title,
    category: values.category,
    description: values.description,
    image_hash: '',
    // 首图缩略图随发布一起上传，换设备也能看到图
    image_data: selectedImages.length > 0 ? selectedImages[0].dataUrl : '',
    image_count: selectedImages.length,
    deposit_score: values.deposit,
    damage_rules: values.damageRules,
    building_loc: values.building,
    is_high_value: values.isHighValue,
  };
}

/** 切换提交按钮 Loading 态 */
function setSubmittingState(loading) {
  if (!publishBtn) return;
  publishBtn.disabled = loading;
  publishBtn.textContent = loading ? '发布中...' : '发布';
}

/** 提交流程 */
async function handleSubmit() {
  if (submitting || submitted) return;

  const { valid, errors, values } = validateForm();
  renderErrors(errors);

  if (!valid) {
    const firstError = Object.values(errors)[0] || '请检查表单';
    showToast(firstError, 'error');
    return;
  }

  submitting = true;
  setSubmittingState(true);

  try {
    await ensureToken();

    const payload = buildPayload(values);

    // 用第一张压缩图的指纹作为 image_hash（不再上报空串）
    if (selectedImages.length > 0) {
      payload.image_hash = await fingerprintOf(selectedImages[0].dataUrl);
    }

    // 与「最短 Loading 时长」并行：接口快也不闪一下，慢则按实际等待
    const [created] = await Promise.all([
      request('/items/publish', { method: 'POST', body: payload }),
      new Promise((resolve) => setTimeout(resolve, SUBMIT_MIN_MS)),
    ]);

    // 图片不上传服务器：按 item_id 存在本地，列表/详情渲染时读取
    if (created && created.item_id) {
      saveItemImages(
        created.item_id,
        selectedImages.map((image) => image.dataUrl)
      );
    }

    submitted = true;
    clearSensitiveHits();
    showToast('发布成功，正在返回首页', 'success');

    setTimeout(() => {
      window.location.href = './index.html';
    }, 700);
  } catch (error) {
    const message = (error && error.message) || '网络异常';

    // 敏感词连击：3 次后锁定发布 5 分钟
    if (message.includes('敏感词')) {
      const result = recordSensitiveHit();
      if (result.locked) {
        applyPublishLock();
        showToast('连续触发敏感词，发布已锁定 5 分钟', 'error');
      } else {
        showToast(`发布失败：${message}（还剩 ${MAX_HITS - result.hits} 次机会）`, 'error');
      }
    } else {
      showToast(`发布失败：${message}`, 'error');
    }

    setSubmittingState(false);
  } finally {
    submitting = false;
  }
}

/* ---------------------------------------------------------- 离开拦截 */

/** 表单是否有未保存内容 */
function isDirty() {
  if (submitted) return false;

  const hasText =
    (titleInput && titleInput.value.trim()) ||
    (depositInput && depositInput.value.trim()) ||
    (categoryValueEl && categoryValueEl.value);

  return Boolean(hasText || selectedImages.length > 0 || (highSwitch && highSwitch.checked));
}

/**
 * beforeunload 拦截
 * 注意：现代浏览器不允许自定义提示文案，只会显示内置的「离开此网站？」，
 * 这里仍按规范设置 returnValue，便于旧浏览器与自动化断言。
 * @param {BeforeUnloadEvent} event
 */
function onBeforeUnload(event) {
  if (!isDirty()) return;
  const message = '您有未保存的内容，确定离开吗？';
  event.preventDefault();
  event.returnValue = message;
  return message;
}

function bindUnloadGuard() {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  window.addEventListener('beforeunload', onBeforeUnload);
}

/* -------------------------------------------------- 移动端键盘弹出保护 */

/** 键盘弹起判定阈值（视口高度缩水超过该值即认为键盘已弹出） */
const KEYBOARD_THRESHOLD = 120;
/** 会唤起键盘的元素 */
const EDITABLE_TAGS = /^(INPUT|TEXTAREA|SELECT)$/i;

/** 把当前聚焦的控件滚动到可视区中部，避免被键盘挡住 */
function revealActiveField() {
  const active = document.activeElement;
  if (!active || typeof active.scrollIntoView !== 'function') return;
  active.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/**
 * 键盘弹出时：隐藏底部固定提交栏（否则会被顶起遮挡表单），并把聚焦控件滚到可视区中部。
 * 优先用 visualViewport 精确判断，不支持时降级为 focusin/focusout。
 */
function bindKeyboardGuard() {
  if (typeof window === 'undefined') return;

  const viewport = window.visualViewport;

  if (viewport && typeof viewport.addEventListener === 'function') {
    const onViewportChange = () => {
      const shrink = (window.innerHeight || 0) - viewport.height;
      const keyboardOpen = shrink > KEYBOARD_THRESHOLD;
      document.body.classList.toggle('keyboard-open', keyboardOpen);
      if (keyboardOpen) revealActiveField();
    };

    viewport.addEventListener('resize', onViewportChange);
    viewport.addEventListener('scroll', onViewportChange);
    return;
  }

  document.addEventListener('focusin', (event) => {
    const target = event.target;
    if (!target || !EDITABLE_TAGS.test(target.tagName || '')) return;
    document.body.classList.add('keyboard-open');
    revealActiveField();
  });

  document.addEventListener('focusout', () => {
    setTimeout(() => {
      const active = document.activeElement;
      if (!active || !EDITABLE_TAGS.test(active.tagName || '')) {
        document.body.classList.remove('keyboard-open');
      }
    }, 120);
  });
}

/* ------------------------------------------------------------------ 交互 */

/** 点击 / 键盘触发选择 */
function bindArea() {
  if (!areaEl) return;

  areaEl.addEventListener('click', openPicker);

  areaEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPicker();
    }
  });
}

/** 文件选择 + 拖拽上传 */
function bindUpload() {
  if (inputEl) {
    inputEl.addEventListener('change', () => {
      addFiles(inputEl.files);
      inputEl.value = '';
    });
  }

  if (!areaEl) return;

  ['dragenter', 'dragover'].forEach((type) => {
    areaEl.addEventListener(type, (event) => {
      event.preventDefault();
      areaEl.classList.add('is-dragover');
    });
  });

  ['dragleave', 'dragend'].forEach((type) => {
    areaEl.addEventListener(type, () => {
      areaEl.classList.remove('is-dragover');
    });
  });

  areaEl.addEventListener('drop', (event) => {
    event.preventDefault();
    areaEl.classList.remove('is-dragover');
    addFiles(event.dataTransfer && event.dataTransfer.files);
  });
}

/** 返回按钮 */
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

/** 表单提交：本批只拦截，避免回车刷新页面 */
function bindForm() {
  if (!formEl) return;
  formEl.addEventListener('submit', (event) => {
    event.preventDefault();
  });
}

/* ------------------------------------------------------------------ 启动 */

/** 用当前账号的楼栋预选 */
function applyAccountBuilding() {
  if (!buildingSelect) return;

  let building = DEFAULT_BUILDING;
  try {
    const raw = localStorage.getItem('yxx_user');
    const user = raw ? JSON.parse(raw) : null;
    building = (user && user.building_loc) || '';
  } catch {
    building = '';
  }

  if (building && Array.from(buildingSelect.options).some((opt) => opt.value === building)) {
    buildingSelect.value = building;
  }
}

function init() {
  bindBack();
  bindUpload();
  bindArea();
  bindForm();
  bindHighValueToggle();
  bindUnloadGuard();
  bindKeyboardGuard();
  if (addRowBtn) addRowBtn.addEventListener('click', addDamageRow);
  if (publishBtn) publishBtn.addEventListener('click', handleSubmit);

  if (descInput && descCount) {
    const updateDescCount = () => {
      descCount.textContent = `${descInput.value.length} / 200`;
    };
    descInput.addEventListener('input', updateDescCount);
    updateDescCount();
  }
  initCustomSelect();
  updateCount();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
