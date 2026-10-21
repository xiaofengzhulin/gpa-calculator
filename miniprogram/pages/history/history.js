// pages/history/history.js
const util = require('../../utils/util.js')

Page({
  data: {
    snapshots: [],
    hasRecords: false
  },

  // onLoad 与 onShow 都会触发，统一只在 onShow 加载，避免首屏重复 setData
  onShow() {
    this.loadData()
  },

  loadData() {
    const undoStack = wx.getStorageSync('undoStack') || []
    const currentCourses = util.getCourses()

    const snapshots = [{
      uid: 'current',
      courses: currentCourses,
      description: '当前状态',
      time: new Date().toISOString(),
      isCurrent: true
    }]

    const stack = (Array.isArray(undoStack) ? undoStack : [])
      .filter(item => item && Array.isArray(item.courses))
      .slice(-15)
      .reverse()
    for (let i = 0; i < stack.length; i++) {
      snapshots.push({
        uid: `${stack[i].time || ''}-${i}`,
        courses: stack[i].courses,
        description: stack[i].description || '修改课程',
        time: stack[i].time,
        isCurrent: false
      })
    }

    this.setData({
      hasRecords: snapshots.length > 1,
      snapshots: snapshots.map(item => ({
        ...item,
        timeStr: this._formatTime(item.time),
        courseCount: item.courses.length
      }))
    })
  },

  _formatTime(timeStr) {
    const date = new Date(timeStr)
    if (isNaN(date.getTime())) return '时间未知'
    const now = new Date()
    const diff = now - date

    if (diff < 0) return '刚刚'
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
    const index = Number(e.currentTarget.dataset.index)
    const snapshot = this.data.snapshots[index]

    if (!snapshot || !Array.isArray(snapshot.courses)) {
      wx.showToast({ title: '记录已失效', icon: 'none' })
      this.loadData()
      return
    }

    if (snapshot.isCurrent) {
      wx.showToast({ title: '已是当前状态', icon: 'none' })
      return
    }

    wx.showModal({
      title: '恢复历史状态',
      content: `确定要恢复到「${snapshot.description}」吗？\n\n该时间点有${snapshot.courseCount}门课程，当前数据会被替换（可在本页再恢复回来）。`,
      success: (res) => {
        if (!res.confirm) return
        // 深拷贝，避免恢复后的课程对象与历史快照共用引用
        const courses = snapshot.courses.map(c => (c && typeof c === 'object' ? { ...c } : c)).filter(c => c && typeof c === 'object')
        // 复用 saveCourses：自动写入撤销栈、清空重做栈并同步缓存
        util.saveCourses(courses, `恢复到：${snapshot.description}`)
        this.loadData()
        wx.showToast({ title: '已恢复', icon: 'success' })
      }
    })
  },

  clearHistory() {
    if (!this.data.hasRecords) {
      wx.showToast({ title: '暂无记录', icon: 'none' })
      return
    }
    wx.showModal({
      title: '清空操作记录',
      content: '确定要清空所有历史记录吗？当前课程数据不会被删除，只是不能再用本页恢复。',
      success: (res) => {
        if (!res.confirm) return
        // 本页展示的是 undoStack，清空时要一起清掉，否则按钮点了没反应
        wx.removeStorageSync('undoStack')
        wx.removeStorageSync('redoStack')
        wx.removeStorageSync('history')
        util._clearCache()
        this.loadData()
        wx.showToast({ title: '已清空', icon: 'success' })
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
