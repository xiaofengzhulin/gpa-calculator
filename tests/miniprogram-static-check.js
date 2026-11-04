/**
 * 小程序静态检查（1.2.1 起）
 * 运行：node tests/miniprogram-static-check.js
 *
 * 不启动微信开发者工具，只做「编译前就能发现」的检查：
 *  1. WXML 里绑定的事件处理函数必须在对应 Page 中存在（防止点了没反应）
 *  2. WXML 里 {{}} 引用的顶层字段必须出现在 data 中（防止渲染空白）
 *  3. wx:for 必须带 wx:key（消除控制台 warning，提升 diff 性能）
 *  4. WXML 文本里不能出现字面量 \n（微信不会解析转义符，会原样显示）
 *  5. app.json 页面/图标/JSON 合法性
 *  6. 版本号一致性：about.js / README / CHANGELOG
 */
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const MP = path.join(ROOT, 'miniprogram')

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

const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n')
const PAGES = ['index', 'login', 'history', 'statistics', 'about']

// ==================== 1. 事件处理函数存在 ====================
group('1. WXML 事件绑定 ↔ Page 方法')
PAGES.forEach((page) => {
  const wxml = read(path.join(MP, 'pages', page, `${page}.wxml`))
  const js = read(path.join(MP, 'pages', page, `${page}.js`))
  const handlers = new Set()
  const re = /(?:bind|catch)[:]?[a-z]+\s*=\s*"([A-Za-z_$][\w$]*)"/g
  let match
  while ((match = re.exec(wxml)) !== null) handlers.add(match[1])

  const missing = [...handlers].filter((name) => {
    const defined = new RegExp(`(?:^|[\\s,{])${name}\\s*[:(]`, 'm')
    return !defined.test(js)
  })
  check(`${page}.wxml 绑定的 ${handlers.size} 个事件都存在`, missing, [])
})

// ==================== 2. data 字段存在 ====================
group('2. WXML {{}} 顶层字段 ↔ data')
const IGNORED = new Set([
  'item', 'index', 'true', 'false', 'null', 'undefined', 'length',
  'Math', 'JSON', 'String', 'Number'
])
PAGES.forEach((page) => {
  const wxml = read(path.join(MP, 'pages', page, `${page}.wxml`))
  const js = read(path.join(MP, 'pages', page, `${page}.js`))
  const dataBlock = /data\s*:\s*\{([\s\S]*?)\n\s{2}\},?\n/.exec(js)
  const dataKeys = new Set()
  if (dataBlock) {
    const keyRe = /^\s{4}([A-Za-z_$][\w$]*)\s*:/gm
    let km
    while ((km = keyRe.exec(dataBlock[1])) !== null) dataKeys.add(km[1])
  }
  // 取 {{ }} 内每个表达式的第一个标识符
  const exprs = []
  const exprRe = /\{\{([\s\S]*?)\}\}/g
  let em
  while ((em = exprRe.exec(wxml)) !== null) exprs.push(em[1])
  const refs = new Set()
  exprs.forEach((expr) => {
    const cleaned = expr
      .replace(/'[^']*'/g, '')
      .replace(/"[^"]*"/g, '')
      // 去掉 item.name / snapshots.length 这类属性访问，只保留顶层变量
      .replace(/[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)+/g, '')
    const idRe = /[A-Za-z_$][\w$]*/g
    let im
    while ((im = idRe.exec(cleaned)) !== null) {
      const id = im[0]
      if (!IGNORED.has(id)) refs.add(id)
    }
  })
  const missing = [...refs].filter((key) => !dataKeys.has(key))
  check(`${page}.wxml 引用的 data 字段都存在`, missing, [])
})

// ==================== 3. wx:for 必须有 wx:key ====================
group('3. wx:for 必须带 wx:key')
PAGES.forEach((page) => {
  const wxml = read(path.join(MP, 'pages', page, `${page}.wxml`))
  const tags = wxml.match(/<[a-z-]+[^>]*wx:for=[^>]*>/g) || []
  const offenders = tags.filter((tag) => !/wx:key=/.test(tag)).length
  check(`${page}.wxml 的 ${tags.length} 个 wx:for 都有 wx:key`, offenders, 0)
})

