Page({
  data: {
    version: '1.2.1',
    // 备案信息：法规要求在小程序显著位置展示
    // 公安备案通过后，把 police 换成真实编号（如 蒙公网安备150104XXXXXXXX号）
    // 并把 policeReady 改成 true 即可，无需再改页面
    icp: '蒙ICP备2026007686号-2',
    police: '公安备案办理中',
    policeReady: false
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
