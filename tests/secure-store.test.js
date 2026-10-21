/**
 * 加密存储模块单元测试
 * 运行：node tests/secure-store.test.js
 *
 * 覆盖：SHA-256 / HMAC-SHA256 标准向量、加解密往返、篡改检测、
 *       换设备解密失败、storage 封装与旧明文迁移。
 */
'use strict'

// ==================== 极简 wx 桩 ====================
const storage = {}
let deviceInfo = { brand: 'Apple', model: 'iPhone 13', system: 'iOS 16.0', platform: 'ios' }

global.wx = {
  getStorageSync(key) {
    return key in storage ? storage[key] : ''
  },
  setStorageSync(key, value) {
    storage[key] = value
  },
  removeStorageSync(key) {
    delete storage[key]
  },
  getDeviceInfo() {
    return deviceInfo
  },
  getAccountInfoSync() {
    return { miniProgram: { appId: 'wxe071ce7f92759377' } }
  }
}

const S = require('../miniprogram/utils/secure-store.js')

// ==================== 断言工具 ====================
let passed = 0
let failed = 0

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    passed++
    console.log(`  ✔ ${name}`)
  } else {
    failed++
    console.log(`  ✘ ${name}\n      期望: ${JSON.stringify(expected)}\n      实际: ${JSON.stringify(actual)}`)
  }
}

function group(title) {
  console.log(`\n${title}`)
}

const utf8 = (text) => Array.from(Buffer.from(text, 'utf8'))
const hex = (bytes) => bytes.map(b => b.toString(16).padStart(2, '0')).join('')

// ==================== 1. 哈希实现正确性（标准向量） ====================
group('1. SHA-256 / HMAC 标准向量')
check('sha256("")', hex(S.sha256([])), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
check('sha256("abc")', hex(S.sha256(utf8('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
check(
  'sha256(448bit 消息)',
  hex(S.sha256(utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))),
  '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
)
check(
  'hmac-sha256("key", fox)',
  hex(S.hmacSha256(utf8('key'), utf8('The quick brown fox jumps over the lazy dog'))),
  'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8'
)

// ==================== 2. 加解密往返 ====================
group('2. 加解密往返')
const secret = 'P@ssw0rd-中文-🔐-123456'
const payload = S.encrypt(secret)
check('密文带版本前缀', payload.indexOf(S.CIPHER_PREFIX), 0)
check('密文不含明文片段', payload.includes('P@ssw0rd'), false)
check('解密还原（含中文与 emoji）', S.decrypt(payload), secret)
check('同明文两次密文不同（随机 IV）', S.encrypt(secret) !== payload, true)
check('长文本往返', (() => {
  const long = '学号202312345678'.repeat(200)
  return S.decrypt(S.encrypt(long)) === long
})(), true)
check('空字符串往返', S.decrypt(S.encrypt('')), '')

// ==================== 3. 篡改与异常输入 ====================
group('3. 篡改检测与异常输入')
const tampered = payload.slice(0, payload.length - 4) + 'AAAA'
check('篡改尾部导致解密失败', S.decrypt(tampered), null)
check('缺少前缀返回 null', S.decrypt('abcdefg'), null)
check('空值返回 null', S.decrypt(''), null)
check('null 返回 null', S.decrypt(null), null)
check('超短密文返回 null', S.decrypt(S.CIPHER_PREFIX + 'AAAA'), null)

// ==================== 4. 换设备解不开 ====================
group('4. 设备绑定')
deviceInfo = { brand: 'HUAWEI', model: 'P60', system: 'Android 13', platform: 'android' }
S._resetKeyCache()
check('换设备后解密失败', S.decrypt(payload), null)
deviceInfo = { brand: 'Apple', model: 'iPhone 13', system: 'iOS 16.0', platform: 'ios' }
S._resetKeyCache()
check('换回原设备可解密', S.decrypt(payload), secret)

// ==================== 5. 存储封装 ====================
group('5. storage 封装')
S.setSecret('savedPassword', 'hunter2')
check('storage 里不是明文', String(storage.savedPassword).includes('hunter2'), false)
check('storage 里是密文', String(storage.savedPassword).indexOf(S.CIPHER_PREFIX), 0)
check('getSecret 取回明文', S.getSecret('savedPassword'), 'hunter2')

S.setSecret('savedPassword', '')
check('存空值等于删除', S.getSecret('savedPassword'), '')

storage.savedPassword = 'legacy-plain-text'
check('旧明文被迁移', S.migrateLegacy('savedPassword'), true)
check('迁移后是密文', String(storage.savedPassword).indexOf(S.CIPHER_PREFIX), 0)
check('迁移后可读', S.getSecret('savedPassword'), 'legacy-plain-text')
check('已加密的不再重复迁移', S.migrateLegacy('savedPassword'), false)

S.removeSecret('savedPassword')
check('删除后为空', S.getSecret('savedPassword'), '')
check('删除后 storage 无残留', 'savedPassword' in storage, false)

// ==================== 汇总 ====================
console.log(`\n${'='.repeat(46)}`)
console.log(`通过 ${passed} 项，失败 ${failed} 项`)
console.log('='.repeat(46))
process.exit(failed === 0 ? 0 : 1)
