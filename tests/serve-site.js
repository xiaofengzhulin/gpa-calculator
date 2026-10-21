/**
 * 本地静态预览服务
 * 运行：node tests/serve-site.js [端口]
 *
 * 用于在本地检查 deploy/site 的页面效果（对「教务系统导入」来说，
 * 同源请求会和线上一致地转发到 /api/*，需要 server/server.js 同时在本机 3000 端口运行）。
 */
'use strict'

const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = Number(process.argv[2]) || 8080
const ROOT = path.join(__dirname, '..', 'deploy', 'site')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
}

http.createServer((req, res) => {
  let pathname = decodeURIComponent((req.url || '/').split('?')[0])
  if (pathname === '/') pathname = '/index.html'

  const file = path.join(ROOT, path.normalize(pathname))
  if (!file.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
    return res.end('Forbidden')
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('Not Found: ' + pathname)
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    })
    res.end(data)
  })
}).listen(PORT, '127.0.0.1', () => {
  console.log('静态预览: http://127.0.0.1:' + PORT)
  console.log('目录: ' + ROOT)
  console.log('按 Ctrl+C 停止')
})
