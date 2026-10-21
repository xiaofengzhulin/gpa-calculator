/**
 * 登录失败锁定（状态机）测试
 * 运行：node tests/login-guard.test.js
 *
 * 状态机：
 *   初始 --连续失败 5 次--> 禁止登入 1 分钟 --再失败 5 次--> 禁止登入 5 分钟
 *   10 分钟内没有新的失败 --> 回到初始；登录成功 --> 立即回到初始
 *
 * 为了能快速验证，用环境变量把档位压缩成 1 秒 / 2 秒、闲置重置 4 秒：
 *   LOGIN_LOCK_SECONDS=1,2  LOGIN_LOCK_RESET_SECONDS=4
 */
'use strict'

const http = require('http')
const { spawn } = require('child_process')
const path = require('path')

const PORT = 3903
const STUB_PORT = 3904
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

// ==================== 可切换行为的教务系统桩 ====================
let stubMode = 'fail' // 'fail' | 'success' | 'error'

const GRADE_TABLE =
  '<table id="dataList"><tr><th>序号</th></tr>' +
  '<tr><td>1</td><td>2024-2025-1</td><td>C001</td><td>高等数学</td><td>92</td>' +
  '<td></td><td>5</td><td>80</td><td>4.33</td><td>考试</td><td>必修</td><td>必修</td></tr>' +
  '</table>'

function startStub() {
  const stub = http.createServer((req, res) => {
    const url = (req.url || '').split('?')[0]

    if (req.method === 'GET' && url === '/yjlgxy_jsxsd/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end('<html>登录页</html>')
    }

    if (req.method === 'POST' && url === '/yjlgxy_jsxsd/xk/LoginToXk') {
      if (stubMode === 'success') {
        res.writeHead(302, { Location: '/yjlgxy_jsxsd/index' })
        return res.end()
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      // fail: 命中「用户名或密码错误」-> 计为认证失败
      // error: 返回别的页面 -> 视为教务系统异常，不计入失败次数
      return res.end(stubMode === 'fail'
        ? '<html>用户名或密码错误</html>'
        : '<html>系统维护中，请稍后再试</html>')
    }

    if (req.method === 'GET' && url === '/yjlgxy_jsxsd/index') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end('<html>主页</html>')
    }

    if (req.method === 'GET' && url.indexOf('/yjlgxy_jsxsd/kscj/cjcx_query') === 0) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end('<html>查询页</html>')
    }

    if (req.method === 'POST' && url === '/yjlgxy_jsxsd/kscj/cjcx_list') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(GRADE_TABLE)
    }

    res.writeHead(404)
    res.end()
  })

  return new Promise((resolve) => stub.listen(STUB_PORT, '127.0.0.1', () => resolve(stub)))
}

