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

const PORT = process.env.PORT || 3000
const BASE_URL = 'http://jw.yit.edu.cn'

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
      throw new Error('用户名或密码错误，请检查后重试')
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

      console.log(`[登录] 用户: ${username}`)
      const sessionCookies = await login(username, password)
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
      jsonResponse(res, 500, { success: false, error: err.message || '服务器内部错误' })
    }
  }
})

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function jsonResponse(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎓 绩点计算器代理服务已启动`)
  console.log(`   地址: http://localhost:${PORT}`)
  console.log(`   局域网: http://0.0.0.0:${PORT} (允许外部设备访问)`)
  console.log(`   接口:`)
  console.log(`     POST /api/login    - 登录并获取成绩`)
  console.log(`     GET  /api/health   - 健康检查\n`)
})
