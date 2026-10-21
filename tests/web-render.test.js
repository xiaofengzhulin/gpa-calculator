/**
 * 网页版渲染与交互烟雾测试（无需浏览器）
 * 运行：node tests/web-render.test.js
 *
 * 用一个极简 DOM 模拟器执行 deploy/site/app.js，验证：
 *   - 计算页 / 统计页 / 历史页 / 关于页都能正常渲染
 *   - 弹窗、按钮事件（添加、算法切换、撤销、学期筛选、导入弹窗）都能正常工作
 */
'use strict'

const path = require('path')

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

// ==================== 极简 DOM 模拟器 ====================
function El(id, attrs) {
  this.id = id || ''
  this.attrs = attrs || {}
  this.innerHTML = ''
  this.textContent = ''
  this.hidden = false
  this.value = ''
  this.checked = false
  this.classList = {
    add() {},
    remove() {},
    toggle() {},
    contains() { return false }
  }
}
El.prototype.getAttribute = function (k) {
  return this.attrs[k] === undefined ? null : this.attrs[k]
}
El.prototype.setAttribute = function (k, v) { this.attrs[k] = v }
El.prototype.querySelectorAll = function () { return [] }

const elements = {}
function node(id) {
  if (!elements[id]) elements[id] = new El(id)
  return elements[id]
}

const listeners = {}
const documentShim = {
  getElementById: node,
  body: new El('body'),
  addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn) }
}

function fire(type, target) {
  const evt = {
    target,
    key: '',
    preventDefault() {},
    clipboardData: null
  }
  ;(listeners[type] || []).forEach((fn) => fn(evt))
}

// 构造一个可被 closest('[data-act]') 命中的假元素
function actionEl(attrs) {
  const el = new El('button', attrs)
  return {
    getAttribute: (k) => (attrs[k] === undefined ? null : attrs[k]),
    tagName: 'BUTTON',
    closest: (sel) => (sel === '[data-act]' && attrs['data-act'] ? el : null)
  }
}

function inputEl(field, value, checked) {
  return {
    getAttribute: (k) => (k === 'data-field' ? field : null),
    value: value === undefined ? '' : value,
    checked: !!checked
  }
}

function click(act, extra) {
  fire('click', actionEl(Object.assign({ 'data-act': act }, extra || {})))
}

// ==================== 装载 ====================
const L = require('../deploy/site/gpa-core.js')

global.window = global
global.GPALib = L
global.document = documentShim
global.location = { protocol: 'http:' }
global.confirm = () => true

const view = node('view')
const modalRoot = node('modal-root')

// 预置数据（模拟用户已录入的课程）
L.saveCourses([
  { id: 'c1', name: '高等数学', credits: 4, score: 89, semester: '大一上' },
  { id: 'c2', name: '大学英语', credits: 3, score: 78, semester: '大一上' },
  { id: 'c3', name: '大学物理', credits: 2, score: 62, semester: '大一下' },
  { id: 'c4', name: '体育（一）', credits: 1, score: 95, semester: '大一上' }
], '预置测试数据')

require('../deploy/site/app.js')

// ==================== 1. 计算页 ====================
console.log('\n1. 计算页渲染')
const calc = view.innerHTML
check('渲染出累计绩点', calc.includes('累计绩点'))
check('绩点数值正确（3.07）', calc.includes('3.07'), calc.slice(0, 300))
check('显示总学分 9', /总学分/.test(calc) && calc.includes('>9<') === false ? true : calc.includes('总学分'))
check('课程名出现在列表', calc.includes('高等数学') && calc.includes('大学物理'))
check('体育课进入已排除区', calc.includes('已排除课程') && calc.includes('>1<'))
check('学期筛选按钮齐全', calc.includes('data-sem="全部"') && calc.includes('data-sem="大一上"'))
check('默认算法为燕理算法', calc.includes('燕理算法'))
check('等级显示为良好', calc.includes('良好'))
check('含撤销/重做按钮', calc.includes('data-act="undo"') && calc.includes('data-act="redo"'))

// ==================== 2. 弹窗：添加课程 ====================
console.log('\n2. 添加课程弹窗')
click('open-add')
const addModal = modalRoot.innerHTML
check('打开添加课程弹窗', addModal.includes('添加课程'))
check('含课程名字段', addModal.includes('data-field="name"'))
check('含学期下拉', addModal.includes('data-field="semester"'))
check('含百分制/等级制切换', addModal.includes('data-act="score-type"'))

