// pages/statistics/statistics.js
const util = require('../../utils/util.js')

const DISTRIBUTION_COLORS = {
  '优秀(4.0+)': '#52c41a',
  '良好(3.0-4.0)': '#4A90E2',
  '中等(2.0-3.0)': '#faad14',
  '及格(1.0-2.0)': '#ff7a45',
  '不及格(<1.0)': '#ff4d4f'
}

Page({
  data: {
    stats: {
      totalCourses: 0,
      totalCredits: 0,
      averageGPA: '0.00',
      highestGPA: 0,
      lowestGPA: 0,
      gradeDistribution: {},
      semesterTrend: []
    },
    distributionData: [],
    semesterTrend: []
  },

  onShow() {
    this.loadStatistics()
  },

  loadStatistics() {
    const courses = util.getCourses()
    const stats = util.calculateStatistics(courses)

    const distributionData = Object.keys(stats.gradeDistribution).map(name => {
      const count = stats.gradeDistribution[name]
      // 数量为 0 时不画进度条，避免出现「0 门却有 2% 长条」的错觉
      const percentage = count > 0 && stats.totalCourses > 0
        ? Math.max((count / stats.totalCourses) * 100, 2)
        : 0
      return {
        name,
        count,
        percentage: Number(percentage.toFixed(1)),
        color: DISTRIBUTION_COLORS[name]
      }
    })

    this.setData({
      stats,
      distributionData,
      semesterTrend: stats.semesterTrend.map(item => {
        const gpa = Number(item.gpa)
        const gpaPercent = Number.isFinite(gpa) ? Math.max((gpa / 4.67) * 100, 2) : 0
        return {
          ...item,
          gpaPercent: Number(gpaPercent.toFixed(1))
        }
      })
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
