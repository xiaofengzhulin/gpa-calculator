/**
 * gpa-core.js 单元测试
 * 运行：node tests/gpa-core.test.js
 *
 * 重点验证「网页版算法与微信小程序 miniprogram/utils/util.js 完全一致」。
 */
'use strict'

const L = require('../deploy/site/gpa-core.js')

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

// ==================== 1. 燕理算法分档 ====================
group('1. 燕理算法分档（默认算法）')
check('95 分 = 4.67', L.scoreToGPA(95), 4.67)
check('94 分 = 4.33', L.scoreToGPA(94), 4.33)
check('90 分 = 4.33', L.scoreToGPA(90), 4.33)
check('89 分 = 4.00', L.scoreToGPA(89), 4.00)
check('87 分 = 4.00', L.scoreToGPA(87), 4.00)
check('86 分 = 3.67', L.scoreToGPA(86), 3.67)
check('60 分 = 1.00', L.scoreToGPA(60), 1.00)
check('59 分 = 0', L.scoreToGPA(59), 0)
check('空值不报错 = 0', L.scoreToGPA(''), 0)

// ==================== 2. 其它算法 ====================
group('2. 其它算法')
L.setGPAMethod('标准4.0')
check('标准4.0：85 分 = 3.0', L.scoreToGPA(85), 3.0)
L.setGPAMethod('公式法')
check('公式法：80 分 = 3.25', L.scoreToGPA(80), 3.25)
L.setGPAMethod('浙大算法')
check('浙大算法：85 分 = 4.0', L.scoreToGPA(85), 4.0)
check('浙大算法：60 分 = 1.5', L.scoreToGPA(60), 1.5)
L.setGPAMethod('燕理算法')
check('算法可切回', L.getGPAMethod(), '燕理算法')

// ==================== 3. 等级换算 ====================
group('3. 等级成绩')
check('A = 4.33', L.gradeToGPA('A'), 4.33)
check('A+ = 4.67', L.gradeToGPA('A+'), 4.67)
check('F = 0', L.gradeToGPA('F'), 0)
check('P 归零', L.gradeToGPA('P'), null)
check('中文等级 优 -> A', L.normalizeGrade('优'), 'A')
check('中文等级 不及格 -> F', L.normalizeGrade('不及格'), 'F')
check('无法识别 -> null', L.normalizeGrade('通过'), null)

// ==================== 4. 绩点汇总与排除规则 ====================
group('4. 绩点汇总与排除规则')
const sample = [
  { id: 'a', name: '高等数学', credits: 4, score: 89, semester: '大一上' },   // 4.00 * 4 = 16
  { id: 'b', name: '大学英语', credits: 3, score: 78, semester: '大一上' },   // 3.00 * 3 = 9
  { id: 'c', name: '体育（一）', credits: 1, score: 95, semester: '大一上' }, // 体育自动排除
  { id: 'd', name: '大学物理', credits: 2, score: 62, semester: '大一下' }    // 1.33 * 2 = 2.66
]
const r1 = L.calculateGPA(sample)
check('总学分（排除体育）', r1.totalCredits, 9)
check('已获学分', r1.earnedCredits, 9)
check('绩点 (16+9+2.66)/9 = 3.07', r1.gpa, '3.07')
check('计入课程数', r1.courseCount, 3)
check('体育课被识别为排除项', L.getExcludedCourses(sample).map(c => c.name), ['体育（一）'])

const withForce = sample.map(c => (c.id === 'c' ? L.includeCourse(c) : c))
check('手动加入后计入 10 学分', L.calculateGPA(withForce).totalCredits, 10)

const excluded = sample.map(c => (c.id === 'a' ? L.excludeCourse(c) : c))
check('手动排除后计入 5 学分', L.calculateGPA(excluded).totalCredits, 5)

const elective = [{ id: 'e', name: '音乐鉴赏', credits: 2, score: 90, semester: '大一下', type: '公共选修课' }]
check('公共选修课自动排除', L.calculateGPA(elective).totalCredits, 0)

check('全部排除时绩点 0.00', L.calculateGPA([]).gpa, '0.00')