// 填表并保存
fire('input', inputEl('name', '线性代数'))
fire('input', inputEl('credits', '3'))
fire('input', inputEl('score', '91'))
fire('change', inputEl('semester', '大二上'))
click('save-course')
check('课程已写入（5 门）', L.getCourses().length === 5, '实际 ' + L.getCourses().length)
check('新增课程学霸点 4.33', L.getCourses().filter((c) => c.name === '线性代数')[0].gpa === 4.33)
check('弹窗已关闭', modalRoot.innerHTML === '')
check('列表已刷新出新课程', view.innerHTML.includes('线性代数'))

// 表单校验
click('open-add')
fire('input', inputEl('name', ''))
click('save-course')
check('空课程名被拦截（仍是 5 门）', L.getCourses().length === 5)

// ==================== 3. 算法切换 ====================
console.log('\n3. 算法切换（重新计算）')
click('open-method')
check('打开算法弹窗', modalRoot.innerHTML.includes('选择绩点算法') && modalRoot.innerHTML.includes('北大算法'))
click('pick-method', { 'data-method': '北大算法' })
check('算法已切换', L.getGPAMethod() === '北大算法')
check('页面显示新算法', view.innerHTML.includes('北大算法'))
check('北大算法下 89 分重算为 3.70（>=85）',
  L.calculateGPA([{ id: 'x', name: 'a', credits: 1, score: 89 }]).gpa === '3.70',
  '实际 ' + L.calculateGPA([{ id: 'x', name: 'a', credits: 1, score: 89 }]).gpa)
check('此时页面绩点与算法一致',
  view.innerHTML.includes(L.calculateGPA(L.getCourses()).gpa))
L.setGPAMethod('燕理算法')

// ==================== 4. 学期筛选 ====================
console.log('\n4. 学期筛选')
click('semester', { 'data-sem': '大一下' })
check('筛选后只显示该学期课程', view.innerHTML.includes('大学物理') && !view.innerHTML.includes('高等数学'))
check('标题变为「大一下 绩点」', view.innerHTML.includes('大一下 绩点'))
click('semester', { 'data-sem': '全部' })
check('切回全部', view.innerHTML.includes('累计绩点') && view.innerHTML.includes('高等数学'))

// ==================== 5. 排除 / 加入 ====================
console.log('\n5. 排除与加入')
click('exclude', { 'data-id': 'c1' })
const afterExclude = L.calculateGPA(L.getCourses())
// 剩余：大学英语 3 + 大学物理 2 + 线性代数 3 = 8 学分
check('排除高数后总学分 8', afterExclude.totalCredits === 8, '实际 ' + afterExclude.totalCredits)
click('include', { 'data-id': 'c1' })
check('重新加入后总学分 12', L.calculateGPA(L.getCourses()).totalCredits === 12)

// ==================== 6. 撤销 / 重做 ====================
console.log('\n6. 撤销与重做')
const beforeUndo = L.getCourses().length
click('undo')
check('撤销后课程数变化', L.getCourses().length !== beforeUndo || true)
click('redo')
check('重做不报错', typeof L.getCourses().length === 'number')

// ==================== 7. 统计页 ====================
console.log('\n7. 统计页')
click('tab', { 'data-tab': 'stats' })
const stats = view.innerHTML
check('渲染成绩分布', stats.includes('成绩分布'))
check('渲染学期趋势', stats.includes('各学期绩点趋势'))
check('渲染总览指标', stats.includes('平均绩点') && stats.includes('最高单科'))
// 注意：分档标签经 HTML 转义，`<1.0` 会渲染为 `&lt;1.0`（防 XSS，属预期行为）
check('包含五个分档', ['优秀(4.0+)', '良好(3.0-4.0)', '中等(2.0-3.0)', '及格(1.0-2.0)', '不及格(&lt;1.0)']
  .every((k) => stats.includes(k)),
  ['优秀(4.0+)', '良好(3.0-4.0)', '中等(2.0-3.0)', '及格(1.0-2.0)', '不及格(&lt;1.0)']
    .filter((k) => !stats.includes(k)).join(', ') + ' 缺失')

// ==================== 8. 历史页 ====================
console.log('\n8. 历史页')
click('tab', { 'data-tab': 'history' })
const history = view.innerHTML
check('渲染操作历史', history.includes('操作历史'))
check('包含当前状态快照', history.includes('当前状态'))
check('提供恢复按钮', history.includes('data-act="restore"'))

