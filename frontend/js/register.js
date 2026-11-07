/**
 * 注册页
 * ---------------------------------------------------------------------------
 * 去 Mock 化后：注册写入本地账号库（utils/accounts-db.js），
 * 之后即可用该学号 + 密码在登录页登录。
 */

import { showToast } from '../components/feedback.js';
import {
  ensureAccountDB,
  addAccount,
  findAccount,
  isValidStudentNo,
} from '../utils/accounts-db.js';

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
  else if (findAccount(studentNo)) errors.studentNo = '该学号已注册，请直接登录';

  if (!name) errors.name = '请输入姓名';
  else if (name.length < 2) errors.name = '姓名至少 2 个字符';

  if (!college) errors.college = '请输入学院';

  if (!building) errors.building = '请选择楼栋';

  if (!room) errors.room = '请输入宿舍号';

  if (!password) errors.password = '请输入密码';
  else if (password.length < 6) errors.password = '密码至少 6 位';

  Object.entries(errors).forEach(([key, message]) => setError(ERROR_NODES[key], message));

  if (Object.keys(errors).length > 0) return null;

  return { studentNo, name, college, building, room, password };
}

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

  ensureAccountDB();

  setTimeout(() => {
    const result = addAccount(values);

    if (!result.ok) {
      showToast('该学号已注册，请直接登录', 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '注册';
      }
      return;
    }

    showToast('注册成功，请使用新账号登录', 'success');
    setTimeout(() => {
      window.location.href = `./login.html?student_no=${encodeURIComponent(values.studentNo)}`;
    }, REDIRECT_DELAY);
  }, 400);
}

function init() {
  ensureAccountDB();
  if (form) form.addEventListener('submit', handleRegister);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
