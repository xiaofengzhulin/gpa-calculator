/**
 * 网页版静态自检
 * 运行：node tests/web-static-check.js
 *
 * 检查项：
 *   1. 模板里用到的每个 data-act 都在 app.js 的 ACTIONS 里有处理函数
 *   2. index.html 引用的静态资源真实存在
 *   3. 页面不依赖任何外部 CDN / 字体 / 统计脚本（离线可渲染）
 *   4. 备案信息（ICP 号）出现在首页可见位置
 */
'use strict'

const fs = require('fs')
const path = require('path')

const SITE = path.join(__dirname, '..', 'deploy', 'site')
const p = (f) => path.join(SITE, f)

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

const appJs = fs.readFileSync(p('app.js'), 'utf8')
const html = fs.readFileSync(p('index.html'), 'utf8')
const css = fs.readFileSync(p('style.css'), 'utf8')
const core = fs.readFileSync(p('gpa-core.js'), 'utf8')

// ---------- 1. data-act 与 ACTIONS 对齐 ----------
console.log('\n1. 事件绑定完整性')
const usedActions = new Set()
const usedRe = /data-act=\\?"([a-z-]+)\\?"/g
let m
while ((m = usedRe.exec(appJs)) !== null) usedActions.add(m[1])
// index.html 里的静态按钮
const htmlActRe = /data-act="([a-z-]+)"/g
while ((m = htmlActRe.exec(html)) !== null) usedActions.add(m[1])

const actionsBlock = appJs.slice(appJs.indexOf('var ACTIONS = {'), appJs.indexOf('document.addEventListener(\'click\''))
const definedActions = new Set()
const defRe = /^\s{4}'?([a-z-]+)'?: function/gm
while ((m = defRe.exec(actionsBlock)) !== null) definedActions.add(m[1])

const missing = [...usedActions].filter((a) => !definedActions.has(a))
check(`所有 ${usedActions.size} 个 data-act 都有处理函数`, missing.length === 0, missing.length ? '缺少: ' + missing.join(', ') : '')

const unused = [...definedActions].filter((a) => !usedActions.has(a))
check('没有定义后闲置的处理函数', unused.length === 0, unused.length ? '闲置: ' + unused.join(', ') : '')

// ---------- 2. 资源引用 ----------
console.log('\n2. 静态资源引用')
const refs = [...html.matchAll(/(?:href|src)="([^"#][^"]*)"/g)]
  .map((x) => x[1])
  .filter((u) => !/^(https?:|mailto:|data:)/.test(u))
for (const ref of refs) {
  check(`index.html 引用的 ${ref} 存在`, fs.existsSync(p(ref)))
}

// ---------- 3. 无外部依赖 ----------
console.log('\n3. 无外部依赖（可离线渲染）')
const externals = []
for (const [name, content] of [['app.js', appJs], ['gpa-core.js', core], ['style.css', css]]) {
  const urls = [...content.matchAll(/https?:\/\/[^\s'"()]+/g)].map((x) => x[0])
  urls.forEach((u) => externals.push(`${name}: ${u}`))
}
// 注释里出现的备案系统地址、教务系统地址不影响渲染，单独排除
const blocking = externals.filter((e) => !/beian\.(mps\.gov\.cn|miit\.gov\.cn)|jw\.yit\.edu\.cn|182\.92\.80\.164/.test(e))
check('JS/CSS 中没有 CDN / 字体 / 统计脚本外链', blocking.length === 0, blocking.join('\n      '))

const htmlExt = [...html.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map((x) => x[1])
const htmlBlocking = htmlExt.filter((u) => !/beian\.(mps\.gov\.cn|miit\.gov\.cn)/.test(u))
check('index.html 没有外链静态资源', htmlBlocking.length === 0, htmlBlocking.join('\n      '))

// ---------- 4. 备案信息 ----------
console.log('\n4. 备案信息展示')
check('标题与备案名称一致', html.includes('<title>yjt燕理绩点计算通</title>'))
check('页脚有 ICP 备案号', html.includes('蒙ICP备2026007686号-2'))
check('页脚有公安备案占位（通过后替换）', html.includes('蒙公网安备'))
check('ICP 备案号链接到工信部系统', html.includes('https://beian.miit.gov.cn/'))
check('关于页写有网站说明', appJs.includes('个人非经营性网站'))
check('关于页写明无交互服务', appJs.includes('不提供用户注册'))

// ---------- 5. 功能与小程序的对应关系 ----------
console.log('\n5. 功能覆盖（与小程序对齐）')
const features = [
  ['添加课程', 'open-add'],
  ['编辑课程', "edit:"],
  ['删除课程', 'deleteCourse'],
  ['排除 / 加入课程', 'excludeCourse'],
  ['全部加入', 'includeAllExcluded'],
  ['清空', 'clearAll'],
  ['学期筛选', 'semester'],
  ['算法切换', 'pick-method'],
  ['撤销 / 重做', 'doUndo'],
  ['历史快照恢复', 'restoreSnapshot'],
  ['教务系统导入', 'runAutoImport'],
  ['粘贴导入', 'parsePaste'],
  ['统计页', 'viewStats'],
  ['关于页', 'viewAbout']
]
features.forEach(([label, token]) => {
  check(label, appJs.includes(token))
})
check('7 种算法齐全', Object.keys(require(p('gpa-core.js')).GPA_METHODS).length === 7)

// ---------- 汇总 ----------
console.log(`\n${'='.repeat(46)}`)
console.log(`通过 ${passed} 项，失败 ${failed} 项`)
console.log('='.repeat(46))
process.exit(failed === 0 ? 0 : 1)
