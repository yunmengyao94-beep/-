/**
 * 本地账号库（去 Mock 化的账号体系）
 * ---------------------------------------------------------------------------
 * 说明：
 *   · 3 个预设账号硬编码在此，首次进入页面时写入 localStorage.yxx_account_db
 *   · 学号规则：13 位数字，且以 25 / 24 开头（25 = 2025 级，24 = 2024 级）
 *   · 这只是演示用的端侧账号体系；真实项目必须由服务端校验并只存密码哈希
 *
 * 用法：
 *   ensureAccountDB()                      // 初始化预设账号
 *   verifyCredentials(studentNo, password) // 登录校验
 *   addAccount(record)                     // 注册写入
 */

const ACCOUNT_DB_KEY = 'yxx_account_db';

/** 学号规则：13 位、25 或 24 开头 */
export const STUDENT_NO_PATTERN = /^(25|24)\d{11}$/;

/** 预设账号（首次启动写入本地） */
export const PRESET_ACCOUNTS = [
  {
    studentNo: '2508080110101',
    password: '123456',
    name: '张同学',
    college: '0801',
    building: '第7公寓',
    room: '502',
  },
  {
    studentNo: '2508080110102',
    password: '123456',
    name: '李同学',
    college: '0801',
    building: '第5公寓',
    room: '311',
  },
  {
    studentNo: '2408080110103',
    password: '123456',
    name: '王同学',
    college: '0802',
    building: '第3公寓',
    room: '208',
  },
];

/** 读取账号库（保证返回数组） */
export function getAccountDB() {
  try {
    const raw = localStorage.getItem(ACCOUNT_DB_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((item) => item && item.studentNo) : [];
  } catch {
    return [];
  }
}

/** 写入账号库 */
function saveAccountDB(list) {
  try {
    localStorage.setItem(ACCOUNT_DB_KEY, JSON.stringify(list));
  } catch {
    // 存储不可用时静默失败
  }
}

/**
 * 确保预设账号已写入（首次启动 / 账号库被清空时）
 * @returns {object[]} 当前账号库
 */
export function ensureAccountDB() {
  const existing = getAccountDB();
  if (existing.length > 0) return existing;

  saveAccountDB(PRESET_ACCOUNTS);
  return PRESET_ACCOUNTS.slice();
}

/** 学号格式校验 */
export function isValidStudentNo(studentNo) {
  return STUDENT_NO_PATTERN.test(String(studentNo || '').trim());
}

/** 按学号查找 */
export function findAccount(studentNo) {
  const no = String(studentNo || '').trim();
  return getAccountDB().find((item) => item.studentNo === no) || null;
}

/**
 * 校验学号 + 密码
 * @param {string} studentNo
 * @param {string} password
 * @returns {{ok: boolean, account?: object, reason?: 'format'|'credentials'|'incomplete'}}
 */
export function verifyCredentials(studentNo, password) {
  const no = String(studentNo || '').trim();
  const pwd = String(password || '');

  if (!no || !pwd) return { ok: false, reason: 'incomplete' };
  if (!isValidStudentNo(no)) return { ok: false, reason: 'format' };

  const account = findAccount(no);
  if (!account || account.password !== pwd) return { ok: false, reason: 'credentials' };

  return { ok: true, account };
}

/**
 * 注册写入账号库
 * @param {{studentNo: string, password: string, name: string, college: string, building: string, room: string}} record
 * @returns {{ok: boolean, reason?: 'exists'}}
 */
export function addAccount(record) {
  const list = ensureAccountDB();
  const no = String(record.studentNo || '').trim();

  if (list.some((item) => item.studentNo === no)) {
    return { ok: false, reason: 'exists' };
  }

  list.push({
    studentNo: no,
    password: String(record.password || ''),
    name: String(record.name || '').trim(),
    college: String(record.college || '').trim(),
    building: String(record.building || '').trim(),
    room: String(record.room || '').trim(),
  });

  saveAccountDB(list);
  return { ok: true };
}

/** 学号掩码：2508****101 */
export function maskStudentNo(studentNo) {
  const value = String(studentNo || '').trim();
  if (!value) return '——';
  if (value.includes('*')) return value;
  if (value.length <= 6) return `${value.slice(0, 1)}****`;
  return `${value.slice(0, 4)}****${value.slice(-2)}`;
}
