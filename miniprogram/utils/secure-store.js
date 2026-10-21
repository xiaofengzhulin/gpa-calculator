/**
 * 本地敏感数据（学号 / 密码）加密存储
 *
 * 小程序没有内置的加解密 API，这里零依赖实现一套「SHA-256 做 PRF 的 CTR 流密码
 * + HMAC-SHA256 完整性校验（encrypt-then-MAC）」：
 *
 *   - 本地缓存里只存密文，直接查看 storage 看不到密码
 *   - 密钥由设备信息 + 应用内置盐派生，**不落盘**；密文拷贝到别的设备解不开
 *   - 密文被篡改 / 换机 / 换系统版本时校验失败，安全降级为「没有保存过密码」
 *
 * 诚实说明：任何纯客户端加密都只能做到「不明文落盘 + 提高逆向成本」，
 * 无法对抗能完整调试本机的人。目标是避免密码以明文躺在缓存里（以及被备份、被截图工具读取）。
 */

const APP_SALT = 'gpa-calculator::secure-store::v1'
const CIPHER_PREFIX = 'enc:v1:'
const IV_BYTES = 16
const TAG_BYTES = 16
const BLOCK_BYTES = 32

// ==================== SHA-256 ====================
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]

const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0

/**
 * @param {Array<number>} input 字节数组
 * @returns {Array<number>} 32 字节摘要
 */
const sha256 = (input) => {
  const bytes = input.slice()
  const bitLen = bytes.length * 8
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  bytes.push(0, 0, 0, 0)
  bytes.push((bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff)

  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  const w = new Array(64)

  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      const p = off + i * 4
      w[i] = ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]
      const y = w[i - 2]
      const s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0
      const s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }

    let a = H[0]
    let b = H[1]
    let c = H[2]
    let d = H[3]
    let e = H[4]
    let f = H[5]
    let g = H[6]
    let h = H[7]

    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0
      const ch = ((e & f) ^ (~e & g)) >>> 0
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0
      const temp2 = (S0 + maj) >>> 0

      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }

    H[0] = (H[0] + a) >>> 0
    H[1] = (H[1] + b) >>> 0
    H[2] = (H[2] + c) >>> 0
    H[3] = (H[3] + d) >>> 0
    H[4] = (H[4] + e) >>> 0
    H[5] = (H[5] + f) >>> 0
    H[6] = (H[6] + g) >>> 0
    H[7] = (H[7] + h) >>> 0
  }

  const out = []
  for (let i = 0; i < 8; i++) {
    out.push((H[i] >>> 24) & 0xff, (H[i] >>> 16) & 0xff, (H[i] >>> 8) & 0xff, H[i] & 0xff)
  }
  return out
}

const hmacSha256 = (keyBytes, msgBytes) => {
  const key = keyBytes.length > 64 ? sha256(keyBytes) : keyBytes.slice()
  while (key.length < 64) key.push(0)
  const oKey = key.map(x => x ^ 0x5c)
  const iKey = key.map(x => x ^ 0x36)
  return sha256(oKey.concat(sha256(iKey.concat(msgBytes))))
}

// ==================== 编解码 ====================
const utf8ToBytes = (str) => {
  const text = String(str)
  const out = []
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00)
        i++
      }
    }
    if (code < 0x80) {
      out.push(code)
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    }
  }
  return out
}

const bytesToUtf8 = (bytes) => {
  let out = ''
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i]
    let code = 0
    let size = 1
    if (b < 0x80) {
      code = b
    } else if (b < 0xe0 && i + 1 < bytes.length) {
      code = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f)
      size = 2
    } else if (b < 0xf0 && i + 2 < bytes.length) {
      code = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f)
      size = 3
    } else if (i + 3 < bytes.length) {
      code = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f)
      size = 4
    } else {
      break
    }
    if (code > 0xffff) {
      code -= 0x10000
      out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff))
    } else {
      out += String.fromCharCode(code)
    }
    i += size
  }
  return out
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const base64Encode = (bytes) => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0
    const triple = (b0 << 16) | (b1 << 8) | b2
    out += B64[(triple >>> 18) & 63]
    out += B64[(triple >>> 12) & 63]
    out += i + 1 < bytes.length ? B64[(triple >>> 6) & 63] : '='
    out += i + 2 < bytes.length ? B64[triple & 63] : '='
  }
  return out
}

const base64Decode = (str) => {
  const clean = String(str).replace(/[^A-Za-z0-9+/=]/g, '')
  const out = []
  let buffer = 0
  let bits = 0
  for (let i = 0; i < clean.length; i++) {
    const ch = clean.charAt(i)
    if (ch === '=') break
    const value = B64.indexOf(ch)
    if (value < 0) continue
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buffer >> bits) & 0xff)
    }
  }
  return out
}

// ==================== 随机数 / 密钥 ====================
const randomBytes = (length) => {
  const out = []
  try {
    if (typeof wx !== 'undefined' && typeof wx.getRandomValues === 'function') {
      const buffer = wx.getRandomValues({ length })
      const view = new Uint8Array(buffer)
      for (let i = 0; i < length && i < view.length; i++) out.push(view[i])
      if (out.length === length) return out
      out.length = 0
    }
  } catch (e) {
    out.length = 0
  }
  // 兜底：设备不支持安全随机数时退化为伪随机（IV 唯一性要求，而不是保密性）
  for (let i = 0; i < length; i++) out.push(Math.floor(Math.random() * 256))
  return out
}

