/**
 * 注册页
 * ---------------------------------------------------------------------------
 * 流程：本地格式校验 → POST /api/v1/auth/register（服务端建账号 + 建用户）
 *       → Toast → 带学号跳回登录页
 * 说明：密码只提交给服务端（scrypt 哈希入库），前端不留任何副本。
 */

import { request } from '../utils/request.js';
import { showToast } from '../components/feedback.js';
import { isValidStudentNo, isValidRoom, PASSWORD_MIN_LENGTH } from '../utils/accounts-db.js';
import { bindAgreementLinks, bindTermsGate } from '../utils/agreement.js';
import { checkThrottle, markThrottle } from '../utils/rate-limit.js';

const form = document.getElementById('register-form');
const studentNoInput = document.getElementById('reg-student-no');
const nameInput = document.getElementById('reg-name');
const collegeInput = document.getElementById('reg-college');
const buildingSelect = document.getElementById('reg-building');
const roomInput = document.getElementById('reg-room');
const passwordInput = document.getElementById('reg-password');
const submitBtn = document.getElementById('register-btn');

const ERROR_NODES = {
  studentNo: document.getElementById('err-reg-student-no'),
  name: document.getElementById('err-reg-name'),
  college: document.getElementById('err-reg-college'),
  building: document.getElementById('err-reg-building'),
  room: document.getElementById('err-reg-room'),
  password: document.getElementById('err-reg-password'),
};

const REDIRECT_DELAY = 900;

/** 是否已勾选同意条款 */
let isAgreed = () => false;
let submitting = false;

function setError(node, message) {
  if (!node) return;
  node.textContent = message || '';
  node.classList.toggle('hidden', !message);
}

function clearErrors() {
  Object.values(ERROR_NODES).forEach((node) => setError(node, ''));
}

/** 校验，返回 values 或 null */
function validate() {
  const studentNo = studentNoInput ? studentNoInput.value.trim() : '';
  const name = nameInput ? nameInput.value.trim() : '';
  const college = collegeInput ? collegeInput.value.trim() : '';
  const building = buildingSelect ? buildingSelect.value : '';
  const room = roomInput ? roomInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value : '';

  const errors = {};

  if (!studentNo) errors.studentNo = '请输入学号';
  else if (!isValidStudentNo(studentNo))
    errors.studentNo = '学号需为 13 位数字，且以 25 或 24 开头';

  if (!name) errors.name = '请输入姓名';
  else if (name.length < 2) errors.name = '姓名至少 2 个字符';

  if (!college) errors.college = '请输入学院';

  if (!building) errors.building = '请选择楼栋';

  if (!room) errors.room = '请输入房间号';
  else if (!isValidRoom(room)) errors.room = '房间号需为 3 位数字，例如 501';

  if (!password) errors.password = '请输入密码';
  else if (password.length < PASSWORD_MIN_LENGTH) {
    errors.password = `密码至少 ${PASSWORD_MIN_LENGTH} 位`;
  }

  Object.entries(errors).forEach(([key, message]) => setError(ERROR_NODES[key], message));

  if (Object.keys(errors).length > 0) return null;

  return { studentNo, name, college, building, room, password };
}

async function handleRegister(event) {
  if (event) event.preventDefault();
  if (submitting) return;

  if (!isAgreed()) {
    showToast('请先阅读并同意《用户协议》和《隐私政策》', 'error');
    return;
  }

  clearErrors();
  const values = validate();

  if (!values) {
    showToast('请检查表单填写', 'error');
    return;
  }

  // 前端限流：同一设备 60 秒只能提交一次注册
  const gate = checkThrottle('register');
  if (!gate.allowed) {
    showToast(`操作过于频繁，请 ${gate.waitSeconds} 秒后再试`, 'error');
    return;
  }

  submitting = true;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '注册中...';
  }

  try {
    await request('/auth/register', {
      method: 'POST',
      body: {
        student_no: values.studentNo,
        password: values.password,
        name: values.name,
        college: values.college,
        building: values.building,
        room: values.room,
      },
    });

    markThrottle('register');
    showToast('注册成功，请使用新账号登录', 'success');

    setTimeout(() => {
      window.location.href = `./login.html?student_no=${encodeURIComponent(values.studentNo)}`;
    }, REDIRECT_DELAY);
  } catch (error) {
    const message = (error && error.message) || '注册失败，请稍后重试';
    showToast(message, 'error');

    if (error && error.code === 40902) {
      setError(ERROR_NODES.studentNo, '该学号已注册，请直接登录');
    }

    submitting = false;
    if (submitBtn) {
      submitBtn.disabled = !isAgreed();
      submitBtn.textContent = '注册';
    }
  }
}

function init() {
  isAgreed = bindTermsGate(document.getElementById('agree-terms'), submitBtn);
  bindAgreementLinks();

  if (form) form.addEventListener('submit', handleRegister);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
