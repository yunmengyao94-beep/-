/**
 * 物品图片本地仓库（浏览器端）
 * ---------------------------------------------------------------------------
 * 背景：图片不上传服务器，但用户希望在列表/详情看到自己发布的图。
 * 方案：发布成功后把压缩后的 Base64（WebP，最长边 512）存进 localStorage，
 *       按 item_id 关联；列表/详情/订单渲染时优先取本地图，取不到再用关键词插画。
 *
 * 容量控制：
 *   · 单件物品最多 9 张
 *   · 最多保留 30 件物品的图片
 *   · 估算体积超过 ~2.5MB 时，按时间淘汰最旧的物品
 */

const STORAGE_KEY = 'yxx_item_images';
const MAX_ITEMS = 30;
const MAX_IMAGES_PER_ITEM = 9;
const MAX_TOTAL_CHARS = 2.5 * 1024 * 1024; // localStorage 通常 5MB，留一半余量
/** 访问时间戳的刷新间隔：1 小时内不重复写库 */
const TOUCH_INTERVAL = 60 * 60 * 1000;

/** 读取全部记录 { [itemId]: { urls: string[], at: number } } */
function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** 写入（返回是否成功，便于在配额不足时降级） */
function writeAll(map) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}

/** 估算总字符数 */
function totalChars(map) {
  return Object.values(map).reduce((sum, record) => {
    const urls = record && Array.isArray(record.urls) ? record.urls : [];
    return sum + urls.reduce((n, url) => n + String(url).length, 0);
  }, 0);
}

/** 按时间淘汰最旧的若干条，直到满足条件 */
function evict(map, predicate) {
  const entries = Object.entries(map).sort((a, b) => (a[1].at || 0) - (b[1].at || 0));

  while (entries.length > 0 && !predicate(map)) {
    const [key] = entries.shift();
    delete map[key];
  }
}

/**
 * 保存某件物品的图片
 * @param {number|string} itemId
 * @param {string[]} urls Base64 dataURL 列表
 * @returns {boolean} 是否写入成功
 */
export function saveItemImages(itemId, urls) {
  const id = String(itemId || '').trim();
  if (!id || !Array.isArray(urls) || urls.length === 0) return false;

  const map = readAll();
  map[id] = {
    urls: urls
      .filter((url) => typeof url === 'string' && url.startsWith('data:image'))
      .slice(0, MAX_IMAGES_PER_ITEM),
    at: Date.now(),
  };

  const fits = (data) =>
    Object.keys(data).length <= MAX_ITEMS && totalChars(data) <= MAX_TOTAL_CHARS;
  evict(map, fits);

  let ok = writeAll(map);

  // 配额仍不足：继续淘汰最旧的，直到写得进去
  while (!ok && Object.keys(map).length > 1) {
    const oldest = Object.entries(map).sort((a, b) => (a[1].at || 0) - (b[1].at || 0))[0];
    if (!oldest) break;
    delete map[oldest[0]];
    ok = writeAll(map);
  }

  return ok;
}

/**
 * 记录一次访问时间（LRU 淘汰依据），写库有节流
 * @param {string} id
 */
function touchItem(id) {
  const map = readAll();
  const record = map[id];
  if (!record || (record.readAt && Date.now() - record.readAt < TOUCH_INTERVAL)) return;

  record.readAt = Date.now();
  record.at = Date.now(); // 兼容旧记录
  writeAll(map);
}

/**
 * 读取某件物品的全部本地图片
 * @param {number|string} itemId
 * @returns {string[]}
 */
export function getItemImages(itemId) {
  const id = String(itemId || '');
  const record = readAll()[id];
  if (!record) return [];

  touchItem(id);

  return Array.isArray(record.urls) ? record.urls.filter(Boolean) : [];
}

/**
 * 读取某件物品的封面图（没有则返回空字符串）
 * @param {number|string} itemId
 * @returns {string}
 */
export function getItemCover(itemId) {
  const list = getItemImages(itemId);
  return list.length > 0 ? list[0] : '';
}

/**
 * 删除某件物品的本地图片（物品下架/删除时调用，防止 localStorage 泄漏）
 * @param {number|string} itemId
 * @returns {boolean} 是否确实删除了一条记录
 */
export function removeItemImages(itemId) {
  const id = String(itemId || '').trim();
  if (!id) return false;

  const map = readAll();
  if (!(id in map)) return false;

  delete map[id];
  writeAll(map);
  return true;
}

/** 清空本地图片（设置页「清除缓存」可调用） */
export function clearItemImages() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 忽略
  }
}
