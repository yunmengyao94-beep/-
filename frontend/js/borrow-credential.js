/**
 * 借用凭证 + 顶部交接抽屉
 * ---------------------------------------------------------------------------
 * 流程：出借人同意 → 借用人收到 borrow_accept → 本模块弹出全屏凭证
 *   1. 凭证以弹性曲线放大出现
 *   2. 强制停留 3 秒（进度条），期间下载按钮不可点
 *   3. 点击「保存凭证到本地」触发下载，再勾选「我已妥善保存」
 *   4. 关闭凭证后，顶部抽屉滑出，确认交接 → 调用后端状态流转
 */

import { request, apiUrl } from '../utils/request.js';
import { showToast } from '../components/feedback.js';

const COUNTDOWN_MS = 3000;

/** 生成凭证文本 */
function buildCredential(meta, item) {
  const now = new Date();
  const orderId = meta.order_id || '—';
  const code = `YXX-${String(orderId).padStart(6, '0')}-${now.getTime().toString(36).toUpperCase().slice(-6)}`;

  return [
    '庆师易校圈 · 物品借用凭证',
    '================================',
    `凭证编号：${code}`,
    `订单编号：${orderId}`,
    `物品名称：${meta.title || item.title || '—'}`,
    `押金分数：${meta.deposit_score ?? item.deposit_score ?? 0} 分（已冻结）`,
    `约定归还：${
      String(meta.due_at || '')
        .slice(0, 16)
        .replace('T', ' ') || '—'
    }`,
    `生成时间：${now.toLocaleString('zh-CN', { hour12: false })}`,
    '================================',
    '本凭证由双方在聊天中达成借用合意后自动生成。',
    '归还确认后冻结分数将全额解冻。',
  ].join('\n');
}

