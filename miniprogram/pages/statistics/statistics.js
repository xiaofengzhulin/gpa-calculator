// pages/statistics/statistics.js
const util = require('../../utils/util.js')

Page({
  data: {
    stats: {
      totalCourses: 0,
      totalCredits: 0,
      averageGPA: '0.00',
      highestGPA: 0,
      lowestGPA: 4.67,
      gradeDistribution: {},
      semesterTrend: []
    },
    distributionData: [],
    semesterTrend: []
  },

  onLoad() {
    this.loadStatistics()
  },

  onShow() {
    this.loadStatistics()
  },

  loadStatistics() {
    const courses = util.getCourses()
    const stats = util.calculateStatistics(courses)

    const colors = {
      '优秀(4.0+)': '#52c41a',
      '良好(3.0-4.0)': '#4A90E2',
      '中等(2.0-3.0)': '#faad14',
      '及格(1.0-2.0)': '#ff7a45',
      '不及格(<1.0)': '#ff4d4f'
    }

    const distributionData = Object.keys(stats.gradeDistribution).map(name => ({
      name,
      count: stats.gradeDistribution[name],
      percentage: stats.totalCourses > 0 ? Math.max((stats.gradeDistribution[name] / stats.totalCourses) * 100, 2) : 0,
      color: colors[name]
    }))

    this.setData({
      stats,
      distributionData,
      semesterTrend: stats.semesterTrend.map(item => ({
        ...item,
        gpaPercent: Math.max((Number(item.gpa) / 4.67) * 100, 2)
      }))
    })
  },

  goToCalc() {
    wx.switchTab({ url: '/pages/index/index' })
  },

  onShareAppMessage() {
    return {
      title: '绩点计算器 - 轻松管理你的成绩',
      path: '/pages/index/index'
    }
  },

  onShareTimeline() {
    return {
      title: '绩点计算器 - 查看成绩统计分析'
    }
  }
})
