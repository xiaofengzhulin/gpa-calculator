/**
 * 绩点计算器 - 教务系统代理服务
 * 
 * 功能：代理小程序请求教务系统，处理 Cookie 会话和成绩抓取
 * 启动：node server.js
 * 
 * 环境变量：
 *   PORT - 服务端口（默认 3000）
 */

const http = require('http')
const https = require('https')
const { URL } = require('url')
const { createHash } = require('crypto')

const PORT = process.env.PORT || 3000
// 监听地址：正式环境设为 127.0.0.1，只允许本机 Nginx 反代访问，不暴露到公网
const HOST = process.env.HOST || '0.0.0.0'
// 教务系统地址：换了学校 / 需要本地联调时可直接改环境变量
const BASE_URL = process.env.JW_BASE_URL || 'http://jw.yit.edu.cn'

// ==================== Base64 编码（模拟教务系统的 encodeInp）====================
function encodeInp(text) {
  return Buffer.from(text, 'utf-8').toString('base64')
}

function buildEncoded(username, password) {
  return `${encodeInp(username)}%%%${encodeInp(password)}`
}

// ==================== HTTP 请求工具 ====================
function httpRequest(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr)
    const isHttps = url.protocol === 'https:'
    const client = isHttps ? https : http
    const startTime = Date.now()

    const reqOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        ...options.headers
      }
    }

    console.log(`[HTTP] ${options.method || 'GET'} ${url.hostname}${url.pathname}${url.search}`)

    const req = client.request(reqOptions, (res) => {
      const setCookies = res.headers['set-cookie'] || []
      const location = res.headers.location

      // 收集原始 Buffer（保留编码信息）
      const chunks = []
      res.on('data', chunk => { chunks.push(chunk) })
      res.on('end', () => {
        const elapsed = Date.now() - startTime
        const rawBuf = Buffer.concat(chunks)

        // 检测编码：优先从 Content-Type charset 读取
        const contentType = res.headers['content-type'] || ''
        const charsetMatch = contentType.match(/charset[= ]*([^\s;]+)/i)
        const charset = charsetMatch ? charsetMatch[1].toLowerCase() : 'utf-8'

        let body
        if (charset === 'gbk' || charset === 'gb2312' || charset === 'gb18030') {
          // 使用 TextDecoder 解码 GBK
          const decoder = new TextDecoder('gbk')
          body = decoder.decode(rawBuf)
        } else {
          body = rawBuf.toString('utf-8')
        }

        console.log(`[HTTP] 响应 ${res.statusCode} (${elapsed}ms, ${body.length} chars, charset=${charset})`)
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          setCookies,
          location,
          body
        })
      })
    })

    req.on('error', (err) => {
      console.log(`[HTTP] 错误: ${err.message}`)
      reject(err)
    })
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('请求超时')) })

    if (options.body) {
      req.write(options.body)
    }
    req.end()
  })
}

// ==================== Cookie 管理 ====================
function parseCookies(setCookies) {
  const cookies = {}
  for (const sc of setCookies) {
    const parts = sc.split(';')[0].split('=')
    if (parts.length >= 2) {
      cookies[parts[0].trim()] = parts.slice(1).join('=').trim()
    }
  }
  return cookies
}

function cookieHeader(cookies) {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
}

