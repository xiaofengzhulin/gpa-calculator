const util = require('./utils/util.js')

App({
  onLaunch() {
    // 初始化存储
    try {
      if (!wx.getStorageSync('courses')) wx.setStorageSync('courses', [])
      if (!wx.getStorageSync('history')) wx.setStorageSync('history', [])
      util.initGPAMethod()
    } catch (e) {
      console.error('初始化存储失败:', e)
    }
  },

  onShow() {
    util._clearCache()
  }
})