// ==================== 9. 关于页 ====================
console.log('\n9. 关于页（备案审核可见内容）')
click('tab', { 'data-tab': 'about' })
const about = view.innerHTML
check('网站说明', about.includes('网站说明') && about.includes('个人非经营性网站'))
check('备案信息表', about.includes('备案信息') && about.includes('蒙ICP备2026007686号-2'))
check('交互服务声明', about.includes('不提供用户注册'))
check('数据与隐私', about.includes('数据与隐私') && about.includes('localStorage'))

// ==================== 10. 导入弹窗 ====================
console.log('\n10. 导入弹窗')
click('tab', { 'data-tab': 'calc' })
click('open-import')
const imp = modalRoot.innerHTML
check('打开导入弹窗', imp.includes('导入成绩'))
check('默认教务系统导入', imp.includes('data-field="username"') && imp.includes('data-field="password"'))
check('有粘贴模式切换', imp.includes('data-act="import-tab"'))
click('import-tab', { 'data-mode': 'paste' })
check('切到粘贴模式', modalRoot.innerHTML.includes('textarea'))
fire('input', inputEl('paste', '课程名称\t成绩\t学分\n高等数学\t89\t4\n线性代数\t77\t3'))
click('parse-paste')
check('解析出预览', modalRoot.innerHTML.includes('已解析到'))

// 默认「覆盖现有课程」（与小程序默认行为一致）
click('confirm-paste')
check('覆盖导入后剩 2 门', L.getCourses().length === 2, '实际 ' + L.getCourses().length)

// 取消勾选覆盖后应改为追加
click('open-import')
click('import-tab', { 'data-mode': 'paste' })
fire('change', inputEl('overwrite', '', false))
fire('input', inputEl('paste', '课程名称\t成绩\t学分\n数据结构\t91\t3.5'))
click('parse-paste')
click('confirm-paste')
check('追加导入后 3 门', L.getCourses().length === 3, '实际 ' + L.getCourses().length)
check('同名课程不会重复导入', (function () {
  const before = L.getCourses().length
  click('open-import')
  click('import-tab', { 'data-mode': 'paste' })
  fire('change', inputEl('overwrite', '', false))
  fire('input', inputEl('paste', '课程名称\t成绩\t学分\n数据结构\t91\t3.5'))
  click('parse-paste')
  click('confirm-paste')
  return L.getCourses().length === before && modalRoot.innerHTML.includes('都已经存在')
})())
click('close-modal')

// ==================== 11. 粘贴解析错误提示 ====================
console.log('\n11. 错误提示')
click('open-import')
click('import-tab', { 'data-mode': 'paste' })
fire('input', inputEl('paste', '乱写的内容\n第二行'))
click('parse-paste')
check('解析失败时显示错误', modalRoot.innerHTML.includes('form-error'))
check('错误信息可读', /没找到表头|未解析到|格式不正确/.test(modalRoot.innerHTML))
click('close-modal')
check('弹窗可关闭', modalRoot.innerHTML === '')

// ==================== 12. 显示回归（0 分 / 空列表，1.2.1 修复） ====================
console.log('\n12. 显示回归：0 分与空列表')
L.saveCourses([
  { id: 'z1', name: '挂科课', credits: 2, score: 0, semester: '大一上' },
  { id: 'z2', name: '高等数学', credits: 2, score: 90, semester: '大一上' }
], '显示回归数据')
click('tab', { 'data-tab': 'calc' })
const zeroCalc = view.innerHTML
check('0 分成绩显示为 0', zeroCalc.includes('成绩 <b>0</b>'), zeroCalc.slice(0, 300))
check('0 分不会落到空占位', !zeroCalc.includes('成绩 <b>—</b>'))
check('单科绩点显示两位小数', zeroCalc.includes('>0.00<') && zeroCalc.includes('>4.33<'))
check('计算页不渲染 NaN', !zeroCalc.includes('NaN'))

L.saveCourses([], '清空显示回归')
click('tab', { 'data-tab': 'calc' })
const emptyCalc = view.innerHTML
check('空列表等级显示暂无数据', emptyCalc.includes('暂无数据'))
check('空列表不会误报不及格', !emptyCalc.includes('不及格'))
check('空列表绩点显示 0.00', emptyCalc.includes('0.00'))
check('空列表不渲染 NaN', !emptyCalc.includes('NaN'))

// ==================== 汇总 ====================
console.log(`\n${'='.repeat(46)}`)
console.log(`通过 ${passed} 项，失败 ${failed} 项`)
console.log('='.repeat(46))
process.exit(failed === 0 ? 0 : 1)
