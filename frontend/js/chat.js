/**
 * 本地聊天（纯前端，localStorage）
 * ---------------------------------------------------------------------------
 * · 存储键：chat_${itemId}_${ownerId}，值为消息数组
 * · 支持文本 / 图片（Canvas 压缩 512px → Base64）/ 语音（MediaRecorder → Base64）
 * · 不上传服务器，换设备不同步（演示版定位）
 */

import { showToast } from '../components/feedback.js';

const MAX_IMAGE_EDGE = 512;
const WEBP_QUALITY = 0.7;
const MAX_MESSAGES = 200;

/** 当前打开的面板状态 */
let panel = null;

/** 读取聊天记录 */
function readMessages(key) {
  try {
    const raw = localStorage.getItem(key);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** 写入聊天记录 */
function writeMessages(key, list) {
  try {
    localStorage.setItem(key, JSON.stringify(list.slice(-MAX_MESSAGES)));
  } catch {
    showToast('本地存储空间不足，聊天记录未保存', 'error');
  }
}

/** 当前用户昵称首字 */
function myAvatar() {
  try {
    const user = JSON.parse(localStorage.getItem('yxx_user') || '{}');
    return String(user.nickname || user.real_name || '我').slice(0, 1);
  } catch {
    return '我';
  }
}

/** 压缩图片到 512px WebP */
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
      if (!ctx) {
        reject(new Error('浏览器不支持图片压缩'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/webp', WEBP_QUALITY));
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片解析失败'));
    };

    img.src = url;
  });
}

/** Blob → Base64 */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('音频读取失败'));
    reader.readAsDataURL(blob);
  });
}

/** 时间戳 → HH:mm */
function formatClock(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 消息气泡节点 */
function createBubble(message, owner) {
  const row = document.createElement('div');
  row.className = `chat-msg chat-msg--${message.from === 'me' ? 'me' : 'them'}`;

  const avatar = document.createElement('span');
  avatar.className = 'chat-avatar';
  avatar.textContent =
    message.from === 'me' ? myAvatar() : String(owner.nickname || 'Ta').slice(0, 1);

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';

  if (message.type === 'image') {
    const img = document.createElement('img');
    img.className = 'chat-bubble__img';
    img.src = message.content;
    img.alt = '图片消息';
    img.loading = 'lazy';
    bubble.appendChild(img);
  } else if (message.type === 'audio') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-voice';
    btn.textContent = `▶ ${message.duration || 0}″`;
    btn.addEventListener('click', () => {
      const audio = new Audio(message.content);
      audio.play().catch(() => showToast('音频播放失败', 'error'));
    });
    bubble.appendChild(btn);
  } else {
    const text = document.createElement('p');
    text.className = 'chat-bubble__text';
    text.textContent = message.content;
    bubble.appendChild(text);
  }

  const time = document.createElement('span');
  time.className = 'chat-time';
  time.textContent = formatClock(message.at);

  const main = document.createElement('div');
  main.className = 'chat-msg__main';
  main.append(bubble, time);

  if (message.from === 'me') row.append(main, avatar);
  else row.append(avatar, main);

  return row;
}

/** 渲染整段会话 */
function renderMessages(bodyEl, messages, owner) {
  bodyEl.textContent = '';

  if (messages.length === 0) {
    const tip = document.createElement('p');
    tip.className = 'chat-empty';
    tip.textContent = '还没有消息，打个招呼吧';
    bodyEl.appendChild(tip);
    return;
  }

  const fragment = document.createDocumentFragment();
  messages.forEach((msg) => fragment.appendChild(createBubble(msg, owner)));
  bodyEl.appendChild(fragment);
}

