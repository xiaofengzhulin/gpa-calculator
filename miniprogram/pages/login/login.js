// pages/login/login.js
const util = require('../../utils/util.js')
const api = require('../../utils/api.js')

Page({
  data: {
    importMode: 'auto',    // 'auto' | 'manual'
    serverOnline: false,

    // 自动导入
    username: '',
    password: '',
    showPassword: false,
    savePassword: true,
    importing: false,
    importStep: 0,

    // 手动粘贴
    scoreText: '',
    clearExisting: true,
    parseResult: { show: false, count: 0, items: [] },

    // 通用
    showErrorModal: false,
    errorTitle: '',
    errorMsg: ''
  },

  onLoad() {
    // 恢复保存的账号密码
    const savedUsername = wx.getStorageSync('savedUsername') || ''
    const savedPassword = wx.getStorageSync('savedPassword') || ''
    this.setData({ username: savedUsername, password: savedPassword })
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
    this.setData({ savePassword: e.detail.value.length > 0 })
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

  async autoImport() {
    const { username, password, savePassword } = this.data

    if (!username.trim()) {
      this.showError('导入失败', '请输入学号')
      return
    }
    if (!password.trim()) {
      this.showError('导入失败', '请输入密码')
      return
    }

    // 保存/清除密码
    if (savePassword) {
      wx.setStorageSync('savedUsername', username)
      wx.setStorageSync('savedPassword', password)
    } else {
      wx.removeStorageSync('savedUsername')
      wx.removeStorageSync('savedPassword')
    }

    this.setData({ importing: true, importStep: 1 })

    try {
      // Step 1: 检查服务器
      const online = await api.checkHealth()
      if (!online) throw new Error('服务器未连接，请确保 server/server.js 已启动')
      this.setData({ importStep: 2 })

      // Step 2-3: 登录并获取成绩
      const result = await api.fetchGrades(username.trim(), password.trim())
      this.setData({ importStep: 3 })

      if (!result.courses || result.courses.length === 0) {
        throw new Error('未查询到成绩数据')
      }

      // Step 4: 导入成绩
      const imported = this._importCourses(result.courses)
      this.setData({ importStep: 4 })

      this.setData({
        parseResult: {
          show: true,
          count: imported,
          items: result.courses.slice(0, 10).map(c => ({
            name: c.name,
            score: c.score,
            credits: c.credits
          }))
        }
      })

      wx.showToast({ title: `成功导入${imported}门课程`, icon: 'success' })
      wx.setStorageSync('showRewardAfterImport', true)
      setTimeout(() => { wx.switchTab({ url: '/pages/index/index' }) }, 2000)

    } catch (err) {
      this.showError('导入失败', err.message || '导入过程出错')
    } finally {
      this.setData({ importing: false, importStep: 0 })
    }
  },

  _importCourses(courses) {
    const existingCourses = this.data.clearExisting ? [] : util.getCourses()
    const existingNames = new Set(existingCourses.map(c => c.name))
    let importCount = 0

    for (const item of courses) {
      if (existingNames.has(item.name)) continue
      existingNames.add(item.name)

      const course = {
        id: util.generateId(),
        name: item.name,
        credits: Number(item.credits) || 0,
        semester: item.semester || '未知学期',
        type: item.courseType || ''
      }

      // 解析成绩
      const scoreNum = parseFloat(item.score)
      if (!isNaN(scoreNum) && scoreNum >= 0 && scoreNum <= 100) {
        course.score = scoreNum
        course.gpa = item.gpa ? parseFloat(item.gpa) : util.scoreToGPA(scoreNum)
      } else {
        const grade = util.normalizeGrade(item.score)
        if (!grade) continue
        course.grade = grade
        course.gpa = util.gradeToGPA(grade)
      }

      existingCourses.push(course)
      importCount++
    }

    if (importCount > 0) {
      util.saveCourses(existingCourses, `自动导入${importCount}门课程`)
      util.saveHistory({
        type: 'import',
        course: { name: `自动导入${importCount}门课程` },
        time: new Date().toISOString()
      })
    }

    return importCount
  },

  // ==================== 手动粘贴 ====================
  onScoreInput(e) {
    this.setData({
      scoreText: e.detail.value,
      parseResult: { show: false, count: 0, items: [] }
    })
  },

  onClearExistingChange(e) {
    this.setData({ clearExisting: e.detail.value.length > 0 })
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
    if (!scoreText.trim()) {
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

      var importCount = this._importScores(scores, this.data.clearExisting)

      this.setData({
        parseResult: { show: true, count: importCount, items: scores.slice(0, 10) }
      })

      wx.showToast({ title: '成功导入' + importCount + '门课程', icon: 'success' })
      wx.setStorageSync('showRewardAfterImport', true)
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
      if (h.indexOf('课程名称') !== -1) colMap.name = i
      else if (h === '成绩') colMap.score = i
      else if (h === '学分') colMap.credits = i
      else if (h.indexOf('绩点') !== -1) colMap.gpa = i
      else if (h.indexOf('开课学期') !== -1 || h.indexOf('学期') !== -1) colMap.semester = i
      else if (h.indexOf('课程性质') !== -1) colMap.type = i
    })

    if (colMap.name === undefined || colMap.score === undefined || colMap.credits === undefined) {
      throw new Error('表格格式不正确，缺少必要列')
    }

    var scores = []
    for (var i = headerLine + 1; i < lines.length; i++) {
      var cells = lines[i].split('\t').map(function(c) { return c.trim() })
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

      var course = { name: courseName, credits: credits, semester: semester || '未知学期' }

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
    var existingNames = new Set(existingCourses.map(function(c) { return c.name }))
    var importCount = 0

    scores.forEach(function(score) {
      if (!existingNames.has(score.name)) {
        existingNames.add(score.name)
        var course = {
          id: util.generateId(),
          name: score.name,
          credits: score.credits,
          semester: score.semester
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
        importCount++
      }
    })

    if (importCount > 0) {
      util.saveCourses(existingCourses, clearExisting ? '重新导入' + importCount + '门课程' : '导入' + importCount + '门课程')
      util.saveHistory({
        type: 'import',
        course: { name: (clearExisting ? '重新导入' : '手动导入') + importCount + '门课程' },
        time: new Date().toISOString()
      })
    }
    return importCount
  },

  // ==================== 通用 ====================
  showError(title, msg) {
    this.setData({ showErrorModal: true, errorTitle: title, errorMsg: msg })
  },

  hideErrorModal() {
    this.setData({ showErrorModal: false })
  }
})