// ==================== 5. 统计 ====================
group('5. 统计口径')
const stats = L.calculateStatistics(sample)
check('统计课程数', stats.totalCourses, 3)
check('统计总学分', stats.totalCredits, 9)
check('统计平均绩点', stats.averageGPA, '3.07')
check('最高单科', stats.highestGPA, 4)
check('最低单科', stats.lowestGPA, 1.33)
check('成绩分布键', Object.keys(stats.gradeDistribution),
  ['优秀(4.0+)', '良好(3.0-4.0)', '中等(2.0-3.0)', '及格(1.0-2.0)', '不及格(<1.0)'])
check('学期趋势条数', stats.semesterTrend.length, 2)
check('学期趋势按名称排序', stats.semesterTrend.map(s => s.semester), ['大一上', '大一下'])
check('大一上绩点 (16+9)/7 = 3.57', stats.semesterTrend[0].gpa, '3.57')

// ==================== 6. 文本表格解析（制表符） ====================
group('6. 粘贴解析：制表符表格')
const tabText = [
  '序号\t开课学期\t课程名称\t成绩\t学分\t绩点\t课程性质',
  '1\t2023-2024-1\t高等数学\t89\t4\t4.00\t必修',
  '2\t2023-2024-1\t大学体育\t95\t1\t4.67\t必修',
  '3\t2023-2024-2\t大学英语\t良\t3\t3.33\t必修'
].join('\n')
const p1 = L.parseScoreText(tabText)
check('解析成功', p1.ok, true)
check('解析出 3 门', p1.courses.length, 3)
check('课程名', p1.courses[0].name, '高等数学')
check('成绩为数字', p1.courses[0].score, 89)
check('学分', p1.courses[0].credits, 4)
check('学期', p1.courses[0].semester, '2023-2024-1')
check('课程性质', p1.courses[0].type, '必修')
check('等级成绩被归一化', [p1.courses[2].grade, p1.courses[2].score], ['B', undefined])
check('沿用表格里的绩点', p1.courses[2].gpa, 3.33)

// ==================== 7. 粘贴解析：多空格分隔 & 异常输入 ====================
group('7. 粘贴解析：空格分隔与异常输入')
const spaceText = [
  '课程名称    成绩    学分',
  '线性代数    77    3',
  '概率论      优    2'
].join('\n')
const p2 = L.parseScoreText(spaceText)
check('空格分隔也能解析', p2.courses.length, 2)
check('77 分课程', p2.courses[0].name, '线性代数')

check('空内容返回错误', L.parseScoreText('').ok, false)
check('无表头返回错误', L.parseScoreText('随便写点东西\n再来一行').ok, false)
check('格式错误提示不为空', L.parseScoreText('随便写点东西\n再来一行').error.length > 0, true)

// ==================== 8. 剪贴板 HTML 表格解析（表头定位） ====================
group('8. 剪贴板表格映射')
const headers = ['序号', '开课学期', '课程名称', '成绩', '学分', '绩点']
const rows = [['1', '2024-2025-1', '数据结构', '91', '3.5', '4.33']]
const p3 = L.mapRows(headers, rows)
check('HTML 行映射成功', p3.courses[0].name, '数据结构')
check('HTML 行学分', p3.courses[0].credits, 3.5)
check('缺列时报错', L.mapRows(['课程名称'], [['x']]).ok, false)

// ==================== 9. 撤销 / 重做 / 快照 ====================
group('9. 撤销与历史快照')
L.saveCourses([], '初始化')
check('初始为空', L.getCourses().length, 0)
check('初始不可撤销', L.canUndo(), true) // 初始化本身压栈了一次

L.saveCourses([{ id: 'x', name: '测试课', credits: 2, score: 80, semester: '大一上' }], '添加课程: 测试课')
check('添加后 1 门', L.getCourses().length, 1)

const undone = L.undo()
check('撤销描述', undone, '添加课程: 测试课')
check('撤销后为空', L.getCourses().length, 0)
check('可以重做', L.canRedo(), true)

L.redo()
check('重做后 1 门', L.getCourses().length, 1)