// ==================== 教务系统交互 ====================
async function login(username, password) {
  const encoded = buildEncoded(username, password)

  // Step 1: 获取登录页面（拿 JSESSIONID）
  const loginPage = await httpRequest(`${BASE_URL}/yjlgxy_jsxsd/`)
  const sessionCookies = parseCookies(loginPage.setCookies)

  // Step 2: POST 登录
  const loginBody = `encoded=${encodeURIComponent(encoded)}&jzmmid=1`
  const loginResp = await httpRequest(`${BASE_URL}/yjlgxy_jsxsd/xk/LoginToXk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookieHeader(sessionCookies),
      'Referer': `${BASE_URL}/yjlgxy_jsxsd/`
    },
    body: loginBody
  })

  // 更新 cookies
  const newCookies = parseCookies(loginResp.setCookies)
  Object.assign(sessionCookies, newCookies)

  // 检查是否登录成功（302 重定向）
  if (loginResp.statusCode !== 302) {
    if (loginResp.body.includes('用户名或密码错误')) {
      const err = new Error('用户名或密码错误，请检查后重试')
      err.code = 'AUTH_FAILED' // 只有这类错误才计入失败次数
      throw err
    }
    if (loginResp.body.includes('用户名不能为空')) {
      throw new Error('请输入用户名')
    }
    if (loginResp.body.includes('密码不能为空')) {
      throw new Error('请输入密码')
    }
    throw new Error(`登录失败：HTTP ${loginResp.statusCode}`)
  }

  // Step 3: 访问主页（建立完整会话）
  const mainUrl = loginResp.location.startsWith('http')
    ? loginResp.location
    : `${BASE_URL}${loginResp.location}`

  await httpRequest(mainUrl, {
    headers: { 'Cookie': cookieHeader(sessionCookies) }
  })

  return sessionCookies
}

async function fetchGrades(sessionCookies) {
  // Step 4: 访问成绩查询页面
  await httpRequest(`${BASE_URL}/yjlgxy_jsxsd/kscj/cjcx_query?Ves632DSdyV=NEW_XSD_XJCJ`, {
    headers: { 'Cookie': cookieHeader(sessionCookies) }
  })

  // Step 5: POST 查询全部学期成绩
  const queryBody = 'kksj=&kcxz=&xsfs=all'
  const gradeResp = await httpRequest(`${BASE_URL}/yjlgxy_jsxsd/kscj/cjcx_list`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookieHeader(sessionCookies),
      'Referer': `${BASE_URL}/yjlgxy_jsxsd/kscj/cjcx_query?Ves632DSdyV=NEW_XSD_XJCJ`
    },
    body: queryBody
  })

  return parseGradeTable(gradeResp.body)
}

// ==================== HTML 解析 ====================
function parseGradeTable(html) {
  // 提取 <table id="dataList"> 的内容
  const tableMatch = html.match(/<table[^>]*id="dataList"[^>]*>([\s\S]*?)<\/table>/i)
  if (!tableMatch) {
    throw new Error('未找到成绩表格，可能未登录或页面结构变化')
  }

  const tableHtml = tableMatch[1]
  // 提取所有数据行（跳过表头 <th> 行）
  const rows = []
  const trRegex = /<tr>\s*<td[^>]*>([\s\S]*?)<\/tr>/gi
  let match

  while ((match = trRegex.exec(tableHtml)) !== null) {
    const rowHtml = match[0]
    // 提取每个 td 的内容
    const cells = []
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi
    let tdMatch
    while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
      // 去除 HTML 标签，提取纯文本
      cells.push(tdMatch[1].replace(/<[^>]+>/g, '').trim())
    }

    if (cells.length >= 9) {
      rows.push({
        index: cells[0],           // 序号
        semester: cells[1],        // 开课学期
        courseCode: cells[2],      // 课程编号
        name: cells[3],            // 课程名称
        score: cells[4],           // 成绩
        scoreFlag: cells[5],       // 成绩标志
        credits: cells[6],         // 学分
        hours: cells[7],           // 总学时
        gpa: cells[8],             // 绩点
        examType: cells[9] || '',  // 考核方式
        courseAttr: cells[10] || '', // 课程属性
        courseType: cells[11] || ''  // 课程性质
      })
    }
  }

  return {
    success: true,
    count: rows.length,
    courses: rows
  }
}

// ==================== 限流 ====================
// 目的：避免接口被当作公开的「教务系统登录代理」，被拿去批量试学号密码。
// 两层防护：
//   1) 按 IP 的请求频率限制：POST /api/login 每分钟 20 次（其它接口 60 次/分钟）
//   2) 按学号的登录失败锁定：见下方「登录失败锁定」状态机
// 可用环境变量调整：RATE_LIMIT_LOGIN_IP / RATE_LIMIT_API / RATE_LIMIT_WINDOW(秒)
const RATE_LIMIT_WINDOW = Math.max(1, Number(process.env.RATE_LIMIT_WINDOW || 60)) * 1000
const RATE_LIMIT_LOGIN_IP = Math.max(1, Number(process.env.RATE_LIMIT_LOGIN_IP || 20))
const RATE_LIMIT_API = Math.max(1, Number(process.env.RATE_LIMIT_API || 60))

// 请求体上限，防止超大 body 拖垮进程
const MAX_BODY_BYTES = Math.max(1024, Number(process.env.MAX_BODY_BYTES || 16 * 1024))

// `${bucket}|${ip或学号摘要}` -> 命中时间戳数组（升序），滑动窗口
const _rateStore = new Map()

// 学号先做摘要再当 key：原始学号不常驻内存、不进日志
function userKey(username) {
  return createHash('sha256')
    .update(String(username).trim().toLowerCase())
    .digest('hex')
    .slice(0, 16)
}

// 日志脱敏：202312345678 -> 2023****5678
function maskUsername(name) {
  const s = String(name || '')
  if (s.length <= 2) return s.replace(/./g, '*')
  if (s.length <= 6) return s[0] + '*'.repeat(s.length - 2) + s.slice(-1)
  return s.slice(0, 4) + '*'.repeat(Math.max(2, s.length - 8)) + s.slice(-4)
}

function _normalizeIp(ip) {
  return String(ip || '').replace(/^::ffff:/, '')
}

function isPrivateAddress(ip) {
  const v = _normalizeIp(ip)
  if (!v) return false
  if (v === '127.0.0.1' || v === '::1' || v === 'localhost') return true
  if (/^10\./.test(v)) return true
  if (/^192\.168\./.test(v)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(v)) return true
  return false
}

// 只有来自本机 / 内网的连接（也就是我们自己的 Nginx）才信任转发头，
// 避免 3000 端口被公网直连时伪造 X-Forwarded-For 绕过限流。
function clientIp(req) {
  const socketIp = _normalizeIp(req.socket.remoteAddress)
  if (isPrivateAddress(socketIp)) {
    const xff = req.headers['x-forwarded-for']
    if (xff) {
      const first = _normalizeIp(String(xff).split(',')[0].trim())
      if (first) return first
    }
    const xri = req.headers['x-real-ip']
    if (xri) {
      const real = _normalizeIp(String(xri).trim())
      if (real) return real
    }
  }
  return socketIp || 'unknown'
}

// 滑动窗口计数：返回是否放行、剩余次数、多少秒后可重试
function checkRateLimit(bucket, ip, max) {
  const key = `${bucket}|${ip}`
  const now = Date.now()
  const from = now - RATE_LIMIT_WINDOW

  let hits = _rateStore.get(key)
  if (!hits) {
    hits = []
    _rateStore.set(key, hits)
  }
  while (hits.length > 0 && hits[0] <= from) hits.shift()

  if (hits.length >= max) {
    const retryAfter = Math.max(1, Math.ceil((hits[0] + RATE_LIMIT_WINDOW - now) / 1000))
    return { allowed: false, remaining: 0, retryAfter, max }
  }

  hits.push(now)
  return { allowed: true, remaining: max - hits.length, retryAfter: 0, max }
}

// 每分钟清理一次过期计数，防止 Map 无限增长（unref 不影响进程退出）
const _rateSweeper = setInterval(() => {
  const from = Date.now() - RATE_LIMIT_WINDOW
  for (const [key, hits] of _rateStore) {
    while (hits.length > 0 && hits[0] <= from) hits.shift()
    if (hits.length === 0) _rateStore.delete(key)
  }
}, 60 * 1000)
if (_rateSweeper.unref) _rateSweeper.unref()

// ==================== 登录失败锁定 ====================
// 按学号的状态机：
//
//   初始状态（failures=0, stage=0）
//        │ 连续失败 5 次
//        ▼
//   禁止登入 1 分钟（stage=1）
//        │ 解禁后再次连续失败 5 次
//        ▼
//   禁止登入 5 分钟（stage=2）
//        │ 之后每失败 5 次，维持 5 分钟
//        ▼
//   10 分钟内没有新的失败 → 回到初始状态；登录成功也会立即回到初始状态
//
// 注意：只有「账号密码错误」才算失败；超时、教务系统异常、未评教等不计入，
// 避免网络抖动把用户锁死。
const LOGIN_FAIL_THRESHOLD = 5
// 锁定档位（秒），可用 LOGIN_LOCK_SECONDS="60,300" 覆盖
const LOGIN_LOCK_LEVELS = String(process.env.LOGIN_LOCK_SECONDS || '60,300')
  .split(',')
  .map(s => Math.max(1, Number(s) || 60) * 1000)
// 多久没有新的失败就回到初始状态（秒），默认 10 分钟
const LOGIN_RESET_IDLE = Math.max(1, Number(process.env.LOGIN_LOCK_RESET_SECONDS || 600)) * 1000

const _loginGuard = new Map() // 学号摘要 -> { stage, failures, lockedUntil, lastFailureAt }

function _guardState(username) {
  const key = userKey(username)
  const now = Date.now()
  let st = _loginGuard.get(key)
  if (!st) {
    st = { stage: 0, failures: 0, lockedUntil: 0, lastFailureAt: 0 }
    _loginGuard.set(key, st)
  }
  // 锁定到期
  if (st.lockedUntil && now >= st.lockedUntil) st.lockedUntil = 0
  // 长时间没有新的失败 -> 回到初始状态
  if (!st.lockedUntil && st.lastFailureAt && now - st.lastFailureAt >= LOGIN_RESET_IDLE) {
    st.stage = 0
    st.failures = 0
    st.lastFailureAt = 0
  }
  return st
}

// 当前是否处于禁止登入状态
function getLoginLock(username) {
  const st = _guardState(username)
  const now = Date.now()
  if (st.lockedUntil > now) {
    return {
      locked: true,
      retryAfter: Math.max(1, Math.ceil((st.lockedUntil - now) / 1000)),
      stage: st.stage
    }
  }
  return { locked: false, retryAfter: 0, stage: st.stage, failures: st.failures }
}

// 记录一次失败；返回是否达到阈值并进入锁定
function recordLoginFailure(username) {
  const st = _guardState(username)
  const now = Date.now()
  st.failures += 1
  st.lastFailureAt = now

  if (st.failures >= LOGIN_FAIL_THRESHOLD) {
    st.stage = Math.min(st.stage + 1, LOGIN_LOCK_LEVELS.length)
    st.failures = 0
    const lockMs = LOGIN_LOCK_LEVELS[st.stage - 1]
    st.lockedUntil = now + lockMs
    return { locked: true, stage: st.stage, retryAfter: Math.ceil(lockMs / 1000) }
  }

  return {
    locked: false,
    stage: st.stage,
    retryAfter: 0,
    remainingAttempts: LOGIN_FAIL_THRESHOLD - st.failures
  }
}

// 登录成功：回到初始状态
function recordLoginSuccess(username) {
  _loginGuard.delete(userKey(username))
}

function formatWait(seconds) {
  return seconds >= 60 ? Math.ceil(seconds / 60) + ' 分钟' : seconds + ' 秒'
}

// 定期清理：锁定已到期且长时间没有新失败的记录，防止 Map 无限增长
const _guardSweeper = setInterval(() => {
  const now = Date.now()
  for (const [key, st] of _loginGuard) {
    if (st.lockedUntil > now) continue
    if (!st.lastFailureAt || now - st.lastFailureAt >= LOGIN_RESET_IDLE) _loginGuard.delete(key)
  }
}, 60 * 1000)
if (_guardSweeper.unref) _guardSweeper.unref()

// ==================== HTTP 服务器 ====================
const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(200)
    res.end()
    return
  }

  // 解析 URL
  const urlObj = new URL(req.url, `http://localhost:${PORT}`)
  const path = urlObj.pathname

  // ---- 限流第一层：按 IP（在读 body 之前拦掉异常流量）----
  const isLogin = req.method === 'POST' && path === '/api/login'
  const ip = clientIp(req)
  const ipMax = isLogin ? RATE_LIMIT_LOGIN_IP : RATE_LIMIT_API
  const ipRate = checkRateLimit(isLogin ? 'login-ip' : 'api-ip', ip, ipMax)
  res.setHeader('X-RateLimit-Limit', String(ipRate.max))
  res.setHeader('X-RateLimit-Remaining', String(ipRate.remaining))
  if (!ipRate.allowed) {
    res.setHeader('Retry-After', String(ipRate.retryAfter))
    console.log(`[限流] IP ${ip} 触发 ${isLogin ? '登录' : '接口'}限制（${ipMax}/分钟）`)
    return jsonResponse(res, 429, {
      success: false,
      error: `请求过于频繁，请 ${ipRate.retryAfter} 秒后再试`,
      retryAfter: ipRate.retryAfter,
      scope: 'ip'
    })
  }

  try {
    // POST /api/login - 登录并获取成绩
    if (req.method === 'POST' && path === '/api/login') {
      const body = await readBody(req)

      let username, password
      try {
        const parsed = JSON.parse(body)
        username = parsed.username
        password = parsed.password
      } catch (e) {
        return jsonResponse(res, 400, { success: false, error: '请求格式错误' })
      }

      if (!username || !password) {
        return jsonResponse(res, 400, { success: false, error: '请提供用户名和密码' })
      }

      // ---- 禁止登入期间：直接拒绝，正确密码也不行 ----
      const lock = getLoginLock(username)
      if (lock.locked) {
        res.setHeader('Retry-After', String(lock.retryAfter))
        console.log(`[锁定] 学号 ${maskUsername(username)} 仍在禁止登入期（剩余 ${lock.retryAfter}s，第 ${lock.stage} 级）`)
        return jsonResponse(res, 429, {
          success: false,
          error: `登录失败次数过多，已禁止登入，请 ${formatWait(lock.retryAfter)}后再试`,
          retryAfter: lock.retryAfter,
          scope: 'login-lock',
          stage: lock.stage
        })
      }

      console.log(`[登录] 用户: ${maskUsername(username)}`)
      let sessionCookies
      try {
        sessionCookies = await login(username, password)
      } catch (err) {
        if (err.code !== 'AUTH_FAILED') throw err // 超时 / 教务系统异常等不计入失败次数

        const fail = recordLoginFailure(username)
        if (fail.locked) {
          res.setHeader('Retry-After', String(fail.retryAfter))
          console.log(`[锁定] 学号 ${maskUsername(username)} 连续失败 ${LOGIN_FAIL_THRESHOLD} 次，禁止登入 ${formatWait(fail.retryAfter)}（第 ${fail.stage} 级）`)
          return jsonResponse(res, 429, {
            success: false,
            error: `登录失败次数过多，已禁止登入 ${formatWait(fail.retryAfter)}`,
            retryAfter: fail.retryAfter,
            scope: 'login-lock',
            stage: fail.stage
          })
        }

        console.log(`[失败] 学号 ${maskUsername(username)} 密码错误，还剩 ${fail.remainingAttempts} 次机会`)
        return jsonResponse(res, 401, {
          success: false,
          error: '用户名或密码错误，请检查后重试',
          remainingAttempts: fail.remainingAttempts,
          stage: fail.stage
        })
      }

      recordLoginSuccess(username)
      console.log(`[登录] 成功，开始获取成绩...`)

      const grades = await fetchGrades(sessionCookies)
      console.log(`[成绩] 获取到 ${grades.count} 门课程`)

      return jsonResponse(res, 200, grades)
    }

    // GET /api/health - 健康检查
    if (req.method === 'GET' && path === '/api/health') {
      return jsonResponse(res, 200, { status: 'ok', time: new Date().toISOString() })
    }

    // 404
    jsonResponse(res, 404, { success: false, error: '接口不存在' })

  } catch (err) {
    console.error(`[错误] ${err.message}`)
    // 确保响应只发送一次
    if (!res.headersSent) {
      jsonResponse(res, err.statusCode || 500, { success: false, error: err.message || '服务器内部错误' })
    }
  }
})