// ==================== 4. 文本字面量 \n ====================
group('4. WXML 文本字面量转义')
PAGES.forEach((page) => {
  const wxml = read(path.join(MP, 'pages', page, `${page}.wxml`))
  const textNodes = wxml.replace(/\{\{[\s\S]*?\}\}/g, '')
  check(`${page}.wxml 无字面量 \\n`, textNodes.includes('\\n'), false)
})

// ==================== 5. 0 分成绩展示 ====================
group('5. 0 分成绩展示')
PAGES.forEach((page) => {
  const wxml = read(path.join(MP, 'pages', page, `${page}.wxml`))
  check(`${page}.wxml 未使用 score || grade（0 分会被吞掉）`, /score\s*\|\|\s*grade/.test(wxml), false)
})

// ==================== 6. app.json / 页面文件 ====================
group('6. app.json 与页面文件')
const appJson = JSON.parse(read(path.join(MP, 'app.json')))
check('入口页是计算页', appJson.pages[0], 'pages/index/index')
check('5 个页面全部注册', appJson.pages.length, 5)
check('页面文件齐全', appJson.pages.every(p => fs.existsSync(path.join(MP, `${p}.js`)) && fs.existsSync(path.join(MP, `${p}.wxml`))), true)
check('tabBar 图标都存在', appJson.tabBar.list.every((item) => {
  return fs.existsSync(path.join(MP, item.iconPath)) && fs.existsSync(path.join(MP, item.selectedIconPath))
}), true)
check('tabBar 不超过 5 项', appJson.tabBar.list.length <= 5, true)
check('sitemap 文件存在', fs.existsSync(path.join(MP, 'sitemap.json')), true)
PAGES.forEach((page) => {
  const file = path.join(MP, 'pages', page, `${page}.json`)
  let ok = true
  try {
    JSON.parse(read(file))
  } catch (e) {
    ok = false
  }
  check(`${page}.json 合法`, ok, true)
})

// ==================== 7. 版本号一致性 ====================
group('7. 版本号一致性')
const aboutJs = read(path.join(MP, 'pages', 'about', 'about.js'))
const aboutVersion = (/version:\s*'([\d.]+)'/.exec(aboutJs) || [])[1]
const readmeVersion = (/版本\*\*:\s*v?([\d.]+)/.exec(read(ROOT + '/README.md')) || [])[1]
const changelogPath = path.join(ROOT, 'CHANGELOG.md')
const hasChangelog = fs.existsSync(changelogPath)
const changelogVersion = hasChangelog ? (/#\s*v?([\d.]+)/.exec(read(changelogPath)) || [])[1] : null

check('about.js 有版本号', !!aboutVersion, true)
check('README 版本 = about.js 版本', readmeVersion, aboutVersion)
check('存在 CHANGELOG.md', hasChangelog, true)
check('CHANGELOG 最新版本 = about.js 版本', changelogVersion, aboutVersion)

// ==================== 8. 备案信息 ====================
group('8. 备案信息')
const aboutWxml = read(path.join(MP, 'pages', 'about', 'about.wxml'))
check('关于页展示工信部备案号', aboutJs.includes('蒙ICP备2026007686号-2'), true)
check('关于页展示公安备案号', aboutJs.includes('蒙公网安备15010402000835号'), true)
check('公安备案号已标记为可用', /policeReady:\s*true/.test(aboutJs), true)
check('不再有「备案办理中」占位', /备案办理中/.test(aboutJs), false)
check('关于页有备案信息卡片', aboutWxml.includes('备案信息'), true)
check('关于页有隐私说明', aboutWxml.includes('隐私说明'), true)

// ==================== 汇总 ====================
console.log(`\n${'='.repeat(46)}`)
console.log(`通过 ${passed} 项，失败 ${failed} 项`)
console.log('='.repeat(46))
process.exit(failed === 0 ? 0 : 1)
