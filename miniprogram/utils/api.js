/**
 * 教务系统 API 接口模块
 * 
 * 通过代理服务器获取教务系统成绩
 * 使用前需确保代理服务器已启动（server/server.js）
 */

// 代理服务器地址 - 开发环境使用局域网 IP，部署后改为服务器地址
// ⚠️ 手机和电脑需在同一局域网（连同一个 WiFi）
// 可通过 wx.setStorageSync('apiBase', 'http://x.x.x.x:3000') 动态覆盖
const DEFAULT_API_BASE = 'http://172.29.12.179:3000'

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
          reject(new Error(errMsg))
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

module.exports = { fetchGrades, checkHealth, getApiBase, DEFAULT_API_BASE }
