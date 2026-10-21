/**
 * 小程序端核心逻辑单元测试（1.2.1 起）
 * 运行：node tests/miniprogram-util.test.js
 *
 * 直接用 Node 跑 miniprogram/ 下的真实代码：给全局注入一个极简 wx / Page，
 * 即可在没有微信开发者工具的环境里回归 utils/util.js 与登录页的导入合并逻辑。
 */
'use strict'

// ==================== 极简微信运行时桩 ====================
const storage = {}
const toasts = []
const modals = []
const actionSheets = []
// 测试里按需替换：模拟用户点选/取消 ActionSheet
let actionSheetHandler = null
// 设备信息桩：用于验证「密文绑定本机」
let deviceInfo = { brand: 'Test', model: 'UnitTest', system: 'test-1', platform: 'devtools' }
// autoImport 结尾用 setTimeout 切到首页，测试里立即执行，避免挂起进程
global.setTimeout = (fn) => { if (typeof fn === 'function') fn(); return 0 }

const clone = (value) => (value === undefined ? '' : JSON.parse(JSON.stringify(value)))

global.wx = {
  getStorageSync(key) {
    return key in storage ? clone(storage[key]) : ''
  },
  setStorageSync(key, value) {
    storage[key] = clone(value)
  },
  removeStorageSync(key) {
    delete storage[key]
  },
  showToast(options) {
    toasts.push(options && options.title)
  },
  showModal(options) {
    modals.push(options)
    // 默认按「确认」处理，测试覆盖导入会用到
    if (options && typeof options.success === 'function') {
      options.success({ confirm: true, cancel: false })
    }
  },
  setClipboardData(options) {
    if (options && typeof options.success === 'function') options.success()
  },
  showActionSheet(options) {
    actionSheets.push(options)
    if (actionSheetHandler) {
      actionSheetHandler(options)
    } else if (typeof options.fail === 'function') {
      options.fail({ errMsg: 'showActionSheet:fail cancel' })
    }
  },
  getDeviceInfo() {
    return deviceInfo
  },
  getAccountInfoSync() {
    return { miniProgram: { appId: 'wxe071ce7f92759377' } }
  },
  navigateTo() {},
  switchTab() {},
  previewImage() {},
  request() {}
}

let pageConfig = null
global.Page = (config) => { pageConfig = config }
global.App = () => {}

const util = require('../miniprogram/utils/util.js')
const secureStore = require('../miniprogram/utils/secure-store.js')
const api = require('../miniprogram/utils/api.js')
require('../miniprogram/pages/login/login.js')
const loginPageConfig = pageConfig

require('../miniprogram/pages/index/index.js')
const indexPageConfig = pageConfig

// 用真实页面配置构造一个可调用的「页面实例」
function makePage(config) {
  const ctx = { data: clone(config.data) }
  Object.keys(config).forEach((key) => {
    if (key !== 'data') ctx[key] = config[key]
  })
  ctx.setData = function setData(patch) {
    Object.assign(this.data, patch)
  }
  return ctx
}

const loginPage = makePage(loginPageConfig)

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

const resetStore = () => {
  Object.keys(storage).forEach(key => delete storage[key])
  util._clearCache()
}

// ==================== 1. 算法分档与网页版一致 ====================
group('1. 算法分档')
check('燕理：95 = 4.67', util.scoreToGPA(95), 4.67)
check('燕理：84 = 3.67', util.scoreToGPA(84), 3.67)
check('燕理：59 = 0', util.scoreToGPA(59), 0)
util.setGPAMethod('浙大算法')
check('浙大：76.5 = 3.15（无浮点噪声）', util.getCourseGPA({ score: 76.5 }), 3.15)
util.setGPAMethod('燕理算法')
check('算法可切回', util.getGPAMethod(), '燕理算法')

