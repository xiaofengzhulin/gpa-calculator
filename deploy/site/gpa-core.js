/*!
 * gpa-core.js — GPA 算法与课程数据层
 *
 * 与 miniprogram/utils/util.js 保持完全一致的算法、排除规则与撤销栈语义，
 * 额外提供 Web 端所需的 localStorage 持久化、成绩表格解析与统计接口。
 * 同时兼容浏览器（window.GPALib）与 Node.js（module.exports），便于单元测试。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.GPALib = factory()
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  // ==================== 常量 ====================
  var EXCLUDE_KEYWORDS = ['体育']
  var SEMESTERS = ['大一上', '大一下', '大二上', '大二下', '大三上', '大三下', '大四上', '大四下']
  var GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F']
  var UNKNOWN_SEMESTER = '未知学期'

  var KEYS = {
    courses: 'gpa_courses',
    undo: 'gpa_undoStack',
    redo: 'gpa_redoStack',
    method: 'gpa_method',
    history: 'gpa_history',
    username: 'gpa_username'
  }

  var MAX_UNDO = 50
  var MAX_HISTORY = 100

  // ==================== 数值兜底 ====================
  // 本地存储可能被旧版本或异常写入污染，统一在此兜底为数组
  function asArray(value) { return Array.isArray(value) ? value : [] }

  // 过滤掉非对象的脏数据条目，避免下游 .name / .credits 取值抛异常
  function asCourseList(value) {
    return asArray(value).filter(function (item) { return item && typeof item === 'object' })
  }

  // 撤销/重做条目必须是对象且携带数组形式的 courses 快照
  function asSnapshotList(value) {
    return asArray(value).filter(function (entry) {
      return entry && typeof entry === 'object' && Array.isArray(entry.courses)
    })
  }

  // 学分：非数字 / 负数 / 0 一律按 0 处理，避免 NaN 污染总分与总学分
  function toCredits(value) {
    var credits = Number(value)
    return Number.isFinite(credits) && credits > 0 ? credits : 0
  }

  // 保留两位小数，消除浮点误差（如 3.1500000000000004）
  function round2(value) {
    return Math.round(Number(value) * 100) / 100
  }

  function normalizeSemester(value) {
    var semester = String(value === undefined || value === null ? '' : value).trim()
    return semester || UNKNOWN_SEMESTER
  }

  // ==================== 存储适配 ====================
  // 浏览器用 localStorage；Node（测试）用内存对象。
  var _memory = {}
  var _hasStorage = (function () {
    try {
      return typeof localStorage !== 'undefined' && !!localStorage.setItem && !!localStorage.getItem
    } catch (e) {
      return false
    }
  })()

  var storage = {
    get: function (key) {
      try {
        return _hasStorage ? localStorage.getItem(key) : (_memory[key] === undefined ? null : _memory[key])
      } catch (e) { return null }
    },
    set: function (key, value) {
      try {
        if (_hasStorage) localStorage.setItem(key, value)
        else _memory[key] = value
      } catch (e) { /* 隐私模式 / 超出配额：静默降级为内存态 */ }
    },
    remove: function (key) {
      try {
        if (_hasStorage) localStorage.removeItem(key)
        else delete _memory[key]
      } catch (e) {}
    }
  }

  function readJSON(key, fallback) {
    var raw = storage.get(key)
    if (!raw) return fallback
    try {
      var parsed = JSON.parse(raw)
      return parsed === null || parsed === undefined ? fallback : parsed
    } catch (e) {
      return fallback
    }
  }

  function writeJSON(key, value) {
    try {
      storage.set(key, JSON.stringify(value))
    } catch (e) {}
  }

  // ==================== 排除规则 ====================
  function shouldExcludeCourse(courseName) {
    // undefined / null / 空串都按「无课程名」处理，不能抛异常
    var name = String(courseName === undefined || courseName === null ? '' : courseName)
    return EXCLUDE_KEYWORDS.some(function (kw) { return name.indexOf(kw) !== -1 })
  }

  function isPublicElective(course) {
    var type = String((course && course.type) || '')
    return type.indexOf('公共选修课') !== -1 ||
      type.indexOf('通识教育选修') !== -1 ||
      type.indexOf('通识实践') !== -1 ||
      type.indexOf('军体') !== -1
  }

  function filterCourses(courses) {
    return asCourseList(courses).filter(function (c) {
      if (c.forceExcluded) return false
      if (c.forceIncluded) return true
      return !isPublicElective(c) && !shouldExcludeCourse(c.name)
    })
  }

  function getExcludedCourses(courses) {
    return asCourseList(courses).filter(function (c) {
      if (c.forceExcluded) return true
      if (c.forceIncluded) return false
      return isPublicElective(c) || shouldExcludeCourse(c.name)
    })
  }

  function includeCourse(course) {
    var updated = Object.assign({}, course)
    updated.forceIncluded = true
    delete updated.forceExcluded
    return updated
  }

  function excludeCourse(course) {
    var updated = Object.assign({}, course)
    updated.forceExcluded = true
    delete updated.forceIncluded
    return updated
  }

  // ==================== GPA 算法 ====================
  var GPA_METHODS = {
    '燕理算法': {
      name: '燕理算法',
      desc: '燕京理工学院（参考学校教务处公告）',
      scoreToGPA: function (score) {
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
      desc: '国际标准 4.0 算法',
      scoreToGPA: function (score) {
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
      scoreToGPA: function (score) {
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
      desc: '浙江大学（85 分即满分）',
      scoreToGPA: function (score) {
        if (score >= 85) return 4.0
        if (score >= 60) return 1.5 + (score - 60) * 0.1
        return 0
      }
    },
    'WES算法': {
      name: 'WES算法',
      desc: '美国 WES 认证',
      scoreToGPA: function (score) {
        if (score >= 85) return 4.0
        if (score >= 75) return 3.0
        if (score >= 60) return 2.0
        if (score >= 50) return 1.0
        return 0
      }
    },
    '加拿大4.3': {
      name: '加拿大4.3',
      desc: '加拿大 4.3 分制',
      scoreToGPA: function (score) {
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
      desc: '4 - 3(100-X)²/1600',
      scoreToGPA: function (score) {
        if (score >= 60) return Number((4 - 3 * Math.pow(100 - score, 2) / 1600).toFixed(2))
        return 0
      }
    }
  }

  var currentGPAMethod = '燕理算法'

  function initGPAMethod() {
    var saved = storage.get(KEYS.method)
    if (saved && GPA_METHODS[saved]) currentGPAMethod = saved
    return currentGPAMethod
  }

  function setGPAMethod(method) {
    if (!GPA_METHODS[method]) return false
    currentGPAMethod = method
    storage.set(KEYS.method, method)
    return true
  }

  function getGPAMethod() { return currentGPAMethod }

  function getGPAMethods() {
    return Object.keys(GPA_METHODS).map(function (key) {
      return { key: key, name: GPA_METHODS[key].name, desc: GPA_METHODS[key].desc }
    })
  }

  // ==================== 成绩换算 ====================
  function scoreToGPA(score) {
    var n = Number(score)
    if (!Number.isFinite(n)) return 0
    var method = GPA_METHODS[currentGPAMethod]
    return method ? method.scoreToGPA(n) : 0
  }

  var GRADE_MAP = {
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

  function gradeToGPA(grade) {
    var v = GRADE_MAP[grade]
    return v === undefined ? null : v
  }

  var CHINESE_GRADE_MAP = {
    '优': 'A', '优秀': 'A',
    '良': 'B', '良好': 'B',
    '中': 'C', '中等': 'C',
    '及格': 'D',
    '不及格': 'F'
  }

  // 任意成绩字符串 -> 字母等级，无法识别返回 null
  function normalizeGrade(scoreStr) {
    if (scoreStr === undefined || scoreStr === null || scoreStr === '') return null
    var s = String(scoreStr).trim()
    if (CHINESE_GRADE_MAP[s]) return CHINESE_GRADE_MAP[s]
    if (/^[A-F][+-]?$/.test(s)) return s
    return null
  }

  function getCourseGPA(course) {
    if (!course || typeof course !== 'object') return 0
    var gpa = 0
    // 只有真正「没有成绩」才回落到等级/绩点：0 分是合法成绩，不能被当成空值
    var hasScore = course.score !== undefined && course.score !== null && course.score !== ''
    if (hasScore) gpa = scoreToGPA(course.score)
    else if (course.grade) gpa = gradeToGPA(course.grade)
    else if (course.gpa !== undefined && course.gpa !== null && course.gpa !== '') gpa = Number(course.gpa)
    // P/NP、未知等级、非法数值统一归 0，避免 null / NaN 传播
    if (typeof gpa !== 'number' || !Number.isFinite(gpa)) return 0
    // 统一保留两位小数：浙大算法等会产生 3.1500000000000004 之类的浮点噪声
    return round2(gpa)
  }

  // ==================== 绩点汇总 ====================
  function calculateGPA(courses) {
    var filtered = filterCourses(courses)
    if (filtered.length === 0) {
      return { gpa: '0.00', totalCredits: 0, earnedCredits: 0, totalPoints: '0.00', courseCount: 0 }
    }

    var totalPoints = 0
    var totalCredits = 0
    var earnedCredits = 0

    for (var i = 0; i < filtered.length; i++) {
      var credits = toCredits(filtered[i].credits)
      var gpa = getCourseGPA(filtered[i])
      totalPoints += gpa * credits
      totalCredits += credits
      if (gpa > 0) earnedCredits += credits
    }

    return {
      gpa: totalCredits > 0 ? (totalPoints / totalCredits).toFixed(2) : '0.00',
      totalCredits: round2(totalCredits),
      earnedCredits: round2(earnedCredits),
      // 没有有效学分时总分归零，避免 0 * Infinity / NaN 之类的脏值
      totalPoints: (totalCredits > 0 ? totalPoints : 0).toFixed(2),
      courseCount: filtered.length
    }
  }

  function getGradeLevel(gpa) {
    var value = Number(gpa)
    if (!Number.isFinite(value)) return '暂无数据'
    if (value >= 4.00) return '优秀'
    if (value >= 3.00) return '良好'
    if (value >= 2.00) return '中等'
    if (value >= 1.00) return '及格'
    return '不及格'
  }

  function getGradeColor(gpa) {
    var value = Number(gpa)
    if (!Number.isFinite(value)) return '#999'
    if (value >= 4.00) return '#52c41a'
    if (value >= 3.00) return '#4A90E2'
    if (value >= 2.00) return '#faad14'
    if (value >= 1.00) return '#ff7a45'
    return '#ff4d4f'
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 11)
  }

  // ==================== 课程数据（含撤销 / 重做） ====================
  function getCourses() {
    // 存储里可能是非数组或被写入 null，统一兜底后再给调用方
    return asCourseList(readJSON(KEYS.courses, [])).slice()
  }

  function getUndoStack() {
    return asSnapshotList(readJSON(KEYS.undo, []))
  }

  function getRedoStack() {
    return asSnapshotList(readJSON(KEYS.redo, []))
  }

  function saveCourses(courses, description) {
    var nextCourses = asCourseList(courses)
    var current = getCourses()
    var undoStack = getUndoStack()
    undoStack.push({
      courses: current.slice(), // 快照副本，防止引用别名导致撤销失效
      description: description || '修改课程',
      time: new Date().toISOString()
    })
    // 任何一次新的保存都清空重做栈，撤销栈最多保留 MAX_UNDO 条
    while (undoStack.length > MAX_UNDO) undoStack.shift()

    writeJSON(KEYS.courses, nextCourses)
    writeJSON(KEYS.undo, undoStack)
    writeJSON(KEYS.redo, [])
  }

  function undo() {
    var undoStack = getUndoStack()
    if (undoStack.length === 0) return null

    var current = getCourses()
    var lastState = undoStack.pop()
    var redoStack = getRedoStack()
    redoStack.push({
      courses: current.slice(),
      description: lastState.description,
      time: new Date().toISOString()
    })
    while (redoStack.length > MAX_UNDO) redoStack.shift()

    var restored = asCourseList(lastState.courses)
    writeJSON(KEYS.undo, undoStack)
    writeJSON(KEYS.redo, redoStack)
    writeJSON(KEYS.courses, restored)
    return lastState.description
  }

  function redo() {
    var redoStack = getRedoStack()
    if (redoStack.length === 0) return null

    var current = getCourses()
    var nextState = redoStack.pop()
    var undoStack = getUndoStack()
    undoStack.push({
      courses: current.slice(),
      description: nextState.description,
      time: new Date().toISOString()
    })
    while (undoStack.length > MAX_UNDO) undoStack.shift()

    var restored = asCourseList(nextState.courses)
    writeJSON(KEYS.undo, undoStack)
    writeJSON(KEYS.redo, redoStack)
    writeJSON(KEYS.courses, restored)
    return nextState.description
  }

  function canUndo() { return getUndoStack().length > 0 }
  function canRedo() { return getRedoStack().length > 0 }

  // 当前状态 + 最近 N 条撤销快照，用于「历史」页
  function getSnapshots(limit) {
    var max = limit || 15
    var list = [{
      courses: getCourses(),
      description: '当前状态',
      time: new Date().toISOString(),
      isCurrent: true
    }]
    getUndoStack().slice(-max).reverse().forEach(function (s) {
      list.push({ courses: s.courses, description: s.description, time: s.time, isCurrent: false })
    })
    return list
  }

  function restoreSnapshot(snapshot) {
    if (!snapshot || snapshot.isCurrent) return false
    var current = getCourses()
    var undoStack = getUndoStack()
    undoStack.push({ courses: current.slice(), description: '恢复前状态', time: new Date().toISOString() })
    while (undoStack.length > MAX_UNDO) undoStack.shift()
    writeJSON(KEYS.undo, undoStack)
    writeJSON(KEYS.courses, asCourseList(snapshot.courses))
    writeJSON(KEYS.redo, [])
    return true
  }

  function saveHistory(record) {
    // 非法记录（null / 字符串等）直接忽略，不能污染历史列表
    if (!record || typeof record !== 'object') return
    var history = asArray(readJSON(KEYS.history, []))
    history.unshift(record)
    while (history.length > MAX_HISTORY) history.pop()
    writeJSON(KEYS.history, history)
  }

  function getHistory() {
    return asArray(readJSON(KEYS.history, []))
  }

  // ==================== 统计 ====================
  function calculateStatistics(courses) {
    var filtered = filterCourses(courses)
    if (filtered.length === 0) {
      // 空结果也返回完整的五分档结构，避免调用方取 gradeDistribution[key] 得到 undefined
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

    var totalCredits = 0
    var totalPoints = 0
    var highestGPA = 0
    var lowestGPA = Infinity
    var gradeDistribution = {
      '优秀(4.0+)': 0,
      '良好(3.0-4.0)': 0,
      '中等(2.0-3.0)': 0,
      '及格(1.0-2.0)': 0,
      '不及格(<1.0)': 0
    }
    var semesterMap = {}

    for (var i = 0; i < filtered.length; i++) {
      var credits = toCredits(filtered[i].credits)
      var gpa = getCourseGPA(filtered[i])

      totalPoints += gpa * credits
      totalCredits += credits

      if (gpa > highestGPA) highestGPA = gpa
      // 0 分也是合法的最低绩点，不能再用 4.67 当初始值
      if (gpa < lowestGPA) lowestGPA = gpa

      if (gpa >= 4.0) gradeDistribution['优秀(4.0+)']++
      else if (gpa >= 3.0) gradeDistribution['良好(3.0-4.0)']++
      else if (gpa >= 2.0) gradeDistribution['中等(2.0-3.0)']++
      else if (gpa >= 1.0) gradeDistribution['及格(1.0-2.0)']++
      else gradeDistribution['不及格(<1.0)']++

      // 缺少学期的课程归入「未知学期」，避免趋势图出现 semester: "undefined"
      var sem = normalizeSemester(filtered[i].semester)
      if (!semesterMap[sem]) semesterMap[sem] = { totalPoints: 0, totalCredits: 0 }
      semesterMap[sem].totalPoints += gpa * credits
      semesterMap[sem].totalCredits += credits
    }

    return {
      totalCourses: filtered.length,
      totalCredits: round2(totalCredits),
      averageGPA: totalCredits > 0 ? (totalPoints / totalCredits).toFixed(2) : '0.00',
      highestGPA: round2(highestGPA),
      lowestGPA: lowestGPA === Infinity ? 0 : round2(lowestGPA),
      gradeDistribution: gradeDistribution,
      semesterTrend: Object.keys(semesterMap).sort().map(function (sem) {
        var item = semesterMap[sem]
        return {
          semester: sem,
          gpa: item.totalCredits > 0 ? (item.totalPoints / item.totalCredits).toFixed(2) : '0.00',
          credits: round2(item.totalCredits)
        }
      })
    }
  }

  // ==================== 成绩表格解析 ====================
  function trim(v) { return String(v === undefined || v === null ? '' : v).replace(/\u00a0/g, ' ').trim() }

  // 依据表头定位列，兼容「开课学期 / 学期」「课程性质 / 课程属性」等写法
  function buildColumnMap(headers) {
    var colMap = {}
    for (var i = 0; i < headers.length; i++) {
      var h = trim(headers[i]).replace(/\s+/g, '')
      if (!h) continue
      if (colMap.name === undefined && h.indexOf('课程名称') !== -1) colMap.name = i
      else if (colMap.score === undefined && (h === '成绩' || h.indexOf('成绩') !== -1) && h.indexOf('绩点') === -1) colMap.score = i
      else if (colMap.credits === undefined && (h === '学分' || h.indexOf('学分') !== -1)) colMap.credits = i
      else if (colMap.gpa === undefined && h.indexOf('绩点') !== -1) colMap.gpa = i
      else if (colMap.semester === undefined && (h.indexOf('开课学期') !== -1 || h.indexOf('学期') !== -1)) colMap.semester = i
      else if (colMap.type === undefined && (h.indexOf('课程性质') !== -1 || h.indexOf('课程属性') !== -1)) colMap.type = i
    }
    return colMap
  }

  function mapRows(headers, rows) {
    var colMap = buildColumnMap(headers || [])
    if (colMap.name === undefined || colMap.score === undefined || colMap.credits === undefined) {
      return { ok: false, error: '表格格式不正确，缺少「课程名称 / 成绩 / 学分」列', courses: [] }
    }

    var courses = []
    for (var i = 0; i < (rows || []).length; i++) {
      var cells = rows[i]
      if (!cells || cells.length < 3) continue

      var name = trim(cells[colMap.name])
      var scoreStr = trim(cells[colMap.score])
      var creditsStr = trim(cells[colMap.credits])
      if (!name || !scoreStr || !creditsStr) continue

      var credits = parseFloat(creditsStr)
      if (isNaN(credits) || credits <= 0) continue

      var semester = colMap.semester !== undefined ? trim(cells[colMap.semester]) : ''
      var type = colMap.type !== undefined ? trim(cells[colMap.type]) : ''
      var gpaStr = colMap.gpa !== undefined ? trim(cells[colMap.gpa]) : ''

      var course = { name: name, credits: credits, semester: semester || UNKNOWN_SEMESTER }

      var scoreNum = parseFloat(scoreStr)
      if (!isNaN(scoreNum) && scoreNum >= 0 && scoreNum <= 100) {
        course.score = scoreNum
      } else {
        var grade = normalizeGrade(scoreStr)
        if (!grade) continue
        course.grade = grade
      }

      var parsedGpa = parseFloat(gpaStr)
      if (gpaStr && !isNaN(parsedGpa)) course.gpa = parsedGpa
      if (type) course.type = type
      courses.push(course)
    }

    if (courses.length === 0) {
      return { ok: false, error: '未解析到有效成绩，请确认复制的是完整成绩表格（含课程名称、成绩、学分）', courses: [] }
    }
    return { ok: true, error: '', courses: courses }
  }

  // 纯文本粘贴：优先按制表符分列，退回按 2 个以上空格分列
  function splitLine(line) {
    return line.indexOf('\t') !== -1 ? line.split('\t') : line.split(/\s{2,}/)
  }

  function parseScoreText(text) {
    var lines = String(text || '').split(/\r?\n/).filter(function (l) { return l.trim() })
    if (lines.length < 2) return { ok: false, error: '内容太少，请粘贴包含表头和数据的完整成绩表格', courses: [] }

    var headerLine = -1
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('课程名称') !== -1 && lines[i].indexOf('学分') !== -1) {
        headerLine = i
        break
      }
    }
    if (headerLine === -1) return { ok: false, error: '没找到表头，请确认内容里包含「课程名称」和「学分」这两列', courses: [] }

    var headers = splitLine(lines[headerLine]).map(trim)
    var rows = []
    for (var j = headerLine + 1; j < lines.length; j++) rows.push(splitLine(lines[j]).map(trim))

    return mapRows(headers, rows)
  }

  // ==================== 导出 ====================
  return {
    // 常量
    EXCLUDE_KEYWORDS: EXCLUDE_KEYWORDS,
    SEMESTERS: SEMESTERS,
    GRADES: GRADES,
    UNKNOWN_SEMESTER: UNKNOWN_SEMESTER,
    KEYS: KEYS,
    // 算法
    GPA_METHODS: GPA_METHODS,
    scoreToGPA: scoreToGPA,
    gradeToGPA: gradeToGPA,
    getCourseGPA: getCourseGPA,
    normalizeGrade: normalizeGrade,
    calculateGPA: calculateGPA,
    calculateStatistics: calculateStatistics,
    getGradeLevel: getGradeLevel,
    getGradeColor: getGradeColor,
    getGPAMethod: getGPAMethod,
    setGPAMethod: setGPAMethod,
    getGPAMethods: getGPAMethods,
    initGPAMethod: initGPAMethod,
    // 数值兜底（与小程序 util.js 同名同义）
    toCredits: toCredits,
    round2: round2,
    normalizeSemester: normalizeSemester,
    // 排除规则
    isPublicElective: isPublicElective,
    shouldExcludeCourse: shouldExcludeCourse,
    filterCourses: filterCourses,
    getExcludedCourses: getExcludedCourses,
    includeCourse: includeCourse,
    excludeCourse: excludeCourse,
    // 数据
    generateId: generateId,
    getCourses: getCourses,
    saveCourses: saveCourses,
    undo: undo,
    redo: redo,
    canUndo: canUndo,
    canRedo: canRedo,
    getSnapshots: getSnapshots,
    restoreSnapshot: restoreSnapshot,
    saveHistory: saveHistory,
    getHistory: getHistory,
    // 解析
    parseScoreText: parseScoreText,
    mapRows: mapRows,
    // 其它
    storage: storage
  }
})
