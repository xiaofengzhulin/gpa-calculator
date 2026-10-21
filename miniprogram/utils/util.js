/**
 * 绩点计算工具类
 * 遵循微信小程序最佳实践：减少IO操作、缓存数据、最小化setData
 */

// ==================== 常量定义 ====================
const EXCLUDE_KEYWORDS = ['体育']
const UNKNOWN_SEMESTER = '未知学期'

// 存储缓存（减少重复IO）
let _coursesCache = null
let _undoStackCache = null
let _redoStackCache = null

// ==================== 缓存管理 ====================
const _clearCache = () => {
  _coursesCache = null
  _undoStackCache = null
  _redoStackCache = null
}

// 本地缓存可能被旧版本或异常写入污染，统一在此兜底为数组
const _asArray = (value) => (Array.isArray(value) ? value : [])

// 过滤掉非对象的脏数据，避免下游 .name / .credits 取值抛异常
const _asCourseList = (value) => _asArray(value).filter(item => item && typeof item === 'object')

const _getCoursesRaw = () => {
  if (_coursesCache === null) {
    _coursesCache = _asCourseList(wx.getStorageSync('courses'))
  }
  return _coursesCache
}

const _getUndoStack = () => {
  if (_undoStackCache === null) {
    _undoStackCache = _asArray(wx.getStorageSync('undoStack'))
      .filter(entry => entry && typeof entry === 'object' && Array.isArray(entry.courses))
  }
  return _undoStackCache
}

const _getRedoStack = () => {
  if (_redoStackCache === null) {
    _redoStackCache = _asArray(wx.getStorageSync('redoStack'))
      .filter(entry => entry && typeof entry === 'object' && Array.isArray(entry.courses))
  }
  return _redoStackCache
}

// ==================== 数值兜底 ====================
// 学分：非数字 / 负数 / 0 一律按 0 处理，避免 NaN 污染总分与总学分
const toCredits = (value) => {
  const credits = Number(value)
  return Number.isFinite(credits) && credits > 0 ? credits : 0
}

// 保留两位小数，消除浮点误差（如 3.1500000000000004）
const round2 = (value) => Math.round(Number(value) * 100) / 100

const normalizeSemester = (value) => {
  const semester = String(value === undefined || value === null ? '' : value).trim()
  return semester || UNKNOWN_SEMESTER
}

// ==================== 排除规则 ====================
const shouldExcludeCourse = (courseName) => {
  const name = String(courseName === undefined || courseName === null ? '' : courseName)
  return EXCLUDE_KEYWORDS.some(kw => name.includes(kw))
}

const isPublicElective = (course) => {
  const type = String((course && course.type) || '')
  return type.includes('公共选修课') || type.includes('通识教育选修') || type.includes('通识实践') || type.includes('军体')
}

const filterCourses = (courses) => {
  return _asCourseList(courses).filter(c => {
    if (c.forceExcluded) return false
    if (c.forceIncluded) return true
    return !isPublicElective(c) && !shouldExcludeCourse(c.name)
  })
}

const getExcludedCourses = (courses) => {
  return _asCourseList(courses).filter(c => {
    if (c.forceExcluded) return true
    if (c.forceIncluded) return false
    return isPublicElective(c) || shouldExcludeCourse(c.name)
  })
}

const includeCourse = (course) => {
  const updated = { ...course }
  updated.forceIncluded = true
  delete updated.forceExcluded
  return updated
}

const excludeCourse = (course) => {
  const updated = { ...course }
  updated.forceExcluded = true
  delete updated.forceIncluded
  return updated
}

