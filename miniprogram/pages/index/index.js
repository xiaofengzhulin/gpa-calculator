// pages/index/index.js
const util = require('../../utils/util.js')

// 学期下拉的固定选项（手动添加课程时常用）
const BASE_SEMESTERS = ['大一上', '大一下', '大二上', '大二下', '大三上', '大三下', '大四上', '大四下']

// 课程成绩展示文案：0 分是合法成绩，不能用 `score || grade` 判断（0 会被当成 false）
const formatScore = (course) => {
  const hasScore = course.score !== undefined && course.score !== null && course.score !== ''
  if (hasScore) return String(course.score)
  if (course.grade) return String(course.grade)
  return '--'
}

Page({
  data: {
    courses: [],
    excludedCourses: [],
    showExcluded: false,
    showCourseList: true,
    filterSemester: '全部',
    availableSemesters: ['全部'],
    showGPAMethods: false,
    gpaMethods: [],
    currentGPAMethod: '',
    gpa: '0.00',
    totalCredits: 0,
    earnedCredits: 0,
    gradeLevel: '暂无数据',
    gradeColor: '#999',
    showModal: false,
    isEdit: false,
    editIndex: -1,
    currentCourse: {
      name: '',
      credits: '',
      score: '',
      grade: '',
      semester: ''
    },
    scoreTypes: ['百分制', '等级制'],
    scoreTypeIndex: 0,
    grades: ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'],
    gradeIndex: 0,
    semesters: BASE_SEMESTERS,
    semesterIndex: 0
  },

  onLoad() {
    this.setData({
      gpaMethods: util.getGPAMethods(),
      currentGPAMethod: util.getGPAMethod()
    })
    this.loadCourses()
  },

  onShow() {
    this.loadCourses()
  },

  /**
   * 学期下拉选项 = 固定选项 + 教务系统导入的真实学期（如 2024-2025-1）
   * 否则编辑导入的课程时，学期会被强行改成「大一上」。
   */
  buildSemesterOptions(courses) {
    const extras = []
    for (let i = 0; i < courses.length; i++) {
      const semester = courses[i] && courses[i].semester
      if (semester && !BASE_SEMESTERS.includes(semester) && !extras.includes(semester)) {
        extras.push(semester)
      }
    }
    extras.sort()
    return BASE_SEMESTERS.concat(extras)
  },

  loadCourses() {
    const allCourses = util.getCourses()
    const excluded = util.getExcludedCourses(allCourses)
    const excludedIds = new Set(excluded.map(c => c.id))
    const included = allCourses.filter(c => !excludedIds.has(c.id))

    const semesterSet = new Set()
    for (let i = 0; i < included.length; i++) {
      const semester = included[i].semester
      if (semester && semester !== util.UNKNOWN_SEMESTER) semesterSet.add(semester)
    }
    const availableSemesters = ['全部', ...Array.from(semesterSet).sort()]

    const filterSemester = availableSemesters.includes(this.data.filterSemester)
      ? this.data.filterSemester
      : '全部'
    const filteredCourses = filterSemester === '全部'
      ? included
      : included.filter(c => c.semester === filterSemester)
    const result = util.calculateGPA(filteredCourses)
    const hasData = filteredCourses.length > 0

    const formatCourse = (course) => {
      const gpa = util.getCourseGPA(course)
      return {
        ...course,
        gpa: gpa.toFixed(2),
        gpaColor: util.getGradeColor(gpa),
        scoreText: formatScore(course)
      }
    }

    this.setData({
      courses: filteredCourses.map(formatCourse),
      excludedCourses: excluded.map(formatCourse),
      availableSemesters,
      filterSemester,
      semesters: this.buildSemesterOptions(allCourses),
      currentGPAMethod: util.getGPAMethod(),
      gpa: result.gpa,
      totalCredits: result.totalCredits,
      earnedCredits: result.earnedCredits,
      // 没有课程时不能显示「不及格」，否则 0.00 会被误读成挂科
      gradeLevel: hasData ? util.getGradeLevel(Number(result.gpa)) : '暂无数据',
      gradeColor: hasData ? util.getGradeColor(Number(result.gpa)) : '#999'
    })
  },

  onSemesterFilterChange(e) {
    this.setData({ filterSemester: e.currentTarget.dataset.semester })
    this.loadCourses()
  },

  showGPAMethodModal() {
    this.setData({ showGPAMethods: true })
  },

  hideGPAMethodModal() {
    this.setData({ showGPAMethods: false })
  },

  selectGPAMethod(e) {
    util.setGPAMethod(e.currentTarget.dataset.method)
    this.setData({ showGPAMethods: false })
    this.loadCourses()
  },

  addCourse() {
    this.setData({
      showModal: true,
      isEdit: false,
      editIndex: -1,
      currentCourse: { name: '', credits: '', score: '', grade: '', semester: BASE_SEMESTERS[0] },
      scoreTypeIndex: 0,
      gradeIndex: 0,
      semesterIndex: 0
    })
  },

  editCourse(e) {
    const courseId = e.currentTarget.dataset.id
    const course = this.data.courses.find(c => c.id === courseId)
    if (!course) return

    const hasScore = course.score !== undefined && course.score !== null && course.score !== ''
    const isGradeType = !hasScore && !!course.grade
    const semesterOptions = this.data.semesters
    const semesterIndex = Math.max(0, semesterOptions.indexOf(course.semester))
    const gradeIndex = this.data.grades.indexOf(course.grade)

    this.setData({
      showModal: true,
      isEdit: true,
      editIndex: course.id,
      currentCourse: {
        name: course.name,
        credits: course.credits,
        score: hasScore ? course.score : '',
        grade: course.grade || '',
        semester: course.semester
      },
      scoreTypeIndex: isGradeType ? 1 : 0,
      gradeIndex: gradeIndex >= 0 ? gradeIndex : 0,
      semesterIndex
    })
  },

  deleteCourse(e) {
    const courseId = e.currentTarget.dataset.id
    const course = this.data.courses.find(c => c.id === courseId)
    if (!course) return
    const courseName = course.name
    wx.showModal({
      title: '确认删除',
      content: `确定要删除课程"${courseName}"吗？`,
      success: (res) => {
        if (res.confirm) {
          const courses = util.getCourses()
          const targetIndex = courses.findIndex(c => c.id === courseId)
          if (targetIndex !== -1) {
            courses.splice(targetIndex, 1)
            util.saveCourses(courses, `删除课程: ${courseName}`)
          }
          this.loadCourses()
          wx.showToast({ title: '删除成功', icon: 'success' })
        }
      }
    })
  },

  clearAll() {
    // 注意：this.data.courses 只是当前学期筛选后的列表，判断要用全量数据
    const allCourses = util.getCourses()
    if (allCourses.length === 0) {
      wx.showToast({ title: '暂无数据', icon: 'none' })
      return
    }
    wx.showModal({
      title: '确认清空',
      content: `确定要清空全部 ${allCourses.length} 门课程吗？此操作可在「历史」页恢复。`,
      success: (res) => {
        if (res.confirm) {
          util.saveCourses([], '清空所有课程')
          this.loadCourses()
          wx.showToast({ title: '已清空', icon: 'success' })
        }
      }
    })
  },

  importCourses() {
    wx.navigateTo({ url: '/pages/login/login' })
  },

  toggleExcluded() {
    this.setData({ showExcluded: !this.data.showExcluded })
  },

  toggleCourseList() {
    this.setData({ showCourseList: !this.data.showCourseList })
  },

  includeExcludedCourse(e) {
    const courseId = e.currentTarget.dataset.id
    const allCourses = util.getCourses()
    const targetIndex = allCourses.findIndex(c => c.id === courseId)
    if (targetIndex === -1) {
      wx.showToast({ title: '课程不存在', icon: 'none' })
      return
    }
    const courseName = allCourses[targetIndex].name
    allCourses[targetIndex] = util.includeCourse(allCourses[targetIndex])
    util.saveCourses(allCourses, `加入课程: ${courseName}`)
    this.loadCourses()
    wx.showToast({ title: '已加入', icon: 'success' })
  },

  includeAllExcluded() {
    if (this.data.excludedCourses.length === 0) {
      wx.showToast({ title: '没有已排除课程', icon: 'none' })
      return
    }
    wx.showModal({
      title: '全部加入',
      content: `确定将${this.data.excludedCourses.length}门已排除课程全部加入绩点计算吗？`,
      success: (res) => {
        if (res.confirm) {
          const allCourses = util.getCourses()
          for (let i = 0; i < allCourses.length; i++) {
            if (util.isPublicElective(allCourses[i]) || util.shouldExcludeCourse(allCourses[i].name) || allCourses[i].forceExcluded) {
              allCourses[i] = util.includeCourse(allCourses[i])
            }
          }
          util.saveCourses(allCourses, '全部加入已排除课程')
          this.loadCourses()
          wx.showToast({ title: '已全部加入', icon: 'success' })
        }
      }
    })
  },

  excludeCourse(e) {
    const course = this.data.courses.find(c => c.id === e.currentTarget.dataset.id)
    if (!course) return
    const allCourses = util.getCourses()
    const targetIndex = allCourses.findIndex(c => c.id === course.id)
    if (targetIndex !== -1) {
      allCourses[targetIndex] = util.excludeCourse(allCourses[targetIndex])
      util.saveCourses(allCourses, `排除课程: ${course.name}`)
    }
    this.loadCourses()
    wx.showToast({ title: '已排除', icon: 'success' })
  },

  hideModal() {
    this.setData({ showModal: false })
  },

  onInputChange(e) {
    const field = e.currentTarget.dataset.field
    if (!field) return
    this.setData({ [`currentCourse.${field}`]: e.detail.value })
  },

  onTypeChange(e) {
    this.setData({ scoreTypeIndex: parseInt(e.detail.value) })
  },

  onGradeChange(e) {
    this.setData({ gradeIndex: parseInt(e.detail.value) })
  },

  onSemesterChange(e) {
    this.setData({ semesterIndex: parseInt(e.detail.value) })
  },

  saveCourse() {
    const { currentCourse, scoreTypeIndex, gradeIndex, semesterIndex, isEdit, editIndex } = this.data

    const name = String(currentCourse.name || '').trim()
    if (!name) {
      wx.showToast({ title: '请输入课程名称', icon: 'none' })
      return
    }

    const credits = Number(currentCourse.credits)
    // 注意 Number('abc') 是 NaN，NaN <= 0 为 false，必须显式判断 isFinite
    if (!Number.isFinite(credits) || credits <= 0) {
      wx.showToast({ title: '请输入有效学分', icon: 'none' })
      return
    }

    const courses = util.getCourses()
    // 编辑时保留原课程的课程性质与手动排除状态
    const originalCourse = isEdit ? courses.find(c => c.id === editIndex) : null

    const course = originalCourse ? { ...originalCourse } : {}
    course.id = isEdit ? editIndex : util.generateId()
    course.name = name
    course.credits = credits
    course.semester = this.data.semesters[semesterIndex] || util.UNKNOWN_SEMESTER

    if (scoreTypeIndex === 0) {
      // 空字符串会被 Number('') 转成 0，必须先判断是否真的填了成绩
      const rawScore = String(currentCourse.score === undefined || currentCourse.score === null ? '' : currentCourse.score).trim()
      const score = Number(rawScore)
      if (rawScore === '' || !Number.isFinite(score) || score < 0 || score > 100) {
        wx.showToast({ title: '请输入有效成绩(0-100)', icon: 'none' })
        return
      }
      delete course.grade
      course.score = score
      course.gpa = util.scoreToGPA(score)
    } else {
      const grade = this.data.grades[gradeIndex]
      if (!grade) {
        wx.showToast({ title: '请选择等级成绩', icon: 'none' })
        return
      }
      delete course.score
      course.grade = grade
      course.gpa = util.gradeToGPA(grade)
    }

    if (isEdit) {
      const targetIndex = courses.findIndex(c => c.id === editIndex)
      if (targetIndex !== -1) {
        courses[targetIndex] = course
      } else {
        courses.push(course)
      }
    } else {
      courses.push(course)
    }
    util.saveCourses(courses, isEdit ? `编辑课程: ${course.name}` : `添加课程: ${course.name}`)
    util.saveHistory({ type: isEdit ? 'edit' : 'add', course, time: new Date().toISOString() })

    this.setData({ showModal: false })
    this.loadCourses()
    wx.showToast({ title: isEdit ? '修改成功' : '添加成功', icon: 'success' })
  },

  onShareAppMessage() {
    return {
      title: '绩点计算器 - 轻松管理你的成绩',
      path: '/pages/index/index'
    }
  },

  onShareTimeline() {
    return {
      title: '绩点计算器 - 轻松管理你的成绩'
    }
  }
})
