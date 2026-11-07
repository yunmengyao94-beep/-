/**
 * 登录页
 * ---------------------------------------------------------------------------
 * 去 Mock 化后的流程：
 *   1. 学号格式校验：13 位、25 / 24 开头
 *   2. 本地账号库比对学号 + 密码（utils/accounts-db.js）
 *   3. 校验通过后向服务端换取 JWT（服务端只负责签发 Token）
 *   4. 写入 yxx_token / yxx_user → 跳回来源页或首页
 * 失败统一提示「学号或密码错误」，不区分"账号不存在 / 密码错"，避免撞库探测。
 */

import { request, setToken } from '../utils/request.js';
import { showToast } from '../components/feedback.js';
import { upsertAccount } from '../utils/accounts.js';
import { ensureAccountDB, verifyCredentials, isValidStudentNo } from '../utils/accounts-db.js';
import { bindAgreementLinks, bindTermsGate } from '../utils/agreement.js';

/** 与 utils/request.js 中的 TOKEN_KEY 保持一致 */
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
/** 是否已勾选同意条款（由 utils/agreement.js 的勾选门维护） */
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

/** 仅做「必填 + 格式」的前置校验，凭据校验交给账号库 */
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
  } else if (password.length < 6) {
    setError(errPassword, '密码至少 6 位');
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

  // 账号库比对
  const result = verifyCredentials(values.studentNo, values.password);
  if (!result.ok) {
    showToast('学号或密码错误', 'error');
    setError(errPassword, '学号或密码错误');
    return;
  }

  const account = result.account;

  submitting = true;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '登录中...';
  }

  try {
    const data = await request('/auth/login', {
      method: 'POST',
      body: { student_no: account.studentNo, password: values.password },
    });

    const token = data && data.token;
    if (!token) throw new Error('登录服务异常，请稍后重试');

    setToken(token);

    const user = {
      user_id: (data.user && data.user.user_id) || null,
      student_no: account.studentNo,
      nickname: account.name,
      real_name: account.name,
      college_code: account.college,
      building_loc: account.building,
      room_no: account.room,
    };

    try {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch {
      // 存储失败不影响本次登录（守卫会因缺少 token 再次跳回登录页）
    }

    upsertAccount({
      student_no: account.studentNo,
      nickname: account.name,
      real_name: account.name,
      user_id: user.user_id,
      token,
    });

    showToast(`欢迎回来，${account.name}`, 'success');
    window.location.href = readRedirect();
  } catch (error) {
    const message = (error && error.message) || '登录失败，请稍后重试';
    showToast(`登录失败：${message}`, 'error');
    submitting = false;
    if (submitBtn) {
      submitBtn.disabled = !isAgreed();
      submitBtn.textContent = '登录';
    }
  }
}

function init() {
  ensureAccountDB();

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