// ==================== 2. 脏数据兜底 ====================
group('2. 脏数据兜底（1.2.1 修复）')
resetStore()
check('学分缺失不产生 NaN', util.calculateGPA([{ name: '高数', score: 90 }]).totalPoints, '0.00')
check('学分非法不产生 NaN', util.calculateGPA([{ name: '高数', credits: 'abc', score: 90 }]).totalCredits, 0)
check('空数组算 0 绩点', util.calculateGPA([]).gpa, '0.00')
check('非数组输入不崩溃', util.calculateGPA('not-an-array').gpa, '0.00')
check('课程名为 undefined 不抛异常', util.filterCourses([{ credits: 2, score: 90 }]).length, 1)
check('shouldExcludeCourse(undefined) 为 false', util.shouldExcludeCourse(undefined), false)
check('store 被污染成字符串时返回空数组', (() => {
  storage.courses = 'broken'
  util._clearCache()
  return util.getCourses().length
})(), 0)

// ==================== 3. 缺失学期 / 0 分 ====================
group('3. 缺失学期与 0 分（1.2.1 修复）')
resetStore()
check('缺失学期归入未知学期', util.calculateStatistics([{ name: '高数', credits: 4, score: 90 }]).semesterTrend[0].semester, '未知学期')
check('0 分成绩绩点为 0', util.getCourseGPA({ name: '体育', credits: 1, score: 0 }), 0)
check('0 分参与 GPA 计算', util.calculateGPA([
  { name: '挂科', credits: 2, score: 0 },
  { name: '优秀', credits: 2, score: 90 }
]).gpa, '2.17')
check('空字符串成绩不算 0 分档绩点', util.getCourseGPA({ name: '无成绩', credits: 2, score: '' }), 0)
check('统计最低绩点可为 0', util.calculateStatistics([{ name: '挂科', credits: 2, score: 0 }]).lowestGPA, 0)
check('P 等级归零不参与', util.getCourseGPA({ name: '通过', credits: 2, grade: 'P' }), 0)

// ==================== 4. 排除规则 ====================
group('4. 排除规则')
const withSports = [
  { id: '1', name: '体育（一）', credits: 1, score: 90 },
  { id: '2', name: '军事理论', credits: 1, score: 90, type: '公共选修课' },
  { id: '3', name: '高等数学', credits: 4, score: 90 },
  { id: '4', name: '大学物理', credits: 3, score: 80, forceIncluded: true, type: '通识实践' }
]
check('体育/公选课被排除', util.filterCourses(withSports).map(c => c.id), ['3', '4'])
check('forceIncluded 覆盖排除规则', util.filterCourses(withSports).some(c => c.id === '4'), true)
check('forceExcluded 优先排除', util.filterCourses([{ id: '9', name: '高数', credits: 2, score: 90, forceExcluded: true }]).length, 0)

// ==================== 5. 撤销 / 重做 / 快照 ====================
group('5. 撤销、重做与上限')
resetStore()
util.saveCourses([], '初始化')
util.saveCourses([{ id: 'a', name: 'A', credits: 2, score: 90 }], '添加 A')
check('撤销返回操作描述', util.undo(), '添加 A')
check('撤销后回到空列表', util.getCourses().length, 0)
check('可重做', util.canRedo(), true)
util.redo()
check('重做后恢复 1 门', util.getCourses().length, 1)
util.saveCourses([{ id: 'b', name: 'B', credits: 2, score: 80 }], '添加 B')
check('新操作清空重做栈', util.canRedo(), false)
for (let i = 0; i < 60; i++) {
  util.saveCourses([{ id: `c${i}`, name: `C${i}`, credits: 1, score: 70 }], `批量${i}`)
}
check('撤销栈上限 50', JSON.parse(JSON.stringify(storage.undoStack)).length, 50)

// ==================== 6. 历史记录上限 ====================
group('6. 历史记录')
resetStore()
for (let i = 0; i < 120; i++) util.saveHistory({ type: 'add', time: new Date().toISOString() })
check('历史最多保留 100 条', JSON.parse(JSON.stringify(storage.history)).length, 100)
check('非法记录被忽略', (() => {
  const before = JSON.parse(JSON.stringify(storage.history)).length
  util.saveHistory(null)
  return JSON.parse(JSON.stringify(storage.history)).length === before
})(), true)

