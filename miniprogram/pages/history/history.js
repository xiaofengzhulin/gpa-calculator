// pages/history/history.js
const util = require('../../utils/util.js')

Page({
  data: {
    snapshots: []
  },

  onLoad() {
    this.loadData()
  },

  onShow() {
    this.loadData()
  },

  loadData() {
    const undoStack = wx.getStorageSync('undoStack') || []
    const currentCourses = util.getCourses()

    const snapshots = [{
      courses: currentCourses,
      description: '当前状态',
      time: new Date().toISOString(),
      isCurrent: true
    }]

    const stack = undoStack.slice(-15).reverse()
    for (let i = 0; i < stack.length; i++) {
      snapshots.push({
        courses: stack[i].courses,
        description: stack[i].description,
        time: stack[i].time,
        isCurrent: false
      })
    }

    this.setData({
      snapshots: snapshots.map(item => ({
        ...item,
        timeStr: this._formatTime(item.time),
        courseCount: item.courses.length
      }))
    })
  },

  _formatTime(timeStr) {
    const date = new Date(timeStr)
    const now = new Date()
    const diff = now - date

    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
    if (date.toDateString() === now.toDateString()) {
      return `今天 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
    }

    const month = (date.getMonth() + 1).toString().padStart(2, '0')
    const day = date.getDate().toString().padStart(2, '0')
    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    return `${month}-${day} ${hours}:${minutes}`
  },

  restoreSnapshot(e) {
    const index = e.currentTarget.dataset.index
    const snapshot = this.data.snapshots[index]

    if (snapshot.isCurrent) {
      wx.showToast({ title: '已是当前状态', icon: 'none' })
      return
    }

    wx.showModal({
      title: '恢复历史状态',
      content: `确定要恢复到「${snapshot.description}」吗？\n\n该时间点有${snapshot.courseCount}门课程。此操作会替换当前数据。`,
      success: (res) => {
        if (res.confirm) {
          const undoStack = wx.getStorageSync('undoStack') || []
          undoStack.push({
            courses: util.getCourses(),
            description: '恢复前状态',
            time: new Date().toISOString()
          })
          if (undoStack.length > 50) undoStack.shift()
          wx.setStorageSync('undoStack', undoStack)
          wx.setStorageSync('courses', snapshot.courses)
          wx.setStorageSync('redoStack', [])

          // 清除缓存，确保主页重新加载数据
          util._clearCache()

          this.loadData()
          wx.showToast({ title: '已恢复', icon: 'success' })
        }
      }
    })
  },

  clearHistory() {
    wx.showModal({
      title: '确认清空',
      content: '确定要清空所有历史记录吗？',
      success: (res) => {
        if (res.confirm) {
          wx.setStorageSync('history', [])
          this.loadData()
          wx.showToast({ title: '已清空', icon: 'success' })
        }
      }
    })
  },

  onShareAppMessage() {
    return {
      title: '绩点计算器 - 轻松管理你的成绩',
      path: '/pages/index/index'
    }
  },

  onShareTimeline() {
    return {
      title: '绩点计算器 - 查看操作历史记录'
    }
  }
})