// ==================== GPA算法 ====================
const GPA_METHODS = {
  '燕理算法': {
    name: '燕理算法',
    desc: '燕京理工学院（算法参考自学校教务处公告）',
    scoreToGPA: (score) => {
      if (score >= 95) return 4.67
      if (score >= 90) return 4.33
      if (score >= 87) return 4.00
      if (score >= 84) return 3.67
      if (score >= 80) return 3.33
      if (score >= 77) return 3.00
      if (score >= 74) return 2.67
      if (score >= 70) return 2.33
      if (score >= 67) return 2.00
      if (score >= 64) return 1.67
      if (score >= 61) return 1.33
      if (score >= 60) return 1.00
      return 0
    }
  },
  '标准4.0': {
    name: '标准4.0',
    desc: '国际标准4.0算法',
    scoreToGPA: (score) => {
      if (score >= 90) return 4.0
      if (score >= 80) return 3.0
      if (score >= 70) return 2.0
      if (score >= 60) return 1.0
      return 0
    }
  },
  '北大算法': {
    name: '北大算法',
    desc: '北京大学（对中国学生最有利）',
    scoreToGPA: (score) => {
      if (score >= 90) return 4.0
      if (score >= 85) return 3.7
      if (score >= 82) return 3.3
      if (score >= 78) return 3.0
      if (score >= 75) return 2.7
      if (score >= 72) return 2.3
      if (score >= 68) return 2.0
      if (score >= 64) return 1.5
      if (score >= 60) return 1.0
      return 0
    }
  },
  '浙大算法': {
    name: '浙大算法',
    desc: '浙江大学（85分即满分）',
    scoreToGPA: (score) => {
      if (score >= 85) return 4.0
      if (score >= 60) return 1.5 + (score - 60) * 0.1
      return 0
    }
  },
  'WES算法': {
    name: 'WES算法',
    desc: '美国WES认证',
    scoreToGPA: (score) => {
      if (score >= 85) return 4.0
      if (score >= 75) return 3.0
      if (score >= 60) return 2.0
      if (score >= 50) return 1.0
      return 0
    }
  },
  '加拿大4.3': {
    name: '加拿大4.3',
    desc: '加拿大4.3分制',
    scoreToGPA: (score) => {
      if (score >= 90) return 4.3
      if (score >= 85) return 4.0
      if (score >= 80) return 3.7
      if (score >= 75) return 3.3
      if (score >= 70) return 3.0
      if (score >= 65) return 2.3
      if (score >= 60) return 1.7
      return 0
    }
  },
  '公式法': {
    name: '公式法',
    desc: '4-3(100-X)²/1600',
    scoreToGPA: (score) => {
      if (score >= 60) return Number((4 - 3 * Math.pow(100 - score, 2) / 1600).toFixed(2))
      return 0
    }
  }
}

let currentGPAMethod = '燕理算法'

const setGPAMethod = (method) => {
  if (GPA_METHODS[method]) {
    currentGPAMethod = method
    wx.setStorageSync('gpaMethod', method)
  }
}

const getGPAMethod = () => currentGPAMethod

const getGPAMethods = () => {
  return Object.keys(GPA_METHODS).map(key => ({
    key,
    name: GPA_METHODS[key].name,
    desc: GPA_METHODS[key].desc
  }))
}

const initGPAMethod = () => {
  const saved = wx.getStorageSync('gpaMethod')
  if (saved && GPA_METHODS[saved]) {
    currentGPAMethod = saved
  }
}

// ==================== 绩点计算 ====================
const scoreToGPA = (score) => {
  const value = Number(score)
  const method = GPA_METHODS[currentGPAMethod]
  if (!Number.isFinite(value)) return 0
  return method ? method.scoreToGPA(value) : 0
}

const gradeToGPA = (grade) => {
  const gradeMap = {
    '优': 4.33, '优+': 4.67,
    '良': 3.33,
    '中': 2.33,
    '及格': 1.00,
    '不及格': 0,
    'A+': 4.67, 'A': 4.33, 'A-': 4.00,
    'B+': 3.67, 'B': 3.33, 'B-': 3.00,
    'C+': 2.67, 'C': 2.33, 'C-': 2.00,
    'D+': 1.67, 'D': 1.33, 'D-': 1.00,
    'F': 0, 'P': null, 'NP': null
  }
  return gradeMap[grade] !== undefined ? gradeMap[grade] : null
}

const getCourseGPA = (course) => {
  if (!course || typeof course !== 'object') return 0
  let gpa = 0
  const hasScore = course.score !== undefined && course.score !== null && course.score !== ''
  if (hasScore) gpa = scoreToGPA(course.score)
  else if (course.grade) gpa = gradeToGPA(course.grade)
  else if (course.gpa !== undefined && course.gpa !== null && course.gpa !== '') gpa = Number(course.gpa)
  // P/NP、未知等级、非法数值统一归 0，避免 null/NaN 传播导致崩溃
  if (typeof gpa !== 'number' || !Number.isFinite(gpa)) return 0
  // 统一保留两位小数：浙大算法等会产生 3.1500000000000004 之类的浮点噪声
  return round2(gpa)
}

