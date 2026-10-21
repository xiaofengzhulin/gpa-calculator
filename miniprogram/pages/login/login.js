// pages/login/login.js
const util = require('../../utils/util.js')
const api = require('../../utils/api.js')
const secureStore = require('../../utils/secure-store.js')

// 导入前的数据合并策略
const IMPORT_MODE_REPLACE = 'replace'  // 覆盖：清空本地课程后导入
const IMPORT_MODE_MERGE = 'merge'      // 合并：保留本地课程，只追加新课程

Page({
  data: {
    importMode: 'auto',    // 'auto' | 'manual'
    serverOnline: false,

    // 自动导入
    username: '',
    password: '',
    showPassword: false,
    // 默认不勾选「记住密码」：密码是明文用户凭据，只有用户主动选择才落盘
    savePassword: false,
    importing: false,
    importStep: 0,

    // 手动粘贴
    scoreText: '',
    clearExisting: true,
    parseResult: { show: false, count: 0, items: [], skipped: 0 },

    // 通用
    showErrorModal: false,
    errorTitle: '',
    errorMsg: ''
  },

  onLoad() {
    // 兼容 1.2.1 及更早版本：把历史明文密码升级成密文后再读
    secureStore.migrateLegacy('savedPassword')

    const savedUsername = wx.getStorageSync('savedUsername') || ''
    const savedPassword = secureStore.getSecret('savedPassword')
    this.setData({
      username: savedUsername,
      password: savedPassword,
      // 本地确实存过密码时，勾选状态与实际一致
      savePassword: !!savedPassword
    })
  },

  onShow() {
    this.checkServer()
  },

  checkServer() {
    api.checkHealth().then(online => {
      this.setData({ serverOnline: online })
    })
  },

  // ==================== 模式切换 ====================
  switchMode(e) {
    this.setData({ importMode: e.currentTarget.dataset.mode })
  },

  // ==================== 自动导入 ====================
  onUsernameInput(e) {
    this.setData({ username: e.detail.value })
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value })
  },

  onSavePasswordChange(e) {
    this.setData({ savePassword: (e.detail.value || []).length > 0 })
  },

  togglePassword() {
    this.setData({ showPassword: !this.data.showPassword })
  },

  copyResetLink() {
    wx.setClipboardData({
      data: 'http://jw.yit.edu.cn/yjlgxy/',
      success() {
        wx.showToast({ title: '链接已复制，请在浏览器中打开', icon: 'none', duration: 2500 })
      }
    })
  },

  /**
   * 本地已有课程时让用户选择「覆盖导入」「合并新增」或取消，
   * 避免自动导入把用户手动添加的课程静默清空。
   * @returns {Promise<'replace'|'merge'|null>} null 表示用户取消
   */
  chooseImportMode() {
    const existingCount = util.getCourses().length
    if (existingCount === 0) return Promise.resolve(IMPORT_MODE_REPLACE)

    return new Promise((resolve) => {
      // 用 ActionSheet 而不是 showModal：两个按钮都「继续导入」时用户没有退路
      wx.showActionSheet({
        alertText: `本地已有 ${existingCount} 门课程：覆盖=清空后重新导入，合并=保留现有只加新课程`,
        itemList: ['覆盖导入', '合并新增', '取消'],
        success(res) {
          if (res.tapIndex === 0) resolve(IMPORT_MODE_REPLACE)
          else if (res.tapIndex === 1) resolve(IMPORT_MODE_MERGE)
          else resolve(null)
        },
        fail() {
          // 点击遮罩/返回键关闭同样视为取消
          resolve(null)
        }
      })
    })
  },

  async autoImport() {
    const { username, password, savePassword } = this.data

    if (!String(username || '').trim()) {
      this.showError('导入失败', '请输入学号')
      return
    }
    if (!String(password || '').trim()) {
      this.showError('导入失败', '请输入密码')
      return
    }
    if (this.data.importing) return

    // 保存/清除账号密码（密码经 secure-store 加密后落盘，存储里没有明文）
    if (savePassword) {
      wx.setStorageSync('savedUsername', username)
      secureStore.setSecret('savedPassword', password)
    } else {
      wx.removeStorageSync('savedUsername')
      secureStore.removeSecret('savedPassword')
    }

    const mode = await this.chooseImportMode()
    if (!mode) return

    this.setData({ importing: true, importStep: 1 })

    try {
      // Step 1: 检查服务器
      const online = await api.checkHealth()
      if (!online) throw new Error('服务器暂时不可用，请稍后重试或改用「手动粘贴」导入')
      this.setData({ importStep: 2 })

      // Step 2-3: 登录并获取成绩
      const result = await api.fetchGrades(String(username).trim(), String(password).trim())
      this.setData({ importStep: 3 })

      if (!result.courses || result.courses.length === 0) {
        throw new Error('未查询到成绩数据，请确认账号下已出成绩')
      }

      // Step 4: 导入成绩
      const imported = this._importCourses(result.courses, mode)
      this.setData({ importStep: 4 })

      if (imported.count === 0) {
        // 0 门不代表「本地已全部存在」，也可能是成绩无法识别，这里分开说明
        this.showError('没有可导入的课程', `查询到 ${result.courses.length} 门成绩：${imported.duplicated} 门本地已存在，${imported.invalid} 门缺少课程名/学分或成绩无法识别，未做任何改动。`)
        return
      }

      this.setData({
        parseResult: {
          show: true,
          count: imported.count,
          skipped: imported.skipped,
          // 只展示真正写入的课程，避免把重复/无效行也列出来
          items: imported.imported.slice(0, 10).map(c => ({
            uid: c.id,
            name: c.name,
            scoreText: c.score !== undefined ? this._formatScoreText(c.score) : String(c.grade || '--'),
            credits: c.credits,
            semester: c.semester
          }))
        }
      })

      // toast 标题超过 7 个汉字会被截断，这里用短文案
      wx.showToast({ title: `已导入${imported.count}门`, icon: 'success' })
      setTimeout(() => { wx.switchTab({ url: '/pages/index/index' }) }, 2000)

    } catch (err) {
      this.showError('导入失败', this._buildErrorMessage(err))
    } finally {
      this.setData({ importing: false, importStep: 0 })
    }
  },

  _formatScoreText(score) {
    if (score === undefined || score === null || score === '') return '--'
    return String(score)
  },

  _buildErrorMessage(err) {
    let msg = (err && err.message) || '导入过程出错'
    if (err && err.scope === 'login-lock' && err.retryAfter !== undefined) {
      const wait = Number(err.retryAfter) || 60
      const waitText = wait >= 60 ? `${Math.ceil(wait / 60)} 分钟` : `${wait} 秒`
      msg += `\n\n连续失败次数过多，已临时禁止登入：请 ${waitText}后重试。`
    } else if (err && err.remainingAttempts !== undefined) {
      msg += `\n\n连续失败 5 次将临时禁止登入，还可尝试 ${err.remainingAttempts} 次。`
    }
    return msg
  },

  /**
   * 自动导入（教务系统接口返回的原始课程）
   * @param {Array} courses 服务端返回的课程
   * @param {'replace'|'merge'} mode 数据处理方式
   */
  _importCourses(courses, mode) {
    const existingCourses = mode === IMPORT_MODE_REPLACE ? [] : util.getCourses()
    const existingKeys = new Set(existingCourses.map(c => this._courseKey(c)))
    let count = 0
    let duplicated = 0
    let invalid = 0
    const imported = []

    for (const item of courses) {
      if (!item || typeof item !== 'object') { invalid++; continue }

      const name = String(item.name || '').trim()
      const credits = util.toCredits(item.credits)
      // 课程名或学分缺失的记录无法参与绩点计算，直接跳过并计数
      if (!name || credits <= 0) { invalid++; continue }

      const semester = util.normalizeSemester(item.semester)
      const key = this._courseKey({ name, semester })
      // 同名课程可能出现在不同学期，去重键必须带上学期
      if (existingKeys.has(key)) { duplicated++; continue }
      existingKeys.add(key)

      const course = {
        id: util.generateId(),
        name,
        credits,
        semester,
        type: item.courseType || ''
      }

      // 解析成绩：百分制优先，其次中文/字母等级
      const scoreNum = parseFloat(item.score)
      if (!isNaN(scoreNum) && scoreNum >= 0 && scoreNum <= 100) {
        course.score = scoreNum
        course.gpa = item.gpa !== undefined && item.gpa !== '' && !isNaN(parseFloat(item.gpa))
          ? parseFloat(item.gpa)
          : util.scoreToGPA(scoreNum)
      } else {
        const grade = util.normalizeGrade(item.score)
        // 合格/通过/P/NP 等无法换算绩点的记录不参与计算，但要计入「跳过」反馈
        if (!grade) { invalid++; continue }
        course.grade = grade
        course.gpa = util.gradeToGPA(grade)
      }

      existingCourses.push(course)
      imported.push(course)
      count++
    }

    if (count > 0) {
      util.saveCourses(existingCourses, mode === IMPORT_MODE_REPLACE
        ? `重新导入${count}门课程`
        : `新增导入${count}门课程`)
      util.saveHistory({
        type: 'import',
        course: { name: mode === IMPORT_MODE_REPLACE ? `重新导入${count}门课程` : `导入${count}门课程` },
        time: new Date().toISOString()
      })
    }

    return { count, skipped: duplicated + invalid, duplicated, invalid, imported }
  },

  _courseKey(course) {
    return `${String(course.name || '').trim()}|${util.normalizeSemester(course.semester)}`
  },

  // ==================== 手动粘贴 ====================
  onScoreInput(e) {
    this.setData({
      scoreText: e.detail.value,
      parseResult: { show: false, count: 0, items: [], skipped: 0 }
    })
  },

  onClearExistingChange(e) {
    this.setData({ clearExisting: (e.detail.value || []).length > 0 })
  },

  copyLink() {
    wx.setClipboardData({
      data: 'http://jw.yit.edu.cn/yjlgxy_jsxsd/',
      success() {
        wx.showToast({ title: '链接已复制，请在浏览器中打开', icon: 'none', duration: 2000 })
      }
    })
  },

  parseAndImport() {
    var scoreText = this.data.scoreText
    if (!scoreText || !scoreText.trim()) {
      this.showError('导入失败', '输入框为空，请先复制成绩单内容后粘贴到输入框中。')
      return
    }

    if (scoreText.indexOf('请评教') !== -1) {
      this.showError('导入失败', '检测到您尚未完成评教，请先前往教务平台首页，打开「学生评教」完成评教后，再重新查询并复制成绩。')
      return
    }

    try {
      var scores = this._parseScoreText(scoreText)

      if (scores.length === 0) {
        this.showError('导入失败', '未解析到有效成绩，请确认复制的是成绩单表格的全部内容，并包含「课程名称」「成绩」「学分」等列。')
        return
      }

      var result = this._importScores(scores, this.data.clearExisting)

      if (result.count === 0) {
        this.showError('没有可导入的课程', '解析到 ' + scores.length + ' 门成绩：' + result.duplicated + ' 门与本地重复、' + result.invalid + ' 门无效。如需覆盖，请勾选「清除已导入成绩」后重试。')
        return
      }

      this.setData({
        parseResult: {
          show: true,
          count: result.count,
          skipped: result.skipped,
          // 只展示真正写入的课程
          items: result.imported.slice(0, 10).map(function(item) {
            return {
              uid: item.id,
              name: item.name,
              scoreText: item.score !== undefined ? String(item.score) : (item.grade || '--'),
              credits: item.credits,
              semester: item.semester
            }
          })
        }
      })

      wx.showToast({ title: '已导入' + result.count + '门', icon: 'success' })
      setTimeout(function() { wx.switchTab({ url: '/pages/index/index' }) }, 1500)

    } catch (err) {
      this.showError('导入失败', '成绩数据解析出错：' + err.message + '，请确认粘贴的内容格式正确。')
    }
  },

  _parseScoreText(text) {
    var lines = text.split('\n').filter(function(l) { return l.trim() })
    if (lines.length < 2) return []

    var headerLine = -1
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('课程名称') !== -1 && lines[i].indexOf('学分') !== -1) {
        headerLine = i
        break
      }
    }
    if (headerLine === -1) return []

    var headers = lines[headerLine].split('\t').map(function(h) { return h.trim() })
    var colMap = {}
    headers.forEach(function(h, i) {
      if (h.indexOf('课程名称') !== -1) { colMap.name = i; return }
      if (h.indexOf('课程性质') !== -1) { colMap.type = i; return }
      if (h.indexOf('学期') !== -1) { colMap.semester = i; return }
      if (h.indexOf('绩点') !== -1) { colMap.gpa = i; return }
      if (h.indexOf('学分') !== -1) { colMap.credits = i; return }
      // 「成绩标志」「成绩备注」等列也含「成绩」二字，必须排除，否则会把成绩列错认成空列
      if (h.indexOf('成绩') !== -1 && h.indexOf('标志') === -1) {
        // 优先精确的「成绩」列；只有没有精确列时才用「总成绩」这类模糊匹配
        if (h === '成绩' || colMap.score === undefined) colMap.score = i
      }
    })

    if (colMap.name === undefined || colMap.score === undefined || colMap.credits === undefined) {
      throw new Error('表格格式不正确，缺少必要列')
    }

    var scores = []
    for (var j = headerLine + 1; j < lines.length; j++) {
      var cells = lines[j].split('\t').map(function(c) { return c.trim() })
      if (cells.length < 3) continue

      var courseName = cells[colMap.name]
      var scoreStr = cells[colMap.score]
      var courseType = colMap.type !== undefined ? cells[colMap.type] : ''
      var creditsStr = cells[colMap.credits]
      var gpaStr = colMap.gpa !== undefined ? cells[colMap.gpa] : ''
      var semester = colMap.semester !== undefined ? cells[colMap.semester] : ''

      if (!courseName || !scoreStr || !creditsStr) continue

      var credits = parseFloat(creditsStr)
      if (isNaN(credits) || credits <= 0) continue

      var course = { name: courseName, credits: credits, semester: util.normalizeSemester(semester) }

      var scoreNum = parseFloat(scoreStr)
      if (!isNaN(scoreNum) && scoreNum >= 0 && scoreNum <= 100) {
        course.score = scoreNum
      } else {
        var grade = util.normalizeGrade(scoreStr)
        if (!grade) continue
        course.grade = grade
      }

      if (gpaStr && !isNaN(parseFloat(gpaStr))) course.gpa = parseFloat(gpaStr)
      if (courseType) course.type = courseType
      scores.push(course)
    }
    return scores
  },

  _importScores(scores, clearExisting) {
    var existingCourses = clearExisting ? [] : util.getCourses()
    var existingKeys = new Set(existingCourses.map(c => this._courseKey(c)))
    var count = 0
    var duplicated = 0
    var invalid = 0
    var imported = []

    scores.forEach((score) => {
      var name = String(score.name || '').trim()
      var credits = util.toCredits(score.credits)
      if (!name || credits <= 0) { invalid++; return }

      var semester = util.normalizeSemester(score.semester)
      var key = this._courseKey({ name: name, semester: semester })
      // 去重键带上学期：同名课程在不同学期（如 体育/体育）应分别保留
      if (existingKeys.has(key)) { duplicated++; return }
      existingKeys.add(key)

      var course = {
        id: util.generateId(),
        name: name,
        credits: credits,
        semester: semester
      }
      if (score.score !== undefined) {
        course.score = score.score
        course.gpa = score.gpa !== undefined ? score.gpa : util.scoreToGPA(score.score)
      } else if (score.grade) {
        course.grade = score.grade
        course.gpa = score.gpa !== undefined ? score.gpa : util.gradeToGPA(score.grade)
      }
      if (score.type) course.type = score.type
      existingCourses.push(course)
      imported.push(course)
      count++
    })

    if (count > 0) {
      util.saveCourses(existingCourses, clearExisting
        ? '重新导入' + count + '门课程'
        : '导入' + count + '门课程')
      util.saveHistory({
        type: 'import',
        course: { name: (clearExisting ? '重新导入' : '手动导入') + count + '门课程' },
        time: new Date().toISOString()
      })
    }
    return { count, skipped: duplicated + invalid, duplicated, invalid, imported }
  },

  // ==================== 通用 ====================
  showError(title, msg) {
    this.setData({ showErrorModal: true, errorTitle: title, errorMsg: msg })
  },

  hideErrorModal() {
    this.setData({ showErrorModal: false })
  }
})
