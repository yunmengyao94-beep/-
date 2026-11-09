/**
 * 聊天（服务端中转 + 10 秒轮询 + 本地历史合并）
 * ---------------------------------------------------------------------------
 * · 消息经由 /messages 中转，服务端只在内存保留 1 小时，不写 db.json
 * · 轮询 10 秒一次；页面切到后台（document.hidden）立刻停，回到前台恢复
 * · 拉到的消息与本地记录按 id 合并，保留历史
 * · 借用人可发送「借用申请」卡片，出借人在聊天内点「同意借用」
 * · 出借人同意后，借用人收到 borrow_accept → 弹出凭证 → 顶部抽屉确认交接
 */

import { request } from '../utils/request.js';
import { showToast } from '../components/feedback.js';
import { showCredentialFlow } from './borrow-credential.js';

const POLL_MS = 10 * 1000;
const MAX_LOCAL = 200;
const MAX_IMAGE_EDGE = 512;
const WEBP_QUALITY = 0.7;

let panel = null;

/** 当前登录用户 */
function readUser() {
  try {
    return JSON.parse(localStorage.getItem('yxx_user') || '{}');
  } catch {
    return {};
  }
}

/** 本地历史 */
function readLocal(key) {
  try {
    const raw = localStorage.getItem(key);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeLocal(key, list) {
  try {
    localStorage.setItem(key, JSON.stringify(list.slice(-MAX_LOCAL)));
  } catch {
    // 忽略
  }
}

/** 图片压缩 */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const longest = Math.max(img.width || 0, img.height || 0) || MAX_IMAGE_EDGE;
      const scale = longest > MAX_IMAGE_EDGE ? MAX_IMAGE_EDGE / longest : 1;
      const width = Math.max(1, Math.round((img.width || MAX_IMAGE_EDGE) * scale));
      const height = Math.max(1, Math.round((img.height || MAX_IMAGE_EDGE) * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('浏览器不支持图片压缩'));
      ctx.drawImage(img, 0, 0, width, height);
      return resolve(canvas.toDataURL('image/webp', WEBP_QUALITY));
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片解析失败'));
    };
    img.src = url;
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('音频读取失败'));
    reader.readAsDataURL(blob);
  });
}