function readBody(req, limit) {
  const max = limit || MAX_BODY_BYTES
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', chunk => {
      size += chunk.length
      if (size > max) {
        const err = new Error('请求内容过大')
        err.statusCode = 413
        reject(err)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function jsonResponse(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

server.listen(PORT, HOST, () => {
  console.log(`\n🎓 绩点计算器代理服务已启动`)
  console.log(`   地址: http://localhost:${PORT}`)
  console.log(`   监听: ${HOST}:${PORT}${HOST === '127.0.0.1' ? '（仅本机，需经 Nginx 反代访问）' : '（对公网开放，正式环境建议设为 127.0.0.1）'}`)
  console.log(`   接口:`)
  console.log(`     POST /api/login    - 登录并获取成绩（单 IP ${RATE_LIMIT_LOGIN_IP} 次/分钟；连续失败 ${LOGIN_FAIL_THRESHOLD} 次锁定 ${LOGIN_LOCK_LEVELS.map(s => s / 1000).join(' / ')} 秒）`)
  console.log(`     GET  /api/health   - 健康检查（限流 ${RATE_LIMIT_API} 次/分钟/IP）`)
  console.log(`   提示: 正式环境请只通过 Nginx(443) 反代访问，不要在安全组放行 ${PORT} 端口\n`)
})