// 中文等级 -> 字母等级 映射（用于成绩导入时统一解析）
const CHINESE_GRADE_MAP = {
  '优': 'A', '优秀': 'A',
  '良': 'B', '良好': 'B',
  '中': 'C', '中等': 'C',
  '及格': 'D',
  '不及格': 'F'
}

// 将任意成绩字符串归一化为字母等级，无法识别返回 null
const normalizeGrade = (scoreStr) => {
  if (!scoreStr) return null
  const s = String(scoreStr).trim()
  if (CHINESE_GRADE_MAP[s]) return CHINESE_GRADE_MAP[s]
  if (/^[A-F][+-]?$/.test(s)) return s
  return null
}

const calculateGPA = (courses) => {
  const filtered = filterCourses(courses)
  if (filtered.length === 0) {
    return { gpa: '0.00', totalCredits: 0, earnedCredits: 0, totalPoints: '0.00' }
  }

  let totalPoints = 0
  let totalCredits = 0
  let earnedCredits = 0

  for (let i = 0; i < filtered.length; i++) {
    const credits = toCredits(filtered[i].credits)
    const gpa = getCourseGPA(filtered[i])
    totalPoints += gpa * credits
    totalCredits += credits
    if (gpa > 0) earnedCredits += credits
  }

  return {
    gpa: totalCredits > 0 ? (totalPoints / totalCredits).toFixed(2) : '0.00',
    totalCredits: round2(totalCredits),
    earnedCredits: round2(earnedCredits),
    totalPoints: (totalCredits > 0 ? totalPoints : 0).toFixed(2)
  }
}

// ==================== 辅助函数 ====================
const getGradeLevel = (gpa) => {
  const value = Number(gpa)
  if (!Number.isFinite(value)) return '暂无数据'
  if (value >= 4.00) return '优秀'
  if (value >= 3.00) return '良好'
  if (value >= 2.00) return '中等'
  if (value >= 1.00) return '及格'
  return '不及格'
}

const getGradeColor = (gpa) => {
  const value = Number(gpa)
  if (!Number.isFinite(value)) return '#999'
  if (value >= 4.00) return '#52c41a'
  if (value >= 3.00) return '#4A90E2'
  if (value >= 2.00) return '#faad14'
  if (value >= 1.00) return '#ff7a45'
  return '#ff4d4f'
}

const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9)
}

// ==================== 数据操作 ====================
const MAX_UNDO = 50

const saveCourses = (courses, description = '') => {
  const nextCourses = _asCourseList(courses)
  const currentCourses = _getCoursesRaw()

  const undoStack = _getUndoStack()
  undoStack.push({
    courses: currentCourses.slice(), // 快照副本，防止引用别名导致撤销失效
    description: description || '修改课程',
    time: new Date().toISOString()
  })
  if (undoStack.length > MAX_UNDO) undoStack.shift()

  _coursesCache = nextCourses
  _undoStackCache = undoStack
  _redoStackCache = []

  wx.setStorageSync('courses', nextCourses)
  wx.setStorageSync('undoStack', undoStack)
  wx.setStorageSync('redoStack', [])
}

const getCourses = () => _getCoursesRaw().slice()

const undo = () => {
  const undoStack = _getUndoStack()
  if (undoStack.length === 0) return null

  const currentCourses = _getCoursesRaw()
  const lastState = undoStack.pop()

  const redoStack = _getRedoStack()
  redoStack.push({
    courses: currentCourses.slice(),
    description: lastState.description,
    time: new Date().toISOString()
  })
  if (redoStack.length > MAX_UNDO) redoStack.shift()

  const restored = _asCourseList(lastState.courses)
  _undoStackCache = undoStack
  _redoStackCache = redoStack
  _coursesCache = restored

  wx.setStorageSync('undoStack', undoStack)
  wx.setStorageSync('redoStack', redoStack)
  wx.setStorageSync('courses', restored)

  return lastState.description
}

