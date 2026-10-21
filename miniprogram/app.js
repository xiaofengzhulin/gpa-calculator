const util = require('./utils/util.js')

// 本地缓存可能残留旧版本/异常写入的数据（比如被写成字符串），
// 这里统一校正为数组，避免页面 .map / .filter 直接抛异常导致白屏。
const ensureArrayStorage = (key) => {
  const value = wx.getStorageSync(key)
  if (!Array.isArray(value)) {
    wx.setStorageSync(key, [])
  }
}

// 早期版本写入的课程没有 id，而列表渲染、编辑、删除都依赖 id，
// 启动时补齐一次，避免老用户升级后点「编辑」无反应。
const ensureCourseIds = () => {
  const courses = wx.getStorageSync('courses')
  if (!Array.isArray(courses) || courses.length === 0) return

  let changed = false
  const next = []
  for (let i = 0; i < courses.length; i++) {
    const course = courses[i]
    if (!course || typeof course !== 'object') {
      changed = true
      continue
    }
    if (!course.id) {
      changed = true
      next.push({ ...course, id: util.generateId() })
    } else {
      next.push(course)
    }
  }
  if (changed) {
    wx.setStorageSync('courses', next)
  }
}

App({
  onLaunch() {
    try {
      ensureArrayStorage('courses')
      ensureArrayStorage('history')
      ensureArrayStorage('undoStack')
      ensureArrayStorage('redoStack')
      ensureCourseIds()
      util.initGPAMethod()
    } catch (e) {
      console.error('初始化存储失败:', e)
    }
  },

  onShow() {
    // 页面可能直接改写了 storage，回到前台时清空内存缓存重新读取
    util._clearCache()
  },

  onError(err) {
    console.error('小程序运行错误:', err)
  }
})
