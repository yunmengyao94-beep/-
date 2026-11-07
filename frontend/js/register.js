/**
 * 注册页
 * ---------------------------------------------------------------------------
 * Mock 阶段没有注册接口：
 *   1. 本地校验全部字段
 *   2. 弹出成功提示
 *   3. 约 0.9s 后带学号回到登录页（登录页自动填充学号）
 * 真实实现应调用 POST /api/v1/auth/register，并把密码做 bcrypt 后入库。
 */

import { showToast } from '../components/feedback.js';

const form = document.getElementById('register-form');
const studentNoInput = document.getElementById('reg-student-no');
const nameInput = document.getElementById('reg-name');
const collegeInput = document.getElementById('reg-college');
const buildingSelect = document.getElementById('reg-building');
const passwordInput = document.getElementById('reg-password');
const submitBtn = document.getElementById('register-btn');

const ERROR_NODES = {
  studentNo: document.getElementById('err-reg-student-no'),
  name: document.getElementById('err-reg-name'),
  college: document.getElementById('err-reg-college'),
  building: document.getElementById('err-reg-building'),
  password: document.getElementById('err-reg-password'),
};

const REDIRECT_DELAY = 900;

/** 显示/清除字段错误 */
function setError(node, message) {
  if (!node) return;
  node.textContent = message || '';
  node.classList.toggle('hidden', !message);
}

/** 清空所有字段错误 */
function clearErrors() {
  Object.values(ERROR_NODES).forEach((node) => setError(node, ''));
}

/** 校验，返回 values 或 null */
function validate() {
  const studentNo = studentNoInput ? studentNoInput.value.trim() : '';
  const name = nameInput ? nameInput.value.trim() : '';
  const college = collegeInput ? collegeInput.value.trim() : '';
  const building = buildingSelect ? buildingSelect.value : '';
  const password = passwordInput ? passwordInput.value : '';

  const errors = {};

  if (!studentNo) errors.studentNo = '请输入学号';
  else if (!/^\d{6,20}$/.test(studentNo)) errors.studentNo = '学号应为 6–20 位数字';

  if (!name) errors.name = '请输入姓名';
  else if (name.length < 2) errors.name = '姓名至少 2 个字符';

  if (!college) errors.college = '请输入学院';

  if (!building) errors.building = '请选择楼栋';

  if (!password) errors.password = '请输入密码';
  else if (password.length < 6) errors.password = '密码至少 6 位';

  Object.entries(errors).forEach(([key, message]) => setError(ERROR_NODES[key], message));

  if (Object.keys(errors).length > 0) return null;

  return { studentNo, name, college, building, password };
}

/** 提交注册（纯前端模拟） */
function handleRegister(event) {
  if (event) event.preventDefault();

  clearErrors();
  const values = validate();

  if (!values) {
    showToast('请检查表单填写', 'error');
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '注册中...';
  }

  // 模拟一次网络往返
  setTimeout(() => {
    showToast('注册成功，正在返回登录页', 'success');
    setTimeout(() => {
      window.location.href = `./login.html?student_no=${encodeURIComponent(values.studentNo)}`;
    }, REDIRECT_DELAY);
  }, 400);
}

function init() {
  if (form) form.addEventListener('submit', handleRegister);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
