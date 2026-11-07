/**
 * 登录页
 * ---------------------------------------------------------------------------
 * 流程：校验 → POST /auth/login → 写入 yxx_token / yxx_user → 跳回来源页或首页
 * Mock：服务端只校验学号格式，密码不校验（真实实现需 bcrypt 比对）
 */

import { request, setToken } from '../utils/request.js';
import { showToast } from '../components/feedback.js';
import { upsertAccount } from '../utils/accounts.js';

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

/** 从 query 中取回跳地址（只允许站内相对路径，防开放重定向） */
function readRedirect() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('redirect') || '';
  if (!raw) return DEFAULT_REDIRECT;

  // 只接受同站相对路径
  if (/^https?:\/\//i.test(raw) || raw.startsWith('//')) return DEFAULT_REDIRECT;
  return raw.startsWith('/') || raw.startsWith('.') ? raw : `./${raw}`;
}

/** 显示/清除字段错误 */
function setError(node, message) {
  if (!node) return;
  node.textContent = message || '';
  node.classList.toggle('hidden', !message);
}

/** 表单校验 */
function validate() {
  const studentNo = studentNoInput ? studentNoInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value : '';

  let ok = true;

  if (!studentNo) {
    setError(errStudentNo, '请输入学号');
    ok = false;
  } else if (!/^\d{6,20}$/.test(studentNo)) {
    setError(errStudentNo, '学号应为 6–20 位数字');
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

/** 提交登录 */
async function handleLogin(event) {
  if (event) event.preventDefault();
  if (submitting) return;

  const values = validate();
  if (!values) {
    showToast('请检查学号与密码', 'error');
    return;
  }

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
    const user = (data && data.user) || {};

    if (!token) throw new Error('未返回 Token');

    setToken(token);

    try {
      localStorage.setItem(
        USER_KEY,
        JSON.stringify({
          user_id: user.user_id,
          student_no: user.student_no,
          real_name: user.real_name,
          nickname: user.real_name || '',
          college_code: user.college_code,
          building_loc: user.building_loc,
          credit_score: user.credit_score,
          credit_available: user.credit_available,
          credit_level: user.credit_level,
        })
      );
    } catch {
      // 存储失败不影响登录（守卫会因缺少 token 再次跳回登录页）
    }

    // 记录到多账号列表（Mock 演示用）
    upsertAccount({
      student_no: user.student_no || values.studentNo,
      nickname: user.real_name || '',
      real_name: user.real_name || '',
      user_id: user.user_id,
      token,
    });

    showToast('登录成功，正在进入…', 'success');
    window.location.href = readRedirect();
  } catch (error) {
    const message = (error && error.message) || '登录失败';
    showToast(`登录失败：${message}`, 'error');
    submitting = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '登录';
    }
  }
}

function init() {
  // 已登录直接进首页，避免重复登录
  try {
    if (localStorage.getItem(TOKEN_KEY)) {
      window.location.replace(readRedirect());
      return;
    }
  } catch {
    // 忽略
  }

  // 注册页回跳时可带学号，自动填充
  try {
    const preset = new URLSearchParams(window.location.search).get('student_no');
    if (preset && studentNoInput) studentNoInput.value = preset;
  } catch {
    // 忽略
  }

  if (form) form.addEventListener('submit', handleLogin);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