function formatClock(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 默认归还时间：72 小时后 */
function defaultDue() {
  return new Date(Date.now() + 72 * 3600 * 1000).toISOString();
}

/**
 * 打开聊天
 * @param {{item: object, owner: {id:number, nickname:string}}} options
 */
export function openChat(options = {}) {
  const { item, owner, partner } = options;
  if (!item || !owner) return;

  if (panel) closeChat();

  const me = readUser();
  const myId = Number(me.user_id) || 0;
  const isOwner = Number(item.owner_id) === myId;

  /**
   * 聊天对象：
   *   · 订单页进入 → 直接携带 partner（对方 id / 昵称）
   *   · 详情页借用人 → 出借人
   *   · 详情页出借人 → 首位申请人（轮询后发现）
   */
  let partnerId =
    Number(partner && partner.id) || (isOwner ? null : Number(owner.id) || Number(item.owner_id));
  const partnerName =
    (partner && partner.nickname) || (isOwner ? '借用人' : owner.nickname || '出借人');

  // 严格按 item_id + partner_id 隔离：chat_${item_id}_${partner_id}
  let storageKey = `chat_${item.id}_${partnerId || 'pending'}`;
  let messages = readLocal(storageKey);

  // 兼容历史版本：出借人曾用 chat_{id}_owner 作为 key
  if (messages.length === 0) {
    const legacy = readLocal(`chat_${item.id}_owner`);
    if (legacy.length > 0) {
      messages = legacy;
      writeLocal(storageKey, messages);
    }
  }
  let sinceId = 0; // 始终从 0 开始拉，服务端最多保留 1 小时消息，量很小
  let pollTimer = null;
  let closed = false;
  let credentialShown = false;

  /* ---------------- 骨架 ---------------- */
  const mask = document.createElement('div');
  mask.className = 'chat-mask';

  const box = document.createElement('section');
  box.className = 'chat-panel';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');

  const head = document.createElement('header');
  head.className = 'chat-head';

  const avatar = document.createElement('span');
  avatar.className = 'chat-avatar chat-avatar--head';
  avatar.textContent = String(partnerName).slice(0, 1);

  const headTitle = document.createElement('div');
  headTitle.className = 'chat-head__title';
  const nameEl = document.createElement('strong');
  nameEl.textContent = partnerName;
  const subEl = document.createElement('span');
  subEl.className = 'chat-head__item';
  subEl.textContent = `物品：${item.title}`;
  headTitle.append(nameEl, subEl);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'chat-close';
  closeBtn.setAttribute('aria-label', '关闭聊天');
  closeBtn.textContent = '×';

  head.append(avatar, headTitle, closeBtn);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'chat-body';

  const footer = document.createElement('footer');
  footer.className = 'chat-input';

  const imgBtn = document.createElement('button');
  imgBtn.type = 'button';
  imgBtn.className = 'chat-tool';
  imgBtn.setAttribute('aria-label', '发送图片');
  imgBtn.textContent = '📷';

  const voiceBtn = document.createElement('button');
  voiceBtn.type = 'button';
  voiceBtn.className = 'chat-tool';
  voiceBtn.setAttribute('aria-label', '录制语音');
  voiceBtn.textContent = '🎤';

  const textInput = document.createElement('input');
  textInput.className = 'chat-text';
  textInput.type = 'text';
  textInput.placeholder = '说点什么…';
  textInput.maxLength = 300;

  const sendBtn = document.createElement('button');
  sendBtn.type = 'button';
  sendBtn.className = 'chat-send';
  sendBtn.textContent = '发送';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.className = 'hidden';

  footer.append(imgBtn, voiceBtn, textInput, sendBtn, fileInput);

  const tools = document.createElement('div');
  tools.className = 'chat-tools';

  if (!isOwner) {
    const borrowBtn = document.createElement('button');
    borrowBtn.type = 'button';
    borrowBtn.className = 'btn btn--primary btn--sm chat-borrow-btn';
    borrowBtn.textContent = '申请借用';
    borrowBtn.addEventListener('click', sendBorrowRequest);
    tools.appendChild(borrowBtn);
  } else {
    const tip = document.createElement('span');
    tip.className = 'chat-tools__tip';
    tip.textContent = '借用人发起申请后，可在此直接同意';
    tools.appendChild(tip);
  }

  box.append(head, bodyEl, tools, footer);
  mask.appendChild(box);
  document.body.appendChild(mask);
  document.body.classList.add('chat-open');

  /* ---------------- 渲染 ---------------- */
  function createBubble(message) {
    const row = document.createElement('div');
    const mine = Number(message.from) === myId;

    if (message.type === 'system') {
      row.className = 'chat-system';
      row.textContent = message.content;
      return row;
    }

    row.className = `chat-msg chat-msg--${mine ? 'me' : 'them'}`;

    const av = document.createElement('span');
    av.className = 'chat-avatar';
    av.textContent = mine
      ? String(me.nickname || '我').slice(0, 1)
      : String(partnerName).slice(0, 1);

    const main = document.createElement('div');
    main.className = 'chat-msg__main';

    if (message.type === 'image') {
      const img = document.createElement('img');
      img.className = 'chat-bubble__img';
      img.src = message.content;
      img.alt = '图片消息';
      img.loading = 'lazy';
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble';
      bubble.appendChild(img);
      main.appendChild(bubble);
    } else if (message.type === 'audio') {
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chat-voice';
      btn.textContent = `▶ ${message.meta && message.meta.duration ? message.meta.duration : 1}″`;
      btn.addEventListener('click', () => {
        const audio = new Audio(message.content);
        audio.play().catch(() => showToast('音频播放失败', 'error'));
      });
      bubble.appendChild(btn);
      main.appendChild(bubble);
    } else if (message.type === 'borrow_request') {
      main.appendChild(createBorrowCard(message));
    } else if (message.type === 'borrow_accept') {
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble chat-bubble--ok';
      bubble.textContent = '出借人已同意借用，凭证生成中…';
      main.appendChild(bubble);
    } else {
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble';
      const text = document.createElement('p');
      text.className = 'chat-bubble__text';
      text.textContent = message.content;
      bubble.appendChild(text);
      main.appendChild(bubble);
    }

    const time = document.createElement('span');
    time.className = 'chat-time';
    time.textContent = formatClock(message.at || Date.now());
    main.appendChild(time);

    if (mine) row.append(main, av);
    else row.append(av, main);
    return row;
  }

  /** 借用申请卡片 */
  function createBorrowCard(message) {
    const card = document.createElement('div');
    card.className = 'chat-borrow-card';

    const title = document.createElement('p');
    title.className = 'chat-borrow-card__title';
    title.textContent = `借用申请：${item.title}`;

    const meta = document.createElement('p');
    meta.className = 'chat-borrow-card__meta';
    const deposit =
      message.meta && message.meta.deposit_score ? message.meta.deposit_score : item.deposit_score;
    meta.textContent = `押金 ${deposit} 分 · 约定归还 ${String((message.meta && message.meta.due_at) || '').slice(0, 10)}`;

    card.append(title, meta);

    if (isOwner && item.status === 0) {
      const approveBtn = document.createElement('button');
      approveBtn.type = 'button';
      approveBtn.className = 'btn btn--primary btn--sm';
      approveBtn.textContent = '同意借用';
      approveBtn.addEventListener('click', async () => {
        approveBtn.disabled = true;
        approveBtn.textContent = '处理中…';
        try {
          const result = await request('/orders/approve', {
            method: 'POST',
            body: {
              item_id: item.id,
              borrower_id: message.from,
              due_at: message.meta && message.meta.due_at,
            },
          });
          showToast(`已同意借用，订单已生成（冻结 ${result.frozen_score} 分）`, 'success');
          approveBtn.textContent = '已同意';
        } catch (error) {
          approveBtn.disabled = false;
          approveBtn.textContent = '同意借用';
          showToast(error.message || '同意失败', 'error');
        }
      });
      card.appendChild(approveBtn);
    } else if (isOwner) {
      const tip = document.createElement('p');
      tip.className = 'chat-borrow-card__tip';
      tip.textContent = '该物品当前不可借';
      card.appendChild(tip);
    }

    return card;
  }

  function renderAll() {
    bodyEl.textContent = '';
    if (messages.length === 0) {
      const tip = document.createElement('p');
      tip.className = 'chat-empty';
      tip.textContent = isOwner ? '等待借用人发起申请' : '还没有消息，打个招呼吧';
      bodyEl.appendChild(tip);
      return;
    }
    const fragment = document.createDocumentFragment();
    messages.forEach((message) => fragment.appendChild(createBubble(message)));
    bodyEl.appendChild(fragment);
    bodyEl.scrollTo({ top: bodyEl.scrollHeight, behavior: 'smooth' });
  }

  /** 发现对方后，把会话切到严格 key（item_id + partner_id） */
  function ensureStorageKey() {
    if (!partnerId) return;
    const next = `chat_${item.id}_${partnerId}`;
    if (next === storageKey) return;
    storageKey = next;
    writeLocal(storageKey, messages);
  }

  /** 合并消息（按 id 去重，保留本地历史） */
  function mergeMessages(incoming) {
    const map = new Map();
    messages.forEach((message) => map.set(String(message.id), message));
    incoming.forEach((message) => map.set(String(message.id), message));

    messages = [...map.values()].sort((a, b) => {
      const ida = Number(a.id) || 0;
      const idb = Number(b.id) || 0;
      return ida - idb;
    });

    writeLocal(storageKey, messages);
    sinceId = messages.reduce((max, message) => Math.max(max, Number(message.id) || 0), sinceId);
  }

  /** 处理服务端返回 */
  function handleIncoming(list) {
    if (!list || list.length === 0) return;

    let changed = false;
    list.forEach((message) => {
      if (isOwner && !partnerId) {
        partnerId = Number(message.from);
        ensureStorageKey();
      }
      if (message.type === 'borrow_accept' && !isOwner && !credentialShown) {
        credentialShown = true;
        showCredentialFlow({ meta: message.meta || {}, item });
      }
      changed = true;
    });

    if (changed) {
      mergeMessages(list);
      renderAll();
    }
  }

  /** 拉取新消息 */
  async function poll() {
    if (closed) return;
    try {
      const params = new URLSearchParams({ since: String(sinceId), item_id: String(item.id) });
      if (partnerId) params.set('partner_id', String(partnerId));
      const data = await request(`/messages?${params.toString()}`);
      handleIncoming((data && data.list) || []);
      if (data && Number.isFinite(Number(data.since))) sinceId = Number(data.since);
    } catch {
      // 轮询失败静默，下次重试
    }
  }

  /** 发送消息 */
  async function send(type, content, meta = {}) {
    if (!partnerId) {
      showToast('尚未确定聊天对象', 'error');
      return null;
    }
    try {
      const message = await request('/messages', {
        method: 'POST',
        body: { to_user_id: partnerId, item_id: item.id, type, content, meta },
      });
      mergeMessages([message]);
      renderAll();
      return message;
    } catch (error) {
      showToast(error.message || '发送失败', 'error');
      return null;
    }
  }

  async function sendBorrowRequest() {
    const message = await send('borrow_request', '申请借用', {
      item_id: item.id,
      title: item.title,
      deposit_score: item.deposit_score,
      due_at: defaultDue(),
    });
    if (message) showToast('借用申请已发送，等待出借人确认', 'success');
  }

  function sendText() {
    const value = textInput.value.trim();
    if (!value) return;
    send('text', value);
    textInput.value = '';
    textInput.focus();
  }

  /* ---------------- 事件 ---------------- */
  sendBtn.addEventListener('click', sendText);
  textInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendText();
    }
  });

  imgBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const dataUrl = await compressImage(file);
      await send('image', dataUrl);
    } catch (error) {
      showToast(error.message || '图片发送失败', 'error');
    }
  });

  /* 语音 */
  let recorder = null;
  let chunks = [];
  let startedAt = 0;
  let timerId = null;

  async function startRecording() {
    if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') {
      showToast('当前浏览器不支持录音', 'error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder = new MediaRecorder(stream);
      chunks = [];
      startedAt = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const duration = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
        if (chunks.length === 0) return;
        try {
          const blob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' });
          const dataUrl = await blobToBase64(blob);
          await send('audio', dataUrl, { duration });
        } catch (error) {
          showToast(error.message || '语音发送失败', 'error');
        }
      };

      recorder.start();
      voiceBtn.classList.add('is-recording');
      voiceBtn.textContent = '⏹';
      timerId = setInterval(() => {
        textInput.placeholder = `录音中… ${Math.round((Date.now() - startedAt) / 1000)}s（再点 🎤 结束）`;
      }, 500);
    } catch {
      showToast('无法获取麦克风权限', 'error');
    }
  }

  function stopRecording() {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    recorder = null;
    voiceBtn.classList.remove('is-recording');
    voiceBtn.textContent = '🎤';
    textInput.placeholder = '说点什么…';
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  voiceBtn.addEventListener('click', () => {
    if (recorder && recorder.state === 'recording') stopRecording();
    else startRecording();
  });

  /* ---------------- 轮询控制 ---------------- */
  function startPolling() {
    if (pollTimer || closed) return;
    pollTimer = setInterval(poll, POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function onVisibility() {
    if (document.hidden) stopPolling();
    else {
      poll();
      startPolling();
    }
  }

  document.addEventListener('visibilitychange', onVisibility);

  /* ---------------- 关闭 ---------------- */
  function close() {
    if (closed) return;
    closed = true;
    stopPolling();
    stopRecording();
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('keydown', onKeydown);
    mask.remove();
    document.body.classList.remove('chat-open');
    panel = null;
  }

  function onKeydown(event) {
    if (event.key === 'Escape') close();
  }

  closeBtn.addEventListener('click', close);
  mask.addEventListener('click', (event) => {
    if (event.target === mask) close();
  });
  document.addEventListener('keydown', onKeydown);

  panel = { close };

  renderAll();
  poll();
  if (!document.hidden) startPolling();
}

export function closeChat() {
  if (panel) panel.close();
}

export default { openChat, closeChat };