// ==================== 7. 登录页导入合并逻辑 ====================
group('7. 导入合并与去重（1.2.1 修复）')
resetStore()
util.saveCourses([{ id: 'manual', name: '手动添加课', credits: 2, score: 85, semester: '大一上' }], '手动添加')

const serverCourses = [
  { name: '数据库原理', credits: '3', score: '92', semester: '2024-2025-1', courseType: '专业必修课', gpa: '4.33' },
  { name: '体育（一）', credits: '1', score: '良好', semester: '2024-2025-1' },
  { name: '无学分课程', credits: '', score: '90', semester: '2024-2025-1' },
  { name: '', credits: '2', score: '90', semester: '2024-2025-1' }
]
const mergeResult = loginPage._importCourses(serverCourses, 'merge')
check('合并导入新增 2 门', mergeResult.count, 2)
check('跳过脏数据计数正确', mergeResult.skipped, 2)
check('合并保留手动课程', util.getCourses().some(c => c.name === '手动添加课'), true)
check('等级成绩被归一化', util.getCourses().find(c => c.name === '体育（一）').grade, 'B')

const againResult = loginPage._importCourses(serverCourses, 'merge')
check('重复导入不会重复写入', againResult.count, 0)
check('重复导入被计入跳过', againResult.skipped, 4)

// 同名不同学期必须分别保留
const sameName = [
  { name: '形势与政策', credits: '1', score: '90', semester: '2023-2024-1' },
  { name: '形势与政策', credits: '1', score: '95', semester: '2023-2024-2' }
]
resetStore()
const sameNameResult = loginPage._importCourses(sameName, 'replace')
check('同名不同学期保留两门', sameNameResult.count, 2)
check('覆盖模式先清空旧数据', util.getCourses().length, 2)

// ==================== 8. 算法选择持久化 ====================
group('8. 算法持久化')
resetStore()
util.setGPAMethod('北大算法')
check('切换算法写入缓存', storage.gpaMethod, '北大算法')
util.setGPAMethod('不存在的算法')
check('非法算法名被忽略', util.getGPAMethod(), '北大算法')

// ==================== 9. 手动粘贴表格解析 ====================
group('9. 手动粘贴表格解析')
// 教务系统复制的表头里同时有「成绩」和「成绩标志」，两者都含「成绩」二字
const pasted = [
  '序号\t开课学期\t课程编号\t课程名称\t成绩\t成绩标志\t学分\t总学时\t绩点',
  '1\t2024-2025-1\tART00200T\t美学导论\t优\t\t1\t16\t',
  '2\t2024-2025-1\tMATH001\t高等数学\t92\t\t4\t64\t4.33'
].join('\n')
const parsedRows = loginPage._parseScoreText(pasted)
check('解析出 2 门课程', parsedRows.length, 2)
check('成绩列不会被「成绩标志」抢占', parsedRows[1].score, 92)
check('中文等级归一化', parsedRows[0].grade, 'A')
check('学期原样保留', parsedRows[0].semester, '2024-2025-1')
check('绩点列被读取', parsedRows[1].gpa, 4.33)

// ==================== 10. 添加/编辑课程页面逻辑 ====================
group('10. 添加课程校验与编辑学期保留')
resetStore()
const indexPage = makePage(indexPageConfig)

indexPage.setData({
  currentCourse: { name: '空成绩课', credits: '2', score: '', grade: '', semester: '大一上' },
  scoreTypeIndex: 0,
  gradeIndex: 0,
  semesterIndex: 0,
  isEdit: false,
  editIndex: -1
})
indexPage.saveCourse()
check('空成绩不允许保存', util.getCourses().length, 0)
check('空成绩给出明确提示', toasts[toasts.length - 1], '请输入有效成绩(0-100)')