const snapshots = L.getSnapshots(15)
check('快照首项是当前状态', snapshots[0].isCurrent, true)
check('快照包含历史', snapshots.length > 1, true)

L.restoreSnapshot(snapshots[snapshots.length - 1])
check('恢复快照后课程数变化', L.getCourses().length >= 0, true)

// ==================== 10. 颜色 / 等级 ====================
group('10. 等级与配色')
check('4.0 以上为优秀', L.getGradeLevel(4.0), '优秀')
check('3.0 为良好', L.getGradeLevel(3.0), '良好')
check('2.0 为中等', L.getGradeLevel(2.0), '中等')
check('1.0 为及格', L.getGradeLevel(1.0), '及格')
check('0.9 为不及格', L.getGradeLevel(0.9), '不及格')
check('优秀配色', L.getGradeColor(4.1), '#52c41a')
check('不及格配色', L.getGradeColor(0.5), '#ff4d4f')
check('无有效绩点时等级为暂无数据', L.getGradeLevel(NaN), '暂无数据')

// ==================== 11. 脏数据兜底（与小程序 1.2.1 对齐） ====================
group('11. 脏数据兜底（1.2.1 修复）')
const resetStore = () => {
  ;[L.KEYS.courses, L.KEYS.undo, L.KEYS.redo, L.KEYS.history].forEach((key) => L.storage.remove(key))
}

// ---- 学分缺失 / 非法 ----
check('缺失学分不计入总学分', L.calculateGPA([{ name: '高数', score: 90 }]).totalCredits, 0)
check('缺失学分时已获学分为 0', L.calculateGPA([{ name: '高数', score: 90 }]).earnedCredits, 0)
check('缺失学分时总分为 0.00', L.calculateGPA([{ name: '高数', score: 90 }]).totalPoints, '0.00')
check('非法学分按 0 处理', L.calculateGPA([{ name: '高数', credits: 'abc', score: 90 }]).totalCredits, 0)
check('负学分按 0 处理', L.calculateGPA([{ name: '高数', credits: -3, score: 90 }]).totalCredits, 0)
check('零学分按 0 处理', L.calculateGPA([{ name: '高数', credits: 0, score: 90 }]).totalCredits, 0)
check('学分累加消除浮点误差', L.calculateGPA([
  { name: 'A', credits: 0.1, score: 90 },
  { name: 'B', credits: 0.2, score: 90 }
]).totalCredits, 0.3)
check('toCredits 辅助函数', L.toCredits('2.5'), 2.5)

// ---- 非数组 / 脏课程条目 ----
check('非数组输入不崩溃', L.calculateGPA('not-an-array').gpa, '0.00')
check('含 null 的课程列表不崩溃', L.calculateGPA([null, { name: '高数', credits: 2, score: 90 }]).totalCredits, 2)
check('课程名为 undefined 不抛异常', L.filterCourses([{ credits: 2, score: 90 }]).length, 1)
check('shouldExcludeCourse(undefined) 为 false', L.shouldExcludeCourse(undefined), false)
check('shouldExcludeCourse(null) 为 false', L.shouldExcludeCourse(null), false)
check('存储被污染成字符串时返回空数组', (() => {
  resetStore()
  L.storage.set(L.KEYS.courses, 'broken')
  return L.getCourses().length
})(), 0)
check('存储中的非对象课程被过滤', (() => {
  L.storage.set(L.KEYS.courses, JSON.stringify([null, 'x', 3, { id: 'ok', name: '高数', credits: 2, score: 90 }]))
  return L.getCourses().length
})(), 1)
check('过滤脏数据后仍可正常计算', L.calculateGPA(L.getCourses()).totalCredits, 2)