function login(username) {
  return fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username, password: 'whatever' })
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
      LOGIN_LOCK_SECONDS: '1,2',
      LOGIN_LOCK_RESET_SECONDS: '4',
      RATE_LIMIT_LOGIN_IP: '1000' // 本测试只关心锁定状态机
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

    const USER = '20239999'

    // ==================== 1. 初始状态：失败计数与剩余次数 ====================
    console.log('\n1. 初始状态与失败计数')
    stubMode = 'fail'
    const fails = []
    for (let i = 0; i < 4; i++) fails.push(await login(USER))

    check('前 4 次失败返回 401', fails.every((r) => r.status === 401),
      fails.map((r) => r.status).join(','))
    check('每次返回剩余尝试次数（4→1）',
      fails.map((r) => r.body && r.body.remainingAttempts).join(',') === '4,3,2,1',
      fails.map((r) => r.body && r.body.remainingAttempts).join(','))
    check('失败提示为密码错误', /用户名或密码错误/.test(fails[0].body.error))
    check('未满 5 次时 stage 仍为 0', fails.every((r) => r.body.stage === 0))

    // ==================== 2. 第 5 次失败 → 锁定 1 分钟（测试里压缩为 1 秒）====================
    console.log('\n2. 连续失败 5 次后禁止登入')
    const fifth = await login(USER)
    check('第 5 次失败直接返回 429', fifth.status === 429, '实际 ' + fifth.status)
    check('提示「已禁止登入」', /已禁止登入/.test(fifth.body.error), fifth.body.error)
    check('进入第 1 级锁定', fifth.body.stage === 1, 'stage=' + fifth.body.stage)
    check('带 Retry-After 与 retryAfter', Number(fifth.headers.get('retry-after')) > 0 && fifth.body.retryAfter > 0)
    check('scope 标明是锁定而非频率限制', fifth.body.scope === 'login-lock')

    // ==================== 3. 锁定期间即使密码正确也拒绝 ====================
    console.log('\n3. 锁定期间正确密码也拒绝')
    stubMode = 'success'
    const duringLock = await login(USER)
    check('锁定期间返回 429', duringLock.status === 429, '实际 ' + duringLock.status)
    check('仍然提示禁止登入', /已禁止登入/.test(duringLock.body.error))

    // ==================== 4. 登录成功 → 回到初始状态 ====================
    console.log('\n4. 解禁 + 登录成功 → 回到初始状态')
    await sleep(1200)
    const success = await login(USER)
    check('解禁后可以正常登录（200）', success.status === 200, '实际 ' + success.status)
    check('返回成绩数据', !!(success.body && success.body.success && success.body.count >= 1))

    stubMode = 'fail'
    const afterReset = []
    for (let i = 0; i < 4; i++) afterReset.push(await login(USER))
    check('成功后失败计数已清零（重新从 4 递减）',
      afterReset.map((r) => r.body && r.body.remainingAttempts).join(',') === '4,3,2,1',
      afterReset.map((r) => r.body && r.body.remainingAttempts).join(','))
    check('成功登录也把 stage 重置为 0',
      afterReset.every((r) => r.body.stage === 0),
      afterReset.map((r) => r.body.stage).join(','))

    // ==================== 5. 再失败 5 次 → 升级为第 2 级锁定 ====================
    console.log('\n5. 再次失败 5 次 → 升级锁定')
    const fifth2 = await login(USER)
    check('再次进入锁定（第 1 级）', fifth2.status === 429 && fifth2.body.stage === 1,
      'status=' + fifth2.status + ' stage=' + fifth2.body.stage)

    await sleep(1200) // 等第 1 级解禁
    let escalate = null
    for (let i = 0; i < 5; i++) escalate = await login(USER)
    check('解禁后再失败 5 次 → 升级为第 2 级', escalate.status === 429 && escalate.body.stage === 2,
      'status=' + escalate.status + ' stage=' + (escalate.body && escalate.body.stage))
    check('第 2 级锁定时间更长（测试配置 2 秒）', escalate.body.retryAfter === 2,
      'retryAfter=' + escalate.body.retryAfter)

    // ==================== 6. 闲置超时 → 回到初始状态 ====================
    console.log('\n6. 长时间没有新的失败 → 回到初始状态')
    await sleep(2400) // 解禁
    await sleep(2200) // 超过 4 秒闲置重置窗口
    let afterIdle = null
    for (let i = 0; i < 5; i++) afterIdle = await login(USER)
    check('闲置后重新从第 1 级开始（而不是第 2 级）',
      afterIdle.status === 429 && afterIdle.body.stage === 1,
      'stage=' + (afterIdle.body && afterIdle.body.stage))

    // ==================== 7. 非认证错误不计入失败次数 ====================
    console.log('\n7. 教务系统异常不计入失败次数')
    const OTHER = '20238888'
    stubMode = 'error'
    const errors = []
    for (let i = 0; i < 3; i++) errors.push(await login(OTHER))
    check('教务系统异常返回 5xx（非 401）',
      errors.every((r) => r.status >= 500),
      errors.map((r) => r.status).join(','))
    check('异常响应不携带 remainingAttempts',
      errors.every((r) => r.body && r.body.remainingAttempts === undefined))

    stubMode = 'fail'
    const afterErrors = await login(OTHER)
    check('异常之后首次密码错误，剩余次数仍是 4（未被异常消耗）',
      afterErrors.status === 401 && afterErrors.body.remainingAttempts === 4,
      'status=' + afterErrors.status + ' remaining=' + (afterErrors.body && afterErrors.body.remainingAttempts))

    // ==================== 8. 不同学号互不影响 ====================
    console.log('\n8. 不同学号互不影响')
    const another = await login('20237777')
    check('其它学号不受锁定影响', another.status === 401 && another.body.remainingAttempts === 4,
      'status=' + another.status)

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
