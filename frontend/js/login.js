/**
 * 登录页
 * ---------------------------------------------------------------------------
 * 流程：格式校验 → POST /api/v1/auth/login（服务端校验学号 + scrypt 密码）
 *       → 写入 yxx_token / yxx_user → 跳回来源页或首页
 * 说明：前端不保存任何密码，凭据校验完全在服务端完成（P0-3 / P0-4）。
 */

import { request, setToken } from '../utils/request.js';
import { showToast } from '../components/feedback.js';
import { upsertAccount } from '../utils/accounts.js';
import { isValidStudentNo, PASSWORD_MIN_LENGTH } from '../utils/accounts-db.js';
import { bindAgreementLinks, bindTermsGate } from '../utils/agreement.js';

const TOKEN_KEY = 'yxx_token';
const USER_KEY = 'yxx_user';
const DEFAULT_REDIRECT = './index.html';

const form = document.getElementById('login-form');
const studentNoInput = document.getElementById('login-student-no');
const passwordInput = document.getElementById('login-password');
const submitBtn = document.getElementById('login-btn');
const errStudentNo = document.getElementById('err-student-no');
const errPassword = document.getElementById('err-password');

let submitting = false;
/** 是否已勾选同意条款 */
let isAgreed = () => false;

/** 从 query 中取回跳地址（只允许站内相对路径，防开放重定向） */
function readRedirect() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('redirect') || '';
  if (!raw) return DEFAULT_REDIRECT;

  if (/^https?:\/\//i.test(raw) || raw.startsWith('//')) return DEFAULT_REDIRECT;
  return raw.startsWith('/') || raw.startsWith('.') ? raw : `./${raw}`;
}

function setError(node, message) {
  if (!node) return;
  node.textContent = message || '';
  node.classList.toggle('hidden', !message);
}

/** 仅校验格式，凭据交给服务端 */
function validateFormat() {
  const studentNo = studentNoInput ? studentNoInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value : '';

  let ok = true;

  if (!studentNo) {
    setError(errStudentNo, '请输入学号');
    ok = false;
  } else if (!isValidStudentNo(studentNo)) {
    setError(errStudentNo, '学号需为 13 位数字，且以 25 或 24 开头');
    ok = false;
  } else {
    setError(errStudentNo, '');
  }

  if (!password) {
    setError(errPassword, '请输入密码');
    ok = false;
  } else if (password.length < PASSWORD_MIN_LENGTH) {
    setError(errPassword, `密码至少 ${PASSWORD_MIN_LENGTH} 位`);
    ok = false;
  } else {
    setError(errPassword, '');
  }

  return ok ? { studentNo, password } : null;
}

async function handleLogin(event) {
  if (event) event.preventDefault();
  if (submitting) return;

  if (!isAgreed()) {
    showToast('请先阅读并同意《用户协议》和《隐私政策》', 'error');
    return;
  }

  const values = validateFormat();
  if (!values) return;

  submitting = true;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '登录中...';
  }

  try {
    const data = await request('/auth/login', {
      method: 'POST',
      body: { student_no: values.studentNo, password: values.password },
    });

    const token = data && data.token;
    if (!token) throw new Error('登录服务异常，请稍后重试');

    setToken(token);

    const serverUser = (data && data.user) || {};
    const user = {
      user_id: serverUser.user_id,
      student_no: serverUser.student_no || values.studentNo,
      nickname: serverUser.nickname || '同学',
      real_name: serverUser.real_name || serverUser.nickname || '',
      college_code: serverUser.college_code || '',
      building_loc: serverUser.building_loc || '',
      room_no: serverUser.room_no || '',
    };

    try {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch {
      // 存储失败不影响本次登录（守卫会因缺少 token 再次跳回登录页）
    }

    upsertAccount({
      student_no: user.student_no,
      nickname: user.nickname,
      real_name: user.real_name,
      user_id: user.user_id,
      token,
    });

    showToast(`欢迎回来，${user.nickname}`, 'success');
    window.location.href = readRedirect();
  } catch (error) {
    const message = (error && error.message) || '登录失败，请稍后重试';

    if (error && error.code === 40303) {
      // 白名单用户尚未激活：直接把用户引到注册页
      showToast(message, 'error');
      setError(errStudentNo, message);

      const toRegister = document.getElementById('go-register');
      if (toRegister) {
        toRegister.classList.add('is-highlight');
        toRegister.focus();
      }
    } else {
      showToast(message === '学号或密码错误' ? message : `登录失败：${message}`, 'error');
      setError(errPassword, error && error.code === 40102 ? '学号或密码错误' : '');
    }

    submitting = false;
    if (submitBtn) {
      submitBtn.disabled = !isAgreed();
      submitBtn.textContent = '登录';
    }
  }
}

function init() {
  try {
    if (localStorage.getItem(TOKEN_KEY)) {
      window.location.replace(readRedirect());
      return;
    }
  } catch {
    // 忽略
  }

  try {
    const preset = new URLSearchParams(window.location.search).get('student_no');
    if (preset && studentNoInput) studentNoInput.value = preset;
  } catch {
    // 忽略
  }

  // 协议勾选门 + 协议弹窗
  isAgreed = bindTermsGate(document.getElementById('agree-terms'), submitBtn);
  bindAgreementLinks();

  if (form) form.addEventListener('submit', handleLogin);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