// ---- 缺失学期 / 0 分 / 浮点误差 ----
check('缺失学期归入未知学期', L.calculateStatistics([{ name: '高数', credits: 4, score: 90 }]).semesterTrend[0].semester, '未知学期')
check('空白学期归入未知学期', L.calculateStatistics([{ name: '高数', credits: 4, score: 90, semester: '   ' }]).semesterTrend[0].semester, '未知学期')
check('0 分成绩绩点为 0', L.getCourseGPA({ name: '挂科', credits: 2, score: 0 }), 0)
check('空字符串成绩不算 0 分档绩点', L.getCourseGPA({ name: '无成绩', credits: 2, score: '' }), 0)
check('0 分参与 GPA 计算', L.calculateGPA([
  { name: '挂科', credits: 2, score: 0 },
  { name: '优秀', credits: 2, score: 90 }
]).gpa, '2.17')
check('统计最低绩点可为 0（不是 4.67）', L.calculateStatistics([{ name: '挂科', credits: 2, score: 0 }]).lowestGPA, 0)
check('统计最高绩点可为 0', L.calculateStatistics([{ name: '挂科', credits: 2, score: 0 }]).highestGPA, 0)
check('P 等级归零不参与', L.getCourseGPA({ name: '通过', credits: 2, grade: 'P' }), 0)
L.setGPAMethod('浙大算法')
check('浙大 76.5 单科绩点 3.15（无浮点噪声）', L.getCourseGPA({ score: 76.5 }), 3.15)
check('round2 消除浮点噪声', L.round2(3.1500000000000004), 3.15)
L.setGPAMethod('燕理算法')

// ---- 空结果分档 ----
const emptyStats = L.calculateStatistics([])
check('空结果返回完整五分档', Object.keys(emptyStats.gradeDistribution),
  ['优秀(4.0+)', '良好(3.0-4.0)', '中等(2.0-3.0)', '及格(1.0-2.0)', '不及格(<1.0)'])
check('空结果分档全为 0', Object.keys(emptyStats.gradeDistribution).map((k) => emptyStats.gradeDistribution[k]),
  [0, 0, 0, 0, 0])

// ---- 撤销 / 重做 ----
resetStore()
L.saveCourses([], '初始化')
check('saveCourses(null) 不崩溃且保存为空', (() => {
  L.saveCourses(null, '空数据')
  return L.getCourses().length
})(), 0)
L.saveCourses([null, { id: 'a', name: 'A', credits: 2, score: 90 }], '添加 A')
check('saveCourses 过滤非对象条目', L.getCourses().length, 1)
L.undo()
check('撤销后可以重做', L.canRedo(), true)
L.saveCourses([{ id: 'b', name: 'B', credits: 2, score: 80 }], '添加 B')
check('新保存清空重做栈', L.canRedo(), false)
for (let i = 0; i < 60; i++) {
  L.saveCourses([{ id: 'c' + i, name: 'C' + i, credits: 1, score: 70 }], '批量' + i)
}
check('撤销栈上限 50 条', JSON.parse(L.storage.get(L.KEYS.undo)).length, 50)

// 非数组 courses 的撤销条目应被忽略
L.storage.set(L.KEYS.undo, JSON.stringify([
  { description: 'bad', courses: 'not-array' },
  null,
  { description: 'good', courses: [] }
]))
check('撤销栈忽略非数组 courses 条目', L.getSnapshots(15).length, 2)
L.storage.set(L.KEYS.undo, 'broken')
check('撤销栈被污染时不可撤销', L.canUndo(), false)

// ---- 历史记录 ----
resetStore()
for (let i = 0; i < 120; i++) L.saveHistory({ type: 'add', index: i })
const history = JSON.parse(L.storage.get(L.KEYS.history))
check('历史最多保留 100 条', history.length, 100)
check('历史保留最新记录', history[0].index, 119)
const historyCount = history.length
L.saveHistory(null)
L.saveHistory('bad-record')
L.saveHistory(undefined)
check('非法历史记录被忽略', JSON.parse(L.storage.get(L.KEYS.history)).length, historyCount)
L.storage.set(L.KEYS.history, 'broken')
check('历史存储被污染时返回空数组', L.getHistory().length, 0)

// ==================== 汇总 ====================
console.log(`\n${'='.repeat(46)}`)
console.log(`通过 ${passed} 项，失败 ${failed} 项`)
console.log('='.repeat(46))
process.exit(failed === 0 ? 0 : 1)