/** 滚动到底部 */
function scrollToBottom(bodyEl, smooth = false) {
  bodyEl.scrollTo({ top: bodyEl.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

/**
 * 打开聊天窗口
 * @param {{item: object, owner: object}} context
 */
export function openChat(context = {}) {
  const { item, owner } = context;
  if (!item || !owner) return;

  if (panel) closeChat();

  const key = `chat_${item.id}_${owner.id}`;
  let messages = readMessages(key);

  // 首次进入：放一条出借人的欢迎语，避免空白
  if (messages.length === 0) {
    messages = [
      {
        id: `m${Date.now()}`,
        from: 'them',
        type: 'text',
        content: '你好～这件物品还在的，有需要可以问我。',
        at: Date.now(),
      },
    ];
    writeMessages(key, messages);
  }

  const mask = document.createElement('div');
  mask.className = 'chat-mask';

  const box = document.createElement('section');
  box.className = 'chat-panel';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', `与 ${owner.nickname} 聊天`);

  /* 头部 */
  const head = document.createElement('header');
  head.className = 'chat-head';

  const headAvatar = document.createElement('span');
  headAvatar.className = 'chat-avatar chat-avatar--head';
  headAvatar.textContent = String(owner.nickname || 'Ta').slice(0, 1);

  const headTitle = document.createElement('div');
  headTitle.className = 'chat-head__title';
  const name = document.createElement('strong');
  name.textContent = owner.nickname || '出借人';
  const sub = document.createElement('span');
  sub.textContent = `关于「${item.title}」`;
  headTitle.append(name, sub);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'chat-close';
  closeBtn.setAttribute('aria-label', '关闭聊天');
  closeBtn.textContent = '×';

  head.append(headAvatar, headTitle, closeBtn);

  /* 消息区 */
  const bodyEl = document.createElement('div');
  bodyEl.className = 'chat-body';

  /* 输入区 */
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

  box.append(head, bodyEl, footer);
  mask.appendChild(box);
  document.body.appendChild(mask);
  document.body.classList.add('chat-open');

  renderMessages(bodyEl, messages, owner);
  requestAnimationFrame(() => scrollToBottom(bodyEl));

  /** 追加消息 */
  function pushMessage(message) {
    messages.push(message);
    writeMessages(key, messages);
    bodyEl.appendChild(createBubble(message, owner));
    scrollToBottom(bodyEl, true);
  }

  /** 发送文本 */
  function sendText() {
    const value = textInput.value.trim();
    if (!value) return;

    pushMessage({ id: `m${Date.now()}`, from: 'me', type: 'text', content: value, at: Date.now() });
    textInput.value = '';
    textInput.focus();
  }

  sendBtn.addEventListener('click', sendText);
  textInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendText();
    }
  });

  /* 图片 */
  imgBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;

    try {
      const dataUrl = await compressImage(file);
      pushMessage({
        id: `m${Date.now()}`,
        from: 'me',
        type: 'image',
        content: dataUrl,
        at: Date.now(),
      });
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
          pushMessage({
            id: `m${Date.now()}`,
            from: 'me',
            type: 'audio',
            content: dataUrl,
            duration,
            at: Date.now(),
          });
        } catch (error) {
          showToast(error.message || '语音发送失败', 'error');
        }
      };

      recorder.start();
      voiceBtn.classList.add('is-recording');
      voiceBtn.textContent = '⏹';
      showToast('录音中，再点一次结束', 'success');

      timerId = setInterval(() => {
        const seconds = Math.round((Date.now() - startedAt) / 1000);
        textInput.placeholder = `录音中… ${seconds}s（再点 🎤 结束）`;
      }, 500);
    } catch (error) {
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

  closeBtn.addEventListener('click', closeChat);
  mask.addEventListener('click', (event) => {
    if (event.target === mask) closeChat();
  });

  const onKeydown = (event) => {
    if (event.key === 'Escape') closeChat();
  };
  document.addEventListener('keydown', onKeydown);

  panel = {
    mask,
    close: () => {
      document.removeEventListener('keydown', onKeydown);
      if (timerId) clearInterval(timerId);
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
      mask.remove();
      document.body.classList.remove('chat-open');
      panel = null;
    },
  };
}

/** 关闭聊天 */
export function closeChat() {
  if (panel) panel.close();
}

export default { openChat, closeChat };