/** 把物品缩略图压到 128px 以内（交接时调用，产物约 5–8KB） */
function buildThumb128(item) {
  return new Promise((resolve) => {
    if (!item || !item.has_thumb) {
      resolve('');
      return;
    }

    const img = new Image();
    img.decoding = 'async';

    img.onload = () => {
      try {
        const longest = Math.max(img.width || 0, img.height || 0) || 128;
        const scale = Math.min(1, 128 / longest);
        const width = Math.max(1, Math.round((img.width || 128) * scale));
        const height = Math.max(1, Math.round((img.height || 128) * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve('');

        ctx.drawImage(img, 0, 0, width, height);
        // 0.55 质量 + 128px，产物通常 5–8KB
        return resolve(canvas.toDataURL('image/webp', 0.55));
      } catch {
        return resolve('');
      }
    };

    img.onerror = () => resolve('');
    img.src = apiUrl(`/items/${item.id}/thumb?v=${Date.now()}`);
  });
}

/** 触发浏览器下载 */
function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * 弹出凭证流程
 * @param {{meta: object, item: object}} options
 */
export function showCredentialFlow(options = {}) {
  const { meta = {}, item = {} } = options;
  const credentialText = buildCredential(meta, item);

  const mask = document.createElement('div');
  mask.className = 'credential-mask';

  const card = document.createElement('section');
  card.className = 'credential-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', '借用凭证');

  const badge = document.createElement('span');
  badge.className = 'credential-badge';
  badge.textContent = '借用达成';

  const title = document.createElement('h2');
  title.className = 'credential-title';
  title.textContent = '借用凭证';

  const subtitle = document.createElement('p');
  subtitle.className = 'credential-subtitle';
  subtitle.textContent = meta.title || item.title || '物品';

  const rows = document.createElement('dl');
  rows.className = 'credential-rows';
  [
    ['凭证编号', `YXX-${String(meta.order_id || '').padStart(6, '0')}`],
    ['押金分数', `${meta.deposit_score ?? item.deposit_score ?? 0} 分（已冻结）`],
    ['约定归还', String(meta.due_at || '').slice(0, 10) || '—'],
    ['生成时间', new Date().toLocaleString('zh-CN', { hour12: false })],
  ].forEach(([key, value]) => {
    const dt = document.createElement('dt');
    dt.textContent = key;
    const dd = document.createElement('dd');
    dd.textContent = value;
    rows.append(dt, dd);
  });

  // 倒计时进度
  const progressWrap = document.createElement('div');
  progressWrap.className = 'credential-progress';
  const progressBar = document.createElement('div');
  progressBar.className = 'credential-progress__bar';
  progressWrap.appendChild(progressBar);
  const countdownText = document.createElement('p');
  countdownText.className = 'credential-countdown';
  countdownText.textContent = '凭证生成中，请稍候 3 秒…';

  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.className = 'btn btn--primary btn--block';
  downloadBtn.textContent = '保存凭证到本地';
  downloadBtn.disabled = true;

  const checkLabel = document.createElement('label');
  checkLabel.className = 'credential-check';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.disabled = true;
  const checkText = document.createElement('span');
  checkText.textContent = '我已妥善保存凭证';
  checkLabel.append(checkbox, checkText);

  const finishBtn = document.createElement('button');
  finishBtn.type = 'button';
  finishBtn.className = 'btn btn--secondary btn--block';
  finishBtn.textContent = '完成并继续交接';
  finishBtn.disabled = true;

  card.append(
    badge,
    title,
    subtitle,
    rows,
    progressWrap,
    countdownText,
    downloadBtn,
    checkLabel,
    finishBtn
  );
  mask.appendChild(card);
  document.body.appendChild(mask);
  document.body.classList.add('chat-open');

  let saved = false;
  let closed = false;
  let raf = null;
  const startAt = Date.now();

  /** 倒计时动画 */
  function tick() {
    const elapsed = Date.now() - startAt;
    const remain = Math.max(0, COUNTDOWN_MS - elapsed);
    progressBar.style.width = `${Math.min(100, (elapsed / COUNTDOWN_MS) * 100)}%`;

    if (remain > 0) {
      countdownText.textContent = `凭证生成中，请稍候 ${Math.ceil(remain / 1000)} 秒…`;
      raf = requestAnimationFrame(tick);
      return;
    }

    countdownText.textContent = '请保存凭证后再确认交接';
    progressWrap.classList.add('is-done');
    downloadBtn.disabled = false;
  }

  raf = requestAnimationFrame(tick);

  function close() {
    if (closed) return;
    closed = true;
    if (raf) cancelAnimationFrame(raf);
    mask.remove();
    document.body.classList.remove('chat-open');
  }

  downloadBtn.addEventListener('click', () => {
    if (downloadBtn.disabled) return;
    downloadText(`借用凭证_${meta.order_id || Date.now()}.txt`, credentialText);
    saved = true;
    checkbox.disabled = false;
    checkText.textContent = '凭证已下载，请确认已妥善保存';
    showToast('凭证已保存到本地', 'success');
  });

  checkbox.addEventListener('change', () => {
    finishBtn.disabled = !(saved && checkbox.checked);
  });

  finishBtn.addEventListener('click', () => {
    if (!saved || !checkbox.checked) return;
    close();
    showTopDrawer({ meta, item });
  });

  mask.addEventListener('click', (event) => {
    if (event.target !== mask) return;
    if (finishBtn.disabled) {
      showToast('请先保存凭证并勾选确认', 'error');
      return;
    }
    close();
  });
}

/**
 * 顶部交接抽屉
 * @param {{meta: object, item: object}} options
 */
export function showTopDrawer(options = {}) {
  const { meta = {}, item = {} } = options;
  const orderId = meta.order_id;
  if (!orderId) {
    showToast('订单信息缺失，请到订单页确认交接', 'error');
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'top-drawer-mask';

  const drawer = document.createElement('section');
  drawer.className = 'top-drawer';
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  drawer.setAttribute('aria-label', '确认交接');

  const handle = document.createElement('span');
  handle.className = 'top-drawer__handle';

  const title = document.createElement('h3');
  title.className = 'top-drawer__title';
  title.textContent = '确认物品已当面交接';

  const body = document.createElement('p');
  body.className = 'top-drawer__body';
  body.textContent = `请确认已拿到「${meta.title || item.title || '物品'}」并检查无误。确认后订单进入使用中，押金分保持冻结。`;

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'btn btn--primary btn--block';
  confirmBtn.textContent = '确认交接';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn--secondary btn--block';
  cancelBtn.textContent = '稍后再说';

  drawer.append(handle, title, body, confirmBtn, cancelBtn);
  wrap.appendChild(drawer);
  document.body.appendChild(wrap);

  function close() {
    wrap.remove();
  }

  cancelBtn.addEventListener('click', close);

  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = '处理中…';

    try {
      // 交接即降级：把当前图压到 128px 随请求提交，服务端落盘
      const thumb128 = await buildThumb128(item).catch(() => '');

      await request(`/orders/${orderId}/state`, {
        method: 'PATCH',
        body: thumb128
          ? { action: 'confirm_handover', thumb_128: thumb128 }
          : { action: 'confirm_handover' },
      });
      close();
      showToast('交接完成，订单进入使用中', 'success');
      window.dispatchEvent(new CustomEvent('yxx:order-updated', { detail: { orderId } }));
    } catch (error) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = '确认交接';
      showToast(error.message || '交接失败', 'error');
    }
  });
}

export default { showCredentialFlow, showTopDrawer };