const redo = () => {
  const redoStack = _getRedoStack()
  if (redoStack.length === 0) return null

  const currentCourses = _getCoursesRaw()
  const nextState = redoStack.pop()

  const undoStack = _getUndoStack()
  undoStack.push({
    courses: currentCourses.slice(),
    description: nextState.description,
    time: new Date().toISOString()
  })
  if (undoStack.length > MAX_UNDO) undoStack.shift()

  const restored = _asCourseList(nextState.courses)
  _undoStackCache = undoStack
  _redoStackCache = redoStack
  _coursesCache = restored

  wx.setStorageSync('undoStack', undoStack)
  wx.setStorageSync('redoStack', redoStack)
  wx.setStorageSync('courses', restored)

  return nextState.description
}

const canUndo = () => _getUndoStack().length > 0
const canRedo = () => _getRedoStack().length > 0

const saveHistory = (record) => {
  if (!record || typeof record !== 'object') return
  const history = _asArray(wx.getStorageSync('history'))
  history.unshift(record)
  if (history.length > 100) history.pop()
  wx.setStorageSync('history', history)
}

// ==================== 统计数据 ====================
const calculateStatistics = (courses) => {
  const filtered = filterCourses(courses)
  if (filtered.length === 0) {
    return {
      totalCourses: 0,
      totalCredits: 0,
      averageGPA: '0.00',
      highestGPA: 0,
      lowestGPA: 0,
      gradeDistribution: {
        '优秀(4.0+)': 0,
        '良好(3.0-4.0)': 0,
        '中等(2.0-3.0)': 0,
        '及格(1.0-2.0)': 0,
        '不及格(<1.0)': 0
      },
      semesterTrend: []
    }
  }

  let totalCredits = 0
  let totalPoints = 0
  let highestGPA = 0
  let lowestGPA = Infinity
  const gradeDistribution = {
    '优秀(4.0+)': 0,
    '良好(3.0-4.0)': 0,
    '中等(2.0-3.0)': 0,
    '及格(1.0-2.0)': 0,
    '不及格(<1.0)': 0
  }
  const semesterMap = {}

  for (let i = 0; i < filtered.length; i++) {
    const credits = toCredits(filtered[i].credits)
    const gpa = getCourseGPA(filtered[i])

    totalPoints += gpa * credits
    totalCredits += credits

    if (gpa > highestGPA) highestGPA = gpa
    if (gpa < lowestGPA) lowestGPA = gpa

    if (gpa >= 4.0) gradeDistribution['优秀(4.0+)']++
    else if (gpa >= 3.0) gradeDistribution['良好(3.0-4.0)']++
    else if (gpa >= 2.0) gradeDistribution['中等(2.0-3.0)']++
    else if (gpa >= 1.0) gradeDistribution['及格(1.0-2.0)']++
    else gradeDistribution['不及格(<1.0)']++

    // 缺少学期的课程归入「未知学期」，避免趋势图出现 semester: "undefined"
    const sem = normalizeSemester(filtered[i].semester)
    if (!semesterMap[sem]) {
      semesterMap[sem] = { totalPoints: 0, totalCredits: 0 }
    }
    semesterMap[sem].totalPoints += gpa * credits
    semesterMap[sem].totalCredits += credits
  }

  return {
    totalCourses: filtered.length,
    totalCredits: round2(totalCredits),
    averageGPA: totalCredits > 0 ? (totalPoints / totalCredits).toFixed(2) : '0.00',
    highestGPA: round2(highestGPA),
    lowestGPA: lowestGPA === Infinity ? 0 : round2(lowestGPA),
    gradeDistribution,
    semesterTrend: Object.keys(semesterMap).sort().map(sem => {
      const group = semesterMap[sem]
      return {
        semester: sem,
        gpa: group.totalCredits > 0 ? (group.totalPoints / group.totalCredits).toFixed(2) : '0.00',
        credits: round2(group.totalCredits)
      }
    })
  }
}

module.exports = {
  EXCLUDE_KEYWORDS,
  UNKNOWN_SEMESTER,
  scoreToGPA,
  gradeToGPA,
  normalizeGrade,
  getCourseGPA,
  calculateGPA,
  getGradeLevel,
  getGradeColor,
  generateId,
  saveCourses,
  getCourses,
  undo,
  redo,
  canUndo,
  canRedo,
  saveHistory,
  calculateStatistics,
  isPublicElective,
  shouldExcludeCourse,
  filterCourses,
  getExcludedCourses,
  includeCourse,
  excludeCourse,
  setGPAMethod,
  getGPAMethod,
  getGPAMethods,
  initGPAMethod,
  toCredits,
  normalizeSemester,
  _clearCache
}
