Page({
  data: {
    version: '1.2.3',
    // 备案信息：法规要求在小程序显著位置展示
    icp: '蒙ICP备2026007686号-2',
    police: '蒙公网安备15010402000835号',
    policeReady: true
  },

  copyFeedbackEmail() {
    wx.setClipboardData({
      data: '2848801752@qq.com',
      success() {
        wx.showToast({ title: '邮箱已复制', icon: 'success' })
      }
    })
  },

  // 小程序内无法直接跳转外部备案查询页，按惯例提供点击复制
  copyBeian(e) {
    const text = (e.currentTarget.dataset.text || '').trim()
    if (!text) {
      wx.showToast({ title: '公安备案通过后展示', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: text,
      success() {
        wx.showToast({ title: '备案号已复制', icon: 'success' })
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
