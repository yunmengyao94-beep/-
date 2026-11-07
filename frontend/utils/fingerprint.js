/**
 * 文本 / 图片内容指纹
 * ---------------------------------------------------------------------------
 * 优先用 WebCrypto 的 SHA-256（安全上下文：https 或 localhost），
 * 不可用时降级为 FNV-1a，保证离线/老浏览器也能得到稳定短哈希。
 */

/**
 * 计算字符串指纹
 * @param {string} text
 * @returns {Promise<string>} 十六进制字符串（SHA-256 前 32 位 / FNV 8 位）
 */
export async function fingerprintText(text) {
  const source = String(text ?? '');

  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
      const bytes = new TextEncoder().encode(source);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest))
        .slice(0, 16)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    // 降级
  }

  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export default fingerprintText;
