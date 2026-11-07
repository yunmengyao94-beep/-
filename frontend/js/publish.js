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
/** 本批未做楼栋选择，默认取登录用户常驻楼栋 */
const DEFAULT_BUILDING = '7号楼';

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
const depositInput = document.getElementById('field-deposit');
const categoryRoot = document.querySelector('[data-custom-select]');
const categoryValueEl = categoryRoot ? categoryRoot.querySelector('input[type="hidden"]') : null;

/** 字段 → 错误提示节点 */
const ERROR_NODES = {
  title: document.getElementById('err-title'),
  category: document.getElementById('err-category'),
  deposit: document.getElementById('err-deposit'),
  image: document.getElementById('err-image'),
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

/** 用对象 URL 加载图片，加载完成即可释放 */
function loadImage(file) {
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

  updateCount();
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
      showToast(`「${file.name}」压缩失败：${error.message}`, 'error');
    }
  }

  if (overflow) showToast(`最多上传 ${MAX_IMAGES} 张图片`, 'error');
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
    values: { title, category, deposit, isHighValue, damageRules },
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
    image_hash: '',
    image_count: selectedImages.length,
    deposit_score: values.deposit,
    damage_rules: values.damageRules,
    building_loc: DEFAULT_BUILDING,
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
    // 与「最短 Loading 时长」并行：接口快也不闪一下，慢则按实际等待
    await Promise.all([
      request('/items/publish', { method: 'POST', body: payload }),
      new Promise((resolve) => setTimeout(resolve, SUBMIT_MIN_MS)),
    ]);

    submitted = true;
    showToast('发布成功，正在返回首页', 'success');

    setTimeout(() => {
      window.location.href = './index.html';
    }, 700);
  } catch (error) {
    const message = (error && error.message) || '网络异常';
    showToast(`发布失败：${message}`, 'error');
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
  initCustomSelect();
  updateCount();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
