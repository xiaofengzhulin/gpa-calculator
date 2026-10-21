/**
 * IP 频率限制测试
 * 运行：node tests/rate-limit.test.js
 *
 * 起真实的 server/server.js（PORT=3901），教务系统地址指向本地桩服务（JW_BASE_URL），
 * 因此不会真的访问外网，也不会等待超时。
 *
 * 说明：按学号的锁定逻辑见 tests/login-guard.test.js。
 * 本文件里的每个请求都用不同学号，避免触发失败锁定，从而只测 IP 维度。
 *
 * 覆盖：
 *   - 单 IP 20 次/分钟：第 21 次返回 429（scope=ip）
 *   - 响应头 X-RateLimit-Limit / X-RateLimit-Remaining
 *   - 429 带 Retry-After 与可读中文提示
 *   - 不同 IP 经 X-Forwarded-For / X-Real-IP 独立计数
 *   - 请求体超过 16KB 返回 413
 *   - /api/health 不受登录限流影响
 */
'use strict'

const http = require('http')
const { spawn } = require('child_process')
const path = require('path')

const PORT = 3901
const STUB_PORT = 3902
const BASE = `http://127.0.0.1:${PORT}`
const SERVER = path.join(__dirname, '..', 'server', 'server.js')

let passed = 0
let failed = 0

function check(name, ok, detail) {
  if (ok) {
    passed++
    console.log(`  ✔ ${name}`)
  } else {
    failed++
    console.log(`  ✘ ${name}${detail ? '\n      ' + detail : ''}`)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function startStub() {
  const stub = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<html><body>用户名或密码错误</body></html>')
  })
  return new Promise((resolve) => stub.listen(STUB_PORT, '127.0.0.1', () => resolve(stub)))
}

function login(username, headers) {
  return fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: JSON.stringify({ username: username, password: 'wrong-password' })
  }).then(async (res) => ({
    status: res.status,
    headers: res.headers,
    body: await res.json().catch(() => null)
  }))
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return true
    } catch (e) { /* 还没起来 */ }
    await sleep(120)
  }
  return false
}

;(async function main() {
  const stub = await startStub()
  const child = spawn(process.execPath, [SERVER], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      JW_BASE_URL: `http://127.0.0.1:${STUB_PORT}`,
      RATE_LIMIT_LOGIN_IP: '20',
      RATE_LIMIT_WINDOW: '60'
    }),
    stdio: 'ignore'
  })

  let exited = false
  child.on('exit', () => { exited = true })

  try {
    if (!(await waitForServer(10000))) {
      console.log('服务未能启动，测试中止')
      process.exitCode = 1
      return
    }

    // ==================== 1. 单 IP 20 次/分钟 ====================
    console.log('\n1. 单 IP 20 次/分钟')
    const first = []
    for (let i = 0; i < 20; i++) first.push(await login('ip' + i))

    check('前 20 次未被 IP 拦截', first.every((r) => r.status !== 429),
      first.map((r) => r.status).join(','))
    check('响应头 X-RateLimit-Limit=20',
      first[0].headers.get('x-ratelimit-limit') === '20',
      '实际 ' + first[0].headers.get('x-ratelimit-limit'))
    check('剩余次数逐次递减（第 20 次为 0）',
      first[19].headers.get('x-ratelimit-remaining') === '0',
      '实际 ' + first[19].headers.get('x-ratelimit-remaining'))

    const over = await login('ip-over')
    check('第 21 次被拦截（429）', over.status === 429, '实际 ' + over.status)
    check('拦截原因是 IP 维度（scope=ip）',
      over.body && over.body.scope === 'ip', JSON.stringify(over.body))
    check('提示为通用频率提示', !!(over.body && /请求过于频繁/.test(over.body.error)))
    check('带 Retry-After', Number(over.headers.get('retry-after')) > 0)

    // ==================== 2. 不同 IP 独立计数 ====================
    console.log('\n2. 不同 IP 独立计数')
    const otherIp = await login('ip-other', { 'X-Forwarded-For': '203.0.113.9' })
    check('另一个 IP 未被连带拦截', otherIp.status !== 429, '实际 ' + otherIp.status)
    const otherIp2 = await login('ip-other2', { 'X-Real-IP': '198.51.100.7' })
    check('X-Real-IP 同样识别为独立来源', otherIp2.status !== 429, '实际 ' + otherIp2.status)

    // ==================== 3. 请求体上限 ====================
    console.log('\n3. 请求体上限（16KB）')
    const big = await fetch(`${BASE}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.77' },
      body: JSON.stringify({ username: 'x'.repeat(64 * 1024), password: 'y' })
    }).then((r) => ({ status: r.status })).catch((e) => ({ status: 'ERR:' + e.name }))
    check('超大请求体被拒绝（413）', big.status === 413, '实际 ' + big.status)

    // ==================== 4. 其它接口不受影响 ====================
    console.log('\n4. 健康检查与未知接口')
    const health = await fetch(`${BASE}/api/health`)
    check('/api/health 正常返回 200', health.status === 200)
    check('健康接口额度为 60/分钟', health.headers.get('x-ratelimit-limit') === '60',
      '实际 ' + health.headers.get('x-ratelimit-limit'))
    const notFound = await fetch(`${BASE}/api/nope`, { headers: { 'X-Forwarded-For': '203.0.113.88' } })
    check('未知接口返回 404（而非 429）', notFound.status === 404, '实际 ' + notFound.status)

  } finally {
    if (!exited) child.kill()
    stub.close()
    await sleep(200)
  }

  console.log(`\n${'='.repeat(46)}`)
  console.log(`通过 ${passed} 项，失败 ${failed} 项`)
  console.log('='.repeat(46))
  process.exit(failed === 0 ? 0 : 1)
})()