indexPage.setData({ currentCourse: { name: '非法学分课', credits: 'abc', score: '90', grade: '', semester: '大一上' } })
indexPage.saveCourse()
check('非法学分不允许保存', util.getCourses().length, 0)

indexPage.setData({ currentCourse: { name: '挂科课', credits: '2', score: '0', grade: '', semester: '大一上' } })
indexPage.saveCourse()
check('0 分成绩可以保存', util.getCourses().length, 1)
check('0 分成绩没有被吞掉', util.getCourses()[0].score, 0)

// 编辑教务系统导入的课程时，不能把学期改成「大一上」
resetStore()
util.saveCourses([{
  id: 'imported-1',
  name: '高等数学',
  credits: 4,
  score: 88,
  semester: '2024-2025-1',
  type: '专业必修课'
}], '导入课程')
const editPage = makePage(indexPageConfig)
editPage.setData({
  filterSemester: '全部',
  semesters: ['大一上', '大一下', '2024-2025-1'],
  courses: [{
    id: 'imported-1',
    name: '高等数学',
    credits: 4,
    score: 88,
    semester: '2024-2025-1',
    type: '专业必修课',
    gpa: '3.67',
    gpaColor: '#4A90E2',
    scoreText: '88'
  }]
})
editPage.editCourse({ currentTarget: { dataset: { id: 'imported-1' } } })
check('编辑弹窗保留原学期', editPage.data.currentCourse.semester, '2024-2025-1')
check('学期下拉定位到原学期', editPage.data.semesters[editPage.data.semesterIndex], '2024-2025-1')
editPage.setData({ currentCourse: Object.assign({}, editPage.data.currentCourse, { score: '90' }) })
editPage.saveCourse()
check('保存后学期不被篡改', util.getCourses()[0].semester, '2024-2025-1')
check('保存后课程性质保留', util.getCourses()[0].type, '专业必修课')

// 空数据时首页不能显示「不及格」
resetStore()
const emptyPage = makePage(indexPageConfig)
emptyPage.loadCourses()
check('无课程时等级为「暂无数据」', emptyPage.data.gradeLevel, '暂无数据')
check('无课程时绩点为 0.00', emptyPage.data.gpa, '0.00')

