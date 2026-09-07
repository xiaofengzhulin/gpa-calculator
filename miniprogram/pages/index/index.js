// pages/index/index.js
const util = require('../../utils/util.js')

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
    semesters: ['大一上', '大一下', '大二上', '大二下', '大三上', '大三下', '大四上', '大四下'],
    semesterIndex: 0,
    showRewardModal: false
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

    // 导入成绩后弹出赞赏码
    if (wx.getStorageSync('showRewardAfterImport')) {
      wx.removeStorageSync('showRewardAfterImport')
      this.setData({ showRewardModal: true })
    }
  },

  loadCourses() {
    const allCourses = util.getCourses()
    const excluded = util.getExcludedCourses(allCourses)
    const excludedIds = new Set(excluded.map(c => c.id))
    const included = allCourses.filter(c => !excludedIds.has(c.id))

    const semesterSet = new Set()
    for (let i = 0; i < included.length; i++) {
      if (included[i].semester) semesterSet.add(included[i].semester)
    }
    const availableSemesters = ['全部', ...Array.from(semesterSet).sort()]

    const filterSemester = this.data.filterSemester
    const filteredCourses = filterSemester === '全部'
      ? included
      : included.filter(c => c.semester === filterSemester)
    const result = util.calculateGPA(filteredCourses)
    const finalFilter = availableSemesters.includes(filterSemester) ? filterSemester : '全部'

    const formatCourse = (course) => {
      const gpa = util.getCourseGPA(course)
      return { ...course, gpa: gpa.toFixed(1), gpaColor: util.getGradeColor(gpa) }
    }

    this.setData({
      courses: filteredCourses.map(formatCourse),
      excludedCourses: excluded.map(formatCourse),
      availableSemesters,
      filterSemester: finalFilter,
      currentGPAMethod: util.getGPAMethod(),
      gpa: result.gpa,
      totalCredits: result.totalCredits,
      earnedCredits: result.earnedCredits,
      gradeLevel: util.getGradeLevel(Number(result.gpa)),
      gradeColor: util.getGradeColor(Number(result.gpa))
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
      currentCourse: { name: '', credits: '', score: '', grade: '', semester: this.data.semesters[0] },
      scoreTypeIndex: 0,
      gradeIndex: 0,
      semesterIndex: 0
    })
  },

  editCourse(e) {
    const courseId = e.currentTarget.dataset.id
    const course = this.data.courses.find(c => c.id === courseId)
    if (!course) return
    const isGradeType = course.grade && !course.score
    this.setData({
      showModal: true,
      isEdit: true,
      editIndex: course.id,
      currentCourse: { name: course.name, credits: course.credits, score: course.score || '', grade: course.grade || '', semester: course.semester },
      scoreTypeIndex: isGradeType ? 1 : 0,
      gradeIndex: isGradeType ? this.data.grades.indexOf(course.grade) : 0,
      semesterIndex: Math.max(0, this.data.semesters.indexOf(course.semester))
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
    if (this.data.courses.length === 0) {
      wx.showToast({ title: '暂无数据', icon: 'none' })
      return
    }
    wx.showModal({
      title: '确认清空',
      content: '确定要清空所有课程数据吗？此操作可以撤销。',
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
    const index = e.currentTarget.dataset.index
    const course = this.data.excludedCourses[index]
    const allCourses = util.getCourses()
    const targetIndex = allCourses.findIndex(c => c.id === course.id)
    if (targetIndex !== -1) {
      allCourses[targetIndex] = util.includeCourse(allCourses[targetIndex])
      util.saveCourses(allCourses, `加入课程: ${course.name}`)
    }
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

  hideRewardModal() {
    this.setData({ showRewardModal: false })
  },

  previewRewardImage() {
    wx.previewImage({
      urls: ['/images/reward.png'],
      current: '/images/reward.png'
    })
  },

  onInputChange(e) {
    this.setData({ [`currentCourse.${e.currentTarget.dataset.field}`]: e.detail.value })
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

    if (!currentCourse.name.trim()) {
      wx.showToast({ title: '请输入课程名称', icon: 'none' })
      return
    }
    if (!currentCourse.credits || Number(currentCourse.credits) <= 0) {
      wx.showToast({ title: '请输入有效学分', icon: 'none' })
      return
    }

    const courses = util.getCourses()
    // 编辑时保留原课程的课程性质与手动排除状态
    const originalCourse = isEdit ? courses.find(c => c.id === editIndex) : null

    const course = {
      id: isEdit ? editIndex : util.generateId(),
      name: currentCourse.name.trim(),
      credits: Number(currentCourse.credits),
      semester: this.data.semesters[semesterIndex],
      type: originalCourse ? (originalCourse.type || '') : ''
    }
    if (originalCourse && originalCourse.forceIncluded) course.forceIncluded = true
    if (originalCourse && originalCourse.forceExcluded) course.forceExcluded = true

    if (scoreTypeIndex === 0) {
      const score = Number(currentCourse.score)
      if (isNaN(score) || score < 0 || score > 100) {
        wx.showToast({ title: '请输入有效成绩(0-100)', icon: 'none' })
        return
      }
      course.score = score
      course.gpa = util.scoreToGPA(score)
    } else {
      course.grade = this.data.grades[gradeIndex]
      course.gpa = util.gradeToGPA(course.grade)
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
