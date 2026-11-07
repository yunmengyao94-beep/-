/**
 * 多账号本地存储
 * ---------------------------------------------------------------------------
 * 结构：localStorage.yxx_accounts = [
 *   { student_no, nickname, real_name, user_id, token, updated_at }
 * ]
 *
 * 说明：
 *   · 仅用于演示「多账号切换」；真实项目不应把多个 JWT 长期明文存在本地，
 *     应使用短生命周期 token + 服务端会话（Refresh Token 存 HttpOnly Cookie）。
 *   · 最多保留 5 个账号，按最近使用排序。
 */

const ACCOUNTS_KEY = 'yxx_accounts';
const MAX_ACCOUNTS = 5;

/** 读取账号列表（保证是数组） */
export function listAccounts() {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((item) => item && item.student_no) : [];
  } catch {
    return [];
  }
}

function writeAccounts(list) {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list.slice(0, MAX_ACCOUNTS)));
  } catch {
    // 存储不可用：忽略
  }
}

/**
 * 新增或更新一个账号（按学号去重）
 * @param {{student_no: string, nickname?: string, real_name?: string, user_id?: number, token: string}} account
 */
export function upsertAccount(account) {
  if (!account || !account.student_no) return listAccounts();

  const record = {
    student_no: account.student_no,
    nickname: account.nickname || account.real_name || '同学',
    real_name: account.real_name || '',
    user_id: account.user_id ?? null,
    token: account.token || '',
    updated_at: Date.now(),
  };

  const rest = listAccounts().filter((item) => item.student_no !== record.student_no);
  const next = [record, ...rest];
  writeAccounts(next);
  return next;
}

/** 删除某个账号 */
export function removeAccount(studentNo) {
  const next = listAccounts().filter((item) => item.student_no !== studentNo);
  writeAccounts(next);
  return next;
}

/** 按学号查找 */
export function findAccount(studentNo) {
  return listAccounts().find((item) => item.student_no === studentNo) || null;
}

/** 清空所有账号 */
export function clearAccounts() {
  try {
    localStorage.removeItem(ACCOUNTS_KEY);
  } catch {
    // 忽略
  }
}
