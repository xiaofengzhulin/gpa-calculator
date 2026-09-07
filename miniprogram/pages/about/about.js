Page({
  data: {
    version: '1.2.0'
  },

  copyFeedbackEmail() {
    wx.setClipboardData({
      data: '2848801752@qq.com',
      success() {
        wx.showToast({ title: '邮箱已复制', icon: 'success' })
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
      title: '绩点计算器 - 轻松管理你的成绩'
    }
  }
})