/**
 * 设备指纹：只取稳定的字段，避免系统/微信升级后解不开
 * @returns {string}
 */
const deviceFingerprint = () => {
  const parts = []
  try {
    if (typeof wx !== 'undefined' && typeof wx.getDeviceInfo === 'function') {
      const info = wx.getDeviceInfo() || {}
      parts.push(info.brand, info.model, info.system, info.platform)
    } else if (typeof wx !== 'undefined' && typeof wx.getSystemInfoSync === 'function') {
      const info = wx.getSystemInfoSync() || {}
      parts.push(info.brand, info.model, info.system, info.platform)
    }
  } catch (e) {
    // 取不到就用兜底串，保证功能可用
  }
  try {
    if (typeof wx !== 'undefined' && typeof wx.getAccountInfoSync === 'function') {
      const account = wx.getAccountInfoSync() || {}
      if (account.miniProgram && account.miniProgram.appId) parts.push(account.miniProgram.appId)
    }
  } catch (e) {
    // 忽略
  }
  const fingerprint = parts.filter(Boolean).join('|')
  return fingerprint || 'gpa-default-device'
}

let cachedKeys = null

const deriveKeys = () => {
  if (cachedKeys) return cachedKeys
  const master = sha256(utf8ToBytes(APP_SALT + '|' + deviceFingerprint()))
  cachedKeys = {
    enc: sha256(master.concat(utf8ToBytes('gpa-enc'))),
    mac: sha256(master.concat(utf8ToBytes('gpa-mac')))
  }
  return cachedKeys
}

// 仅测试用：设备信息变化后重新派生密钥
const _resetKeyCache = () => {
  cachedKeys = null
}

// ==================== 加解密 ====================
const ctrXor = (key, iv, data) => {
  const out = []
  let block = null
  for (let i = 0; i < data.length; i++) {
    if (i % BLOCK_BYTES === 0) {
      const counter = i / BLOCK_BYTES
      block = sha256(key.concat(iv, [
        (counter >>> 24) & 0xff, (counter >>> 16) & 0xff, (counter >>> 8) & 0xff, counter & 0xff
      ]))
    }
    out.push(data[i] ^ block[i % BLOCK_BYTES])
  }
  return out
}

const constantTimeEqual = (a, b) => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/**
 * 加密字符串（带版本前缀，便于以后换算法）
 * @param {string} plainText
 * @returns {string} enc:v1:<base64>
 */
const encrypt = (plainText) => {
  const keys = deriveKeys()
  const iv = randomBytes(IV_BYTES)
  const data = utf8ToBytes(plainText)
  const cipher = ctrXor(keys.enc, iv, data)
  const tag = hmacSha256(keys.mac, iv.concat(cipher)).slice(0, TAG_BYTES)
  return CIPHER_PREFIX + base64Encode(iv.concat(cipher, tag))
}

/**
 * 解密字符串，失败（篡改/换设备/格式不对）返回 null
 * @param {string} payload
 * @returns {string|null}
 */
const decrypt = (payload) => {
  try {
    const text = String(payload || '')
    if (text.indexOf(CIPHER_PREFIX) !== 0) return null
    const raw = base64Decode(text.slice(CIPHER_PREFIX.length))
    if (raw.length < IV_BYTES + TAG_BYTES) return null

    const iv = raw.slice(0, IV_BYTES)
    const tag = raw.slice(raw.length - TAG_BYTES)
    const cipher = raw.slice(IV_BYTES, raw.length - TAG_BYTES)

    const keys = deriveKeys()
    const expected = hmacSha256(keys.mac, iv.concat(cipher)).slice(0, TAG_BYTES)
    if (!constantTimeEqual(tag, expected)) return null

    return bytesToUtf8(ctrXor(keys.enc, iv, cipher))
  } catch (e) {
    return null
  }
}

// ==================== 存储封装 ====================
const setSecret = (storageKey, value) => {
  if (value === undefined || value === null || value === '') {
    wx.removeStorageSync(storageKey)
    return false
  }
  wx.setStorageSync(storageKey, encrypt(value))
  return true
}

const getSecret = (storageKey) => {
  const raw = wx.getStorageSync(storageKey)
  if (!raw || typeof raw !== 'string') return ''
  return decrypt(raw) || ''
}

const removeSecret = (storageKey) => {
  wx.removeStorageSync(storageKey)
}

/**
 * 旧版本把密码明文存在同一个 key 里，这里做一次性迁移：
 * 明文 → 密文；解不开的脏数据直接删掉，避免一直解不开。
 */
const migrateLegacy = (storageKey) => {
  const raw = wx.getStorageSync(storageKey)
  if (!raw || typeof raw !== 'string') return false
  if (raw.indexOf(CIPHER_PREFIX) === 0) return false
  setSecret(storageKey, raw)
  return true
}

module.exports = {
  CIPHER_PREFIX,
  encrypt,
  decrypt,
  setSecret,
  getSecret,
  removeSecret,
  migrateLegacy,
  // 供测试使用
  sha256,
  hmacSha256,
  _resetKeyCache
}
