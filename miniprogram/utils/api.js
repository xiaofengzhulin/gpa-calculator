/**
 * 教务系统 API 接口模块
 * 
 * 通过代理服务器获取教务系统成绩
 * 使用前需确保代理服务器已启动（server/server.js）
 */

// 代理服务器地址（正式环境）
// 走已备案域名的 HTTPS：小程序正式版强制要求 HTTPS + 已备案的合法域名
const DEFAULT_API_BASE = 'https://xiaofengzhulin.xyz'

// 本地调试备用地址（仅开发者工具勾选「不校验合法域名」时可用）
const DEV_API_BASE = 'http://182.92.80.164:3000'

/**
 * 运行时切换接口地址（调试用，写入本地缓存后永久生效）
 *   切到备用地址：require('../../utils/api.js').setApiBase(DEV_API_BASE)
 *   恢复正式地址：resetApiBase()
 * @param {string} base 形如 https://xiaofengzhulin.xyz
 */
function setApiBase(base) {
  wx.setStorageSync('apiBase', base)
}

function resetApiBase() {
  wx.removeStorageSync('apiBase')
}

function getApiBase() {
  return wx.getStorageSync('apiBase') || DEFAULT_API_BASE
}

/**
 * 登录教务系统并获取成绩
 * @param {string} username 学号
 * @param {string} password 密码
 * @returns {Promise<{success: boolean, courses: Array, count: number}>}
 */
function fetchGrades(username, password) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${getApiBase()}/api/login`,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: { username, password },
      timeout: 30000,
      success(res) {
        if (res.statusCode === 200 && res.data && res.data.success) {
          resolve(res.data)
        } else {
          const errMsg = (res.data && res.data.error) || `请求失败 (${res.statusCode})`
          const err = new Error(errMsg)
          // 服务端会带出剩余尝试次数 / 解锁倒计时，便于界面提示
          if (res.data) {
            if (res.data.remainingAttempts !== undefined) err.remainingAttempts = res.data.remainingAttempts
            if (res.data.retryAfter !== undefined) err.retryAfter = res.data.retryAfter
            if (res.data.scope) err.scope = res.data.scope
          }
          reject(err)
        }
      },
      fail(err) {
        reject(new Error(err.errMsg || '网络请求失败，请检查服务器是否启动'))
      }
    })
  })
}

/**
 * 检查服务器是否在线
 * @returns {Promise<boolean>}
 */
function checkHealth() {
  return new Promise((resolve) => {
    wx.request({
      url: `${getApiBase()}/api/health`,
      method: 'GET',
      timeout: 5000,
      success(res) {
        resolve(res.statusCode === 200)
      },
      fail() {
        resolve(false)
      }
    })
  })
}

module.exports = { fetchGrades, checkHealth, getApiBase, setApiBase, resetApiBase, DEFAULT_API_BASE, DEV_API_BASE }