// ==================== 11. 导入模式选择 / 结果回显（1.2.1 补充） ====================
;(async () => {
  group('11. 导入模式选择与结果回显')

  resetStore()
  check('无本地课程时直接走覆盖', await loginPage.chooseImportMode(), 'replace')

  util.saveCourses([{ id: 'k1', name: '已有课', credits: 2, score: 80, semester: '大一上' }], '已有数据')
  const options = { itemList: [] }
  actionSheetHandler = (opts) => {
    Object.assign(options, opts)
    opts.success && opts.success({ tapIndex: 0 })
  }
  check('有本地课程时弹出选择', await loginPage.chooseImportMode(), 'replace')
  check('选择项包含「取消」', options.itemList.length, 3)
  check('选择项顺序正确', options.itemList[0], '覆盖导入')
  check('提示文案带课程数', /已有 1 门课程/.test(options.alertText), true)

  actionSheetHandler = (opts) => opts.success && opts.success({ tapIndex: 1 })
  check('选择合并', await loginPage.chooseImportMode(), 'merge')
  actionSheetHandler = (opts) => opts.success && opts.success({ tapIndex: 2 })
  check('选择取消返回 null', await loginPage.chooseImportMode(), null)
  actionSheetHandler = null
  check('点遮罩关闭视为取消', await loginPage.chooseImportMode(), null)

  // 导入结果只回显真正写入的课程
  resetStore()
  const r = loginPage._importCourses([
    { name: '课程A', credits: '2', score: '90', semester: 's1' },
    { name: '课程A', credits: '2', score: '80', semester: 's1' },
    { name: '', credits: '2', score: '90', semester: 's1' }
  ], 'replace')
  check('写入 1 门', r.count, 1)
  check('重复 1 条', r.duplicated, 1)
  check('无效 1 条', r.invalid, 1)
  check('跳过量=重复+无效', r.skipped, 2)
  check('imported 只含写入项', r.imported.length, 1)
  check('imported 带唯一 id', r.imported[0].id, util.getCourses()[0].id)

  // 编辑旧数据里的非常规等级（如 P）不能被悄悄改回 A+
  resetStore()
  util.saveCourses([{ id: 'g1', name: '体育课', credits: 1, grade: 'P', semester: '大一上' }], '导入')
  const gradePage = makePage(indexPageConfig)
  gradePage.setData({
    courses: [{
      id: 'g1', name: '体育课', credits: 1, grade: 'P', semester: '大一上',
      gpa: '0.00', gpaColor: '#ff4d4f', scoreText: 'P'
    }]
  })
  gradePage.editCourse({ currentTarget: { dataset: { id: 'g1' } } })
  check('非常规等级被补进下拉', gradePage.data.grades.includes('P'), true)
  check('下拉定位到该等级', gradePage.data.grades[gradePage.data.gradeIndex], 'P')
  gradePage.saveCourse()
  check('保存后等级未被改成 A+', util.getCourses()[0].grade, 'P')

  // ==================== 12. 密码加密存储集成 ====================
  group('12. 密码加密存储与登录页集成')
  secureStore._resetKeyCache()
  resetStore()

  // 旧版本明文密码：登录页 onLoad 时自动迁移成密文
  storage.savedUsername = '202312345678'
  storage.savedPassword = 'old-plain-pass'
  const migratePage = makePage(loginPageConfig)
  migratePage.onLoad()
  check('旧明文被迁移为密文前缀', String(storage.savedPassword).indexOf('enc:v1:'), 0)
  check('登录页能解出原密码', migratePage.data.password, 'old-plain-pass')
  check('勾选状态跟随实际存储', migratePage.data.savePassword, true)

  // 勾选保存 → 落盘是密文；不勾选 → 不落盘
  resetStore()
  api.checkHealth = () => Promise.resolve(true)
  api.fetchGrades = () => Promise.resolve({
    success: true,
    courses: [{ name: '加密课', credits: '2', score: '90', semester: '2024-2025-1' }]
  })

  const savePage = makePage(loginPageConfig)
  savePage.setData({ username: '202312345678', password: 'my-secret', savePassword: true })
  await savePage.autoImport()
  check('导入结果已回显', savePage.data.parseResult.show, true)
  check('保存下来的是密文', String(storage.savedPassword).indexOf('enc:v1:'), 0)
  check('缓存里没有明文密码', String(storage.savedPassword).includes('my-secret'), false)
  check('可解密回原密码', secureStore.getSecret('savedPassword'), 'my-secret')

  resetStore()
  const noSavePage = makePage(loginPageConfig)
  noSavePage.setData({ username: '202312345678', password: 'my-secret', savePassword: false })
  await noSavePage.autoImport()
  check('不勾选时不写入密码', 'savedPassword' in storage, false)

  // 换设备：密文解不开 → 安全降级为「未保存」，不报错
  resetStore()
  storage.savedPassword = secureStore.encrypt('device-bound-secret')
  deviceInfo = { brand: 'Other', model: 'OtherPhone', system: 'other-1', platform: 'other' }
  secureStore._resetKeyCache()
  const otherDevicePage = makePage(loginPageConfig)
  otherDevicePage.onLoad()
  check('换设备后读不出密码', otherDevicePage.data.password, '')
  check('换设备后取消勾选', otherDevicePage.data.savePassword, false)
  deviceInfo = { brand: 'Test', model: 'UnitTest', system: 'test-1', platform: 'devtools' }
  secureStore._resetKeyCache()

  // ==================== 汇总 ====================
  console.log(`\n${'='.repeat(46)}`)
  console.log(`通过 ${passed} 项，失败 ${failed} 项`)
  console.log('='.repeat(46))
  process.exit(failed === 0 ? 0 : 1)
})()
