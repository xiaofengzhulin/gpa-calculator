/*!
 * app.js — yjt燕理绩点计算通 网页版
 * 功能与微信小程序保持一致：课程管理、多算法 GPA、学期筛选、排除规则、
 * 统计、撤销/重做、历史快照、教务系统导入 + 手动粘贴导入。
 * 无框架、无外部依赖，纯静态资源，可直接由 nginx 托管。
 */
(function () {
  'use strict'

  var L = window.GPALib
  var API_TIMEOUT = 90000

  var state = {
    tab: 'calc',
    filterSemester: '全部',
    showExcluded: false,
    modal: null,            // null | 'course' | 'method' | 'import'
    draft: null,            // 课程表单草稿
    editingId: null,
    importTab: 'auto',      // 'auto' | 'paste'
    importOverwrite: true,
    autoUsername: '',
    autoPassword: '',
    rememberUsername: false,
    importing: false,
    pasteText: '',
    pasteRows: null,        // 从剪贴板 HTML 表格解析出的行
    pastePreview: null,     // 解析结果预览
    parseError: ''
  }

  var $view = document.getElementById('view')
  var $tabs = document.getElementById('tabs')
  var $modalRoot = document.getElementById('modal-root')
  var $toast = document.getElementById('toast')

  // ==================== 小工具 ====================
  var ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  function esc(v) {
    return String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, function (c) { return ESCAPE[c] })
  }
  function fmtCredits(n) {
    var v = Number(n)
    return isNaN(v) ? '0' : String(Math.round(v * 100) / 100)
  }
  // 单科 / 统计绩点统一两位小数；非法值兜底为 0.00，绝不把 NaN 渲染到页面
  function fmtGPA(n) {
    var v = Number(n)
    return Number.isFinite(v) ? v.toFixed(2) : '0.00'
  }
  function scoreText(c) {
    // 0 分是合法成绩，不能用 `score || grade` 判断（0 会被当成 false）
    if (!c || typeof c !== 'object') return '—'
    if (c.score !== undefined && c.score !== null && c.score !== '') return String(c.score)
    if (c.grade) return String(c.grade)
    return '—'
  }
  function fmtTime(iso) {
    var d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    var now = new Date()
    var diff = now - d
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
    var pad = function (n) { return String(n).padStart(2, '0') }
    if (d.toDateString() === now.toDateString()) return '今天 ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
  }

  var toastTimer = null
  function toast(msg) {
    if (!$toast) return
    $toast.textContent = msg
    $toast.hidden = false
    $toast.classList.add('is-show')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(function () {
      $toast.classList.remove('is-show')
      $toast.hidden = true
    }, 2200)
  }

  // ==================== 视图模型 ====================
  function buildViewModel() {
    var all = L.getCourses()
    var excluded = L.getExcludedCourses(all)
    var excludedIds = {}
    excluded.forEach(function (c) { excludedIds[c.id] = true })
    var included = all.filter(function (c) { return !excludedIds[c.id] })

    var semesterSet = {}
    included.forEach(function (c) { if (c.semester) semesterSet[c.semester] = true })
    var semesters = Object.keys(semesterSet).sort()

    var filter = state.filterSemester
    if (filter !== '全部' && semesters.indexOf(filter) === -1) filter = '全部'
    state.filterSemester = filter

    var list = filter === '全部' ? included : included.filter(function (c) { return c.semester === filter })
    return {
      all: all,
      included: included,
      excluded: excluded,
      semesters: semesters,
      filter: filter,
      list: list,
      result: L.calculateGPA(list)
    }
  }

  // ==================== 计算页 ====================
  function courseRow(c, options) {
    var opts = options || {}
    var gpa = L.getCourseGPA(c)
    var html = '<li class="course' + (opts.excluded ? ' is-excluded' : '') + '">'
    html += '<div class="course-main">'
    html += '<p class="course-name">' + esc(c.name) + '</p>'
    html += '<p class="course-meta">'
    html += '<span class="tag">' + esc(c.semester || L.UNKNOWN_SEMESTER) + '</span>'
    html += '<span>' + fmtCredits(c.credits) + ' 学分</span>'
    html += '<span>成绩 <b>' + esc(scoreText(c)) + '</b></span>'
    if (c.type) html += '<span class="tag tag-soft">' + esc(c.type) + '</span>'
    html += '</p>'
    html += '</div>'

    if (!opts.excluded) {
      html += '<div class="course-gpa" style="color:' + L.getGradeColor(gpa) + '">' + fmtGPA(gpa) + '</div>'
      html += '<div class="course-ops">'
      html += '<button class="btn-icon" data-act="edit" data-id="' + esc(c.id) + '">编辑</button>'
      html += '<button class="btn-icon" data-act="exclude" data-id="' + esc(c.id) + '">排除</button>'
      html += '<button class="btn-icon btn-danger" data-act="delete" data-id="' + esc(c.id) + '">删除</button>'
      html += '</div>'
    } else {
      html += '<div class="course-ops">'
      html += '<button class="btn-icon" data-act="include" data-id="' + esc(c.id) + '">加入</button>'
      html += '</div>'
    }
    html += '</li>'
    return html
  }

  function viewCalc() {
    var vm = buildViewModel()
    var r = vm.result
    var gpaNum = Number(r.gpa)
    var hasCourses = vm.list.length > 0
    // 没有课程（或结果异常）时显示「暂无数据」，不能误报成「不及格」
    var level = hasCourses && Number.isFinite(gpaNum) ? L.getGradeLevel(gpaNum) : '暂无数据'
    var color = hasCourses && Number.isFinite(gpaNum) ? L.getGradeColor(gpaNum) : '#98a2b3'

    var html = ''

    // 结果卡
    html += '<section class="card result-card">'
    html += '<div class="result-top">'
    html += '<div>'
    html += '<p class="result-label">' + (vm.filter === '全部' ? '累计绩点' : esc(vm.filter) + ' 绩点') + '</p>'
    html += '<p class="result-value" style="color:' + color + '">' + esc(r.gpa) + '</p>'
    html += '</div>'
    html += '<button class="btn-ghost" data-act="open-method">算法：<b>' + esc(L.getGPAMethod()) + '</b><span class="caret-sm" aria-hidden="true"></span></button>'
    html += '</div>'
    html += '<div class="result-stats">'
    html += '<div><span class="num">' + fmtCredits(r.totalCredits) + '</span><span class="lbl">总学分</span></div>'
    html += '<div><span class="num">' + fmtCredits(r.earnedCredits) + '</span><span class="lbl">已获学分</span></div>'
    html += '<div><span class="num">' + vm.list.length + '</span><span class="lbl">计入课程</span></div>'
    html += '<div><span class="num" style="color:' + color + '">' + esc(level) + '</span><span class="lbl">等级</span></div>'
    html += '</div>'
    html += '</section>'

    // 学期筛选
    html += '<div class="chips">'
    html += ['全部'].concat(vm.semesters).map(function (s) {
      return '<button class="chip' + (s === vm.filter ? ' is-active' : '') + '" data-act="semester" data-sem="' + esc(s) + '">' + esc(s) + '</button>'
    }).join('')
    html += '</div>'

    // 操作区
    html += '<div class="toolbar">'
    html += '<button class="btn btn-primary" data-act="open-import"><span class="ico">↓</span>导入成绩</button>'
    html += '<button class="btn" data-act="open-add"><span class="ico">+</span>添加课程</button>'
    html += '<div class="toolbar-right">'
    html += '<button class="btn-sm" data-act="undo"' + (L.canUndo() ? '' : ' disabled') + '>撤销</button>'
    html += '<button class="btn-sm" data-act="redo"' + (L.canRedo() ? '' : ' disabled') + '>重做</button>'
    html += '<button class="btn-sm btn-danger-ghost" data-act="clear-all"' + (vm.all.length ? '' : ' disabled') + '>清空</button>'
    html += '</div>'
    html += '</div>'

    // 已排除课程
    html += '<section class="card">'
    html += '<button class="card-head" data-act="toggle-excluded">'
    html += '<span class="card-title">已排除课程<span class="count">' + vm.excluded.length + '</span></span>'
    html += '<span class="caret">' + (state.showExcluded ? '收起 ▲' : '展开 ▼') + '</span>'
    html += '</button>'
    if (state.showExcluded) {
      if (!vm.excluded.length) {
        html += '<p class="hint">暂无已排除课程。公共选修课、体育课会自动排除，也可以在课程列表里手动排除任意课程。</p>'
      } else {
        html += '<p class="hint">共 ' + vm.excluded.length + ' 门，点击「加入」即可计入绩点。</p>'
        html += '<ul class="course-list">' + vm.excluded.map(function (c) { return courseRow(c, { excluded: true }) }).join('') + '</ul>'
        html += '<div class="card-foot"><button class="btn-sm" data-act="include-all">全部加入绩点计算</button></div>'
      }
    }
    html += '</section>'

    // 课程列表
    html += '<section class="card">'
    html += '<div class="card-head is-static"><span class="card-title">课程列表<span class="count">' + vm.list.length + '</span></span></div>'
    if (!hasCourses) {
      html += '<div class="empty">'
      html += '<div class="empty-icon">📚</div>'
      html += '<p class="empty-title">还没有课程数据</p>'
      html += '<p class="empty-desc">可以从教务系统导入成绩，也可以手动添加课程。所有数据只保存在你自己的浏览器里，不会上传到服务器。</p>'
      html += '<div class="empty-actions">'
      html += '<button class="btn btn-primary" data-act="open-import">从教务系统导入</button>'
      html += '<button class="btn" data-act="open-add">手动添加</button>'
      html += '</div>'
      html += '</div>'
    } else {
      html += '<ul class="course-list">' + vm.list.map(function (c) { return courseRow(c) }).join('') + '</ul>'
    }
    html += '</section>'

    // 本站说明（备案审核可见）
    html += '<section class="card about-strip">'
    html += '<p><b>关于本站</b>：yjt燕理绩点计算通是一个个人学习辅助工具，用于管理课程成绩并按多种算法换算绩点，支持学期筛选、成绩统计与教务系统成绩导入。本站为<strong>个人非经营性网站</strong>，不提供用户注册、发帖、评论等交互服务，课程数据仅保存在浏览器本地，不上传服务器。</p>'
    html += '<p class="hint">如需了解备案信息与数据说明，请查看「<a href="#" data-act="tab" data-tab="about">关于</a>」页。</p>'
    html += '</section>'

    return html
  }

  // ==================== 统计页 ====================
  function viewStats() {
    var stats = L.calculateStatistics(L.getCourses())
    var order = ['优秀(4.0+)', '良好(3.0-4.0)', '中等(2.0-3.0)', '及格(1.0-2.0)', '不及格(<1.0)']
    var colors = {
      '优秀(4.0+)': '#52c41a',
      '良好(3.0-4.0)': '#4A90E2',
      '中等(2.0-3.0)': '#faad14',
      '及格(1.0-2.0)': '#ff7a45',
      '不及格(<1.0)': '#ff4d4f'
    }

    var html = ''
    html += '<section class="card">'
    html += '<div class="card-head is-static"><span class="card-title">总览</span></div>'
    html += '<div class="stat-grid">'
    html += '<div class="stat"><span class="stat-num">' + stats.totalCourses + '</span><span class="stat-lbl">计入课程</span></div>'
    html += '<div class="stat"><span class="stat-num">' + fmtCredits(stats.totalCredits) + '</span><span class="stat-lbl">总学分</span></div>'
    html += '<div class="stat"><span class="stat-num" style="color:' + L.getGradeColor(Number(stats.averageGPA)) + '">' + esc(stats.averageGPA) + '</span><span class="stat-lbl">平均绩点</span></div>'
    html += '<div class="stat"><span class="stat-num">' + fmtGPA(stats.highestGPA) + '</span><span class="stat-lbl">最高单科</span></div>'
    html += '<div class="stat"><span class="stat-num">' + fmtGPA(stats.lowestGPA) + '</span><span class="stat-lbl">最低单科</span></div>'
    html += '</div>'
    html += '</section>'

    html += '<section class="card">'
    html += '<div class="card-head is-static"><span class="card-title">成绩分布</span></div>'
    if (!stats.totalCourses) {
      html += '<p class="hint">暂无数据，先去「计算」页导入或添加课程。</p>'
    } else {
      html += '<div class="bars">'
      order.forEach(function (name) {
        var count = stats.gradeDistribution[name] || 0
        var pct = Math.max((count / stats.totalCourses) * 100, count > 0 ? 4 : 0)
        html += '<div class="bar-row">'
        html += '<span class="bar-label">' + esc(name) + '</span>'
        html += '<span class="bar-track"><span class="bar-fill" style="width:' + pct.toFixed(1) + '%;background:' + colors[name] + '"></span></span>'
        html += '<span class="bar-value">' + count + '</span>'
        html += '</div>'
      })
      html += '</div>'
    }
    html += '</section>'

    html += '<section class="card">'
    html += '<div class="card-head is-static"><span class="card-title">各学期绩点趋势</span></div>'
    if (!stats.semesterTrend.length) {
      html += '<p class="hint">暂无数据。</p>'
    } else {
      html += '<div class="bars">'
      stats.semesterTrend.forEach(function (item) {
        var pct = Math.max((Number(item.gpa) / 4.67) * 100, 3)
        html += '<div class="bar-row">'
        html += '<span class="bar-label">' + esc(item.semester) + '</span>'
        html += '<span class="bar-track"><span class="bar-fill" style="width:' + pct.toFixed(1) + '%;background:' + L.getGradeColor(Number(item.gpa)) + '"></span></span>'
        html += '<span class="bar-value">' + esc(item.gpa) + '<small> / ' + fmtCredits(item.credits) + ' 学分</small></span>'
        html += '</div>'
      })
      html += '</div>'
    }
    html += '</section>'

    return html
  }

  // ==================== 历史页 ====================
  function viewHistory() {
    var snapshots = L.getSnapshots(15)
    var html = ''
    html += '<section class="card">'
    html += '<div class="card-head is-static"><span class="card-title">操作历史</span></div>'
    html += '<p class="hint">每次修改都会保存一个快照（最多保留 50 步），点击「恢复」可回到任意时间点。恢复操作本身也可以撤销。</p>'
    html += '<div class="toolbar-left">'
    html += '<button class="btn-sm" data-act="undo"' + (L.canUndo() ? '' : ' disabled') + '>撤销一步</button>'
    html += '<button class="btn-sm" data-act="redo"' + (L.canRedo() ? '' : ' disabled') + '>重做一步</button>'
    html += '<button class="btn-sm btn-danger-ghost" data-act="clear-history"' + (snapshots.length > 1 ? '' : ' disabled') + '>清空历史</button>'
    html += '</div>'
    html += '</section>'

    html += '<section class="card">'
    html += '<ul class="snapshots">'
    snapshots.forEach(function (item, index) {
      html += '<li class="snapshot' + (item.isCurrent ? ' is-current' : '') + '">'
      html += '<div class="snapshot-main">'
      html += '<p class="snapshot-desc">' + esc(item.description) + (item.isCurrent ? '<span class="tag tag-brand">当前</span>' : '') + '</p>'
      html += '<p class="snapshot-meta">' + fmtTime(item.time) + ' · ' + (item.courses || []).length + ' 门课程</p>'
      html += '</div>'
      if (!item.isCurrent) {
        html += '<button class="btn-sm" data-act="restore" data-index="' + index + '">恢复</button>'
      }
      html += '</li>'
    })
    html += '</ul>'
    html += '</section>'
    return html
  }

  // ==================== 关于页 ====================
  function viewAbout() {
    var html = ''
    html += '<section class="card">'
    html += '<div class="card-head is-static"><span class="card-title">网站说明</span></div>'
    html += '<p><b>yjt燕理绩点计算通</b>是一个个人学习辅助工具网站，用于录入、管理课程成绩并按多种算法换算绩点。网站为<strong>个人非经营性网站</strong>，由个人开发者独立建设与维护，不提供用户注册、信息发布、发帖评论等交互服务，不从事任何经营活动。</p>'
    html += '<p>本站不发布新闻、出版、教育等需前置审批的信息内容，仅提供工具类功能。</p>'
    html += '</section>'

    html += '<section class="card">'
    html += '<div class="card-head is-static"><span class="card-title">主要功能</span></div>'
    html += '<ul class="plain-list">'
    html += '<li>课程成绩录入、编辑、删除，按学期筛选</li>'
    html += '<li>7 种 GPA 算法：燕理算法、标准 4.0、北大算法、浙大算法、WES 算法、加拿大 4.3、公式法</li>'
    html += '<li>公共选修课、体育课自动排除，也可手动加入或排除任意课程</li>'
    html += '<li>成绩分布、各学期绩点趋势等统计分析</li>'
    html += '<li>手动粘贴成绩表格导入，或从教务系统导入本人成绩</li>'
    html += '<li>撤销 / 重做与历史快照恢复</li>'
    html += '</ul>'
    html += '</section>'

    html += '<section class="card">'
    html += '<div class="card-head is-static"><span class="card-title">数据与隐私</span></div>'
    html += '<ul class="plain-list">'
    html += '<li>课程数据仅保存在你当前浏览器的本地存储（localStorage）中，不会上传到服务器，也不会同步到其他设备。</li>'
    html += '<li>使用「教务系统导入」时，学号与密码仅用于本次查询请求，服务器不保存密码、不建立用户账号；密码不会写入浏览器存储。</li>'
    html += '<li>本站没有第三方统计脚本、广告或 Cookie 追踪。</li>'
    html += '<li>清除浏览器数据会同时清除本地课程记录。</li>'
    html += '</ul>'
    html += '</section>'

    html += '<section class="card">'
    html += '<div class="card-head is-static"><span class="card-title">备案信息</span></div>'
    html += '<table class="info-table">'
    html += '<tr><th>网站名称</th><td>yjt燕理绩点计算通</td></tr>'
    html += '<tr><th>网站域名</th><td>xiaofengzhulin.xyz</td></tr>'
    html += '<tr><th>网站性质</th><td>个人非经营性网站</td></tr>'
    html += '<tr><th>服务器位置</th><td>中国 · 阿里云（北京）</td></tr>'
    html += '<tr><th>工信部备案号</th><td><a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">蒙ICP备2026007686号-2</a></td></tr>'
    html += '<tr><th>公安备案号</th><td id="about-police"><a href="https://beian.mps.gov.cn/#/query/webSearch?code=15010402000835" target="_blank" rel="noopener noreferrer">蒙公网安备15010402000835号</a></td></tr>'
    html += '<tr><th>网站负责人</th><td>于铠歌</td></tr>'
    html += '<tr><th>联系邮箱</th><td><a href="mailto:2848801752@qq.com">2848801752@qq.com</a></td></tr>'
    html += '</table>'
    html += '</section>'

    html += '<p class="foot-note">本站仅供个人学习交流使用；教务系统成绩请遵守学校相关规定，勿用于其他用途。</p>'
    return html
  }

  // ==================== 渲染入口 ====================
  function render() {
    var html = ''
    if (state.tab === 'calc') html = viewCalc()
    else if (state.tab === 'stats') html = viewStats()
    else if (state.tab === 'history') html = viewHistory()
    else html = viewAbout()

    $view.innerHTML = html

    if ($tabs) {
      Array.prototype.forEach.call($tabs.querySelectorAll('.tab'), function (btn) {
        var active = btn.getAttribute('data-tab') === state.tab
        btn.classList.toggle('is-active', active)
        btn.setAttribute('aria-selected', active ? 'true' : 'false')
      })
    }
  }

  function renderAll() {
    render()
    renderModal()
  }

  // ==================== 弹窗：算法选择 ====================
  function viewMethodModal() {
    var current = L.getGPAMethod()
    var html = '<div class="modal-mask" data-act="close-modal"></div>'
    html += '<div class="modal modal-sm" role="dialog" aria-modal="true" aria-label="选择绩点算法">'
    html += '<div class="modal-head"><h2>选择绩点算法</h2><button class="modal-close" data-act="close-modal" aria-label="关闭">×</button></div>'
    html += '<div class="modal-body">'
    html += '<ul class="method-list">'
    L.getGPAMethods().forEach(function (m) {
      html += '<li>'
      html += '<button class="method-item' + (m.key === current ? ' is-active' : '') + '" data-act="pick-method" data-method="' + esc(m.key) + '">'
      html += '<span class="method-name">' + esc(m.name) + '</span>'
      html += '<span class="method-desc">' + esc(m.desc) + '</span>'
      html += (m.key === current ? '<span class="method-check">✓</span>' : '')
      html += '</button>'
      html += '</li>'
    })
    html += '</ul>'
    html += '</div>'
    html += '</div>'
    return html
  }

  // ==================== 弹窗：新增 / 编辑课程 ====================
  function viewCourseModal() {
    var d = state.draft
    var isGrade = d.scoreType === 'grade'
    var html = '<div class="modal-mask" data-act="close-modal"></div>'
    html += '<div class="modal" role="dialog" aria-modal="true" aria-label="课程信息">'
    html += '<div class="modal-head"><h2>' + (state.editingId ? '编辑课程' : '添加课程') + '</h2>'
    html += '<button class="modal-close" data-act="close-modal" aria-label="关闭">×</button></div>'
    html += '<div class="modal-body">'

    html += '<label class="field"><span class="field-label">课程名称</span>'
    html += '<input class="input" data-field="name" value="' + esc(d.name) + '" placeholder="例如：高等数学" maxlength="40"></label>'

    html += '<label class="field"><span class="field-label">学分</span>'
    html += '<input class="input" data-field="credits" type="number" min="0" step="0.5" value="' + esc(d.credits) + '" placeholder="例如：3"></label>'

    html += '<div class="field"><span class="field-label">成绩类型</span>'
    html += '<div class="seg">'
    html += '<button class="seg-btn' + (isGrade ? '' : ' is-active') + '" data-act="score-type" data-type="score">百分制</button>'
    html += '<button class="seg-btn' + (isGrade ? ' is-active' : '') + '" data-act="score-type" data-type="grade">等级制</button>'
    html += '</div></div>'

    if (isGrade) {
      html += '<label class="field"><span class="field-label">等级成绩</span>'
      html += '<select class="input" data-field="grade">'
      L.GRADES.forEach(function (g) {
        html += '<option value="' + esc(g) + '"' + (g === d.grade ? ' selected' : '') + '>' + esc(g) + '</option>'
      })
      html += '</select></label>'
    } else {
      html += '<label class="field"><span class="field-label">百分制成绩</span>'
      html += '<input class="input" data-field="score" type="number" min="0" max="100" step="1" value="' + esc(d.score) + '" placeholder="0 - 100"></label>'
    }

    html += '<label class="field"><span class="field-label">学期</span>'
    html += '<select class="input" data-field="semester">'
    var sems = L.SEMESTERS.slice()
    if (d.semester && sems.indexOf(d.semester) === -1) sems.unshift(d.semester)
    sems.forEach(function (s) {
      html += '<option value="' + esc(s) + '"' + (s === d.semester ? ' selected' : '') + '>' + esc(s) + '</option>'
    })
    html += '</select></label>'

    html += '<p class="form-error" id="form-error"></p>'
    html += '</div>'
    html += '<div class="modal-foot">'
    html += '<button class="btn" data-act="close-modal">取消</button>'
    html += '<button class="btn btn-primary" data-act="save-course">保存</button>'
    html += '</div>'
    html += '</div>'
    return html
  }

  // ==================== 弹窗：导入成绩 ====================
  function viewImportModal() {
    var isAuto = state.importTab === 'auto'
    var html = '<div class="modal-mask" data-act="close-modal"></div>'
    html += '<div class="modal" role="dialog" aria-modal="true" aria-label="导入成绩">'
    html += '<div class="modal-head"><h2>导入成绩</h2>'
    html += '<button class="modal-close" data-act="close-modal" aria-label="关闭">×</button></div>'

    html += '<div class="modal-body">'
    html += '<div class="seg seg-wide">'
    html += '<button class="seg-btn' + (isAuto ? ' is-active' : '') + '" data-act="import-tab" data-mode="auto">教务系统导入</button>'
    html += '<button class="seg-btn' + (isAuto ? '' : ' is-active') + '" data-act="import-tab" data-mode="paste">手动粘贴</button>'
    html += '</div>'

    if (isAuto) {
      html += '<label class="field"><span class="field-label">学号</span>'
      html += '<input class="input" data-field="username" value="' + esc(state.autoUsername) + '" placeholder="请输入教务系统学号" autocomplete="username"></label>'
      html += '<label class="field"><span class="field-label">密码</span>'
      html += '<input class="input" data-field="password" type="password" value="' + esc(state.autoPassword) + '" placeholder="请输入教务系统密码" autocomplete="current-password"></label>'
      html += '<label class="check"><input type="checkbox" data-field="remember"' + (state.rememberUsername ? ' checked' : '') + '> 记住学号（不保存密码）</label>'
      html += '<p class="hint">将通过本站服务端登录教务系统并抓取你的成绩，约需 10–30 秒。学号密码只用于本次请求，服务器不保存密码、不建立账号。</p>'
    } else {
      html += '<label class="field"><span class="field-label">成绩表格</span>'
      html += '<textarea class="input textarea" data-field="paste" rows="7" placeholder="在教务系统成绩页全选并复制表格，然后粘贴到这里（支持直接粘贴整张表格）">' + esc(state.pasteText) + '</textarea></label>'
      html += '<p class="hint">需要包含「课程名称」「成绩」「学分」三列；表格里如果有「开课学期」「课程性质」「绩点」会一并识别。</p>'
      if (state.parseError) html += '<p class="form-error is-show">' + esc(state.parseError) + '</p>'
      if (state.pastePreview) {
        html += '<div class="preview">'
        html += '<p class="preview-title">已解析到 <b>' + state.pastePreview.courses.length + '</b> 门课程</p>'
        html += '<ul class="preview-list">'
        state.pastePreview.courses.slice(0, 6).forEach(function (c) {
          html += '<li>' + esc(c.name) + ' · ' + fmtCredits(c.credits) + ' 学分 · ' + esc(scoreText(c)) + '</li>'
        })
        if (state.pastePreview.courses.length > 6) {
          html += '<li class="muted">…等共 ' + state.pastePreview.courses.length + ' 门</li>'
        }
        html += '</ul>'
        html += '<button class="btn btn-primary btn-block" data-act="confirm-paste">确认导入 ' + state.pastePreview.courses.length + ' 门课程</button>'
        html += '</div>'
      }
    }

    html += '<label class="check"><input type="checkbox" data-field="overwrite"' + (state.importOverwrite ? ' checked' : '') + '> 覆盖现有课程（取消勾选则追加并自动跳过同名课程）</label>'
    html += '<p class="status" id="import-status"></p>'
    html += '</div>'

    html += '<div class="modal-foot">'
    html += '<button class="btn" data-act="close-modal">取消</button>'
    if (isAuto) {
      html += '<button class="btn btn-primary" data-act="run-auto-import"' + (state.importing ? ' disabled' : '') + '>' + (state.importing ? '正在导入…' : '登录并导入') + '</button>'
    } else if (!state.pastePreview) {
      html += '<button class="btn btn-primary" data-act="parse-paste">解析成绩</button>'
    }
    html += '</div>'
    html += '</div>'
    return html
  }

  function renderModal() {
    if (!$modalRoot) return
    if (!state.modal) {
      $modalRoot.innerHTML = ''
      document.body.classList.remove('modal-open')
      return
    }
    document.body.classList.add('modal-open')
    if (state.modal === 'method') $modalRoot.innerHTML = viewMethodModal()
    else if (state.modal === 'course') $modalRoot.innerHTML = viewCourseModal()
    else $modalRoot.innerHTML = viewImportModal()
  }

  function closeModal() {
    state.modal = null
    state.parseError = ''
    renderModal()
  }

  // ==================== 课程操作 ====================
  function openCourseModal(id) {
    var drafts = { name: '', credits: '', score: '', grade: 'A', semester: L.SEMESTERS[0], scoreType: 'score' }
    state.editingId = null

    if (id) {
      var course = L.getCourses().filter(function (c) { return c.id === id })[0]
      if (!course) return
      state.editingId = id
      drafts.name = course.name || ''
      drafts.credits = course.credits === undefined ? '' : String(course.credits)
      drafts.semester = course.semester || L.SEMESTERS[0]
      if (course.grade && (course.score === undefined || course.score === '' || course.score === null)) {
        drafts.scoreType = 'grade'
        drafts.grade = course.grade
      } else {
        drafts.score = course.score === undefined || course.score === null ? '' : String(course.score)
      }
    }

    state.draft = drafts
    state.modal = 'course'
    renderModal()
  }

  function showFormError(msg) {
    var el = document.getElementById('form-error')
    if (!el) { toast(msg); return }
    el.textContent = msg
    el.classList.add('is-show')
  }

  function saveCourse() {
    var d = state.draft
    if (!d) return
    var name = String(d.name || '').trim()
    if (!name) return showFormError('请输入课程名称')

    var credits = Number(d.credits)
    if (!d.credits || isNaN(credits) || credits <= 0) return showFormError('请输入有效学分（大于 0）')

    var courses = L.getCourses()
    var original = state.editingId ? courses.filter(function (c) { return c.id === state.editingId })[0] : null

    var course = {
      id: state.editingId || L.generateId(),
      name: name,
      credits: credits,
      semester: d.semester || L.SEMESTERS[0],
      type: original && original.type ? original.type : ''
    }
    if (original && original.forceIncluded) course.forceIncluded = true
    if (original && original.forceExcluded) course.forceExcluded = true

    if (d.scoreType === 'grade') {
      course.grade = d.grade || 'A'
      course.gpa = L.gradeToGPA(course.grade) || 0
    } else {
      var score = Number(d.score)
      if (d.score === '' || isNaN(score) || score < 0 || score > 100) return showFormError('请输入 0–100 之间的成绩')
      course.score = score
      course.gpa = L.scoreToGPA(score)
    }

    if (original) {
      var idx = courses.findIndex(function (c) { return c.id === course.id })
      if (idx === -1) courses.push(course)
      else courses[idx] = course
    } else {
      courses.push(course)
    }

    L.saveCourses(courses, (original ? '编辑课程: ' : '添加课程: ') + course.name)
    L.saveHistory({ type: original ? 'edit' : 'add', course: course, time: new Date().toISOString() })

    closeModal()
    renderAll()
    toast(original ? '已保存修改' : '已添加课程')
  }

  function deleteCourse(id) {
    var course = L.getCourses().filter(function (c) { return c.id === id })[0]
    if (!course) return
    if (!confirm('确定删除课程「' + course.name + '」吗？删除后仍可用撤销恢复。')) return
    var courses = L.getCourses().filter(function (c) { return c.id !== id })
    L.saveCourses(courses, '删除课程: ' + course.name)
    renderAll()
    toast('已删除')
  }

  function excludeCourse(id) {
    var courses = L.getCourses()
    var idx = courses.findIndex(function (c) { return c.id === id })
    if (idx === -1) return
    var name = courses[idx].name
    courses[idx] = L.excludeCourse(courses[idx])
    L.saveCourses(courses, '排除课程: ' + name)
    renderAll()
    toast('已排除')
  }

  function includeCourse(id) {
    var courses = L.getCourses()
    var idx = courses.findIndex(function (c) { return c.id === id })
    if (idx === -1) return
    var name = courses[idx].name
    courses[idx] = L.includeCourse(courses[idx])
    L.saveCourses(courses, '加入课程: ' + name)
    renderAll()
    toast('已加入绩点计算')
  }

  function includeAllExcluded() {
    var vm = buildViewModel()
    if (!vm.excluded.length) return toast('没有已排除课程')
    if (!confirm('将 ' + vm.excluded.length + ' 门已排除课程全部加入绩点计算？')) return
    var courses = L.getCourses().map(function (c) {
      var isExcluded = L.isPublicElective(c) || L.shouldExcludeCourse(c.name) || c.forceExcluded
      return isExcluded ? L.includeCourse(c) : c
    })
    L.saveCourses(courses, '全部加入已排除课程')
    renderAll()
    toast('已全部加入')
  }

  function clearAll() {
    if (!L.getCourses().length) return toast('暂无数据')
    if (!confirm('确定清空所有课程数据吗？此操作可以撤销。')) return
    L.saveCourses([], '清空所有课程')
    renderAll()
    toast('已清空')
  }

  // ==================== 撤销 / 重做 / 快照 ====================
  function doUndo() {
    var desc = L.undo()
    renderAll()
    toast(desc ? '已撤销：' + desc : '没有可撤销的操作')
  }

  function doRedo() {
    var desc = L.redo()
    renderAll()
    toast(desc ? '已重做：' + desc : '没有可重做的操作')
  }

  function restoreSnapshot(index) {
    var snapshot = L.getSnapshots(15)[index]
    if (!snapshot) return
    if (snapshot.isCurrent) return toast('已经是当前状态')
    if (!confirm('恢复到「' + snapshot.description + '」？该时间点有 ' + (snapshot.courses || []).length + ' 门课程，当前数据会被替换（可撤销）。')) return
    L.restoreSnapshot(snapshot)
    renderAll()
    toast('已恢复')
  }

  function clearHistory() {
    if (!confirm('清空全部撤销记录？当前课程数据不会受影响。')) return
    L.saveCourses(L.getCourses(), '清空历史记录')
    renderAll()
    toast('已清空历史')
  }

  // ==================== 导入：接口 ====================
  function apiBase() {
    return location.protocol === 'file:' ? 'http://182.92.80.164:3000' : ''
  }

  function checkHealth() {
    return fetch(apiBase() + '/api/health', { cache: 'no-store' })
      .then(function (res) { return res.ok })
      .catch(function () { return false })
  }

  function fetchGrades(username, password) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    var timer = setTimeout(function () { if (controller) controller.abort() }, API_TIMEOUT)
    var options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: password })
    }
    if (controller) options.signal = controller.signal

    return fetch(apiBase() + '/api/login', options)
      .then(function (res) {
        return res.json().catch(function () { return null }).then(function (data) {
          if (res.status === 200 && data && data.success) return data
          var err = new Error((data && data.error) || ('请求失败（HTTP ' + res.status + '）'))
          if (data) {
            if (data.remainingAttempts !== undefined) err.remainingAttempts = data.remainingAttempts
            if (data.retryAfter !== undefined) err.retryAfter = data.retryAfter
            if (data.scope) err.scope = data.scope
            if (data.stage !== undefined) err.stage = data.stage
          }
          throw err
        })
      })
      .finally(function () { clearTimeout(timer) })
  }

  function setImportStatus(msg, kind) {
    var el = document.getElementById('import-status')
    if (!el) return
    el.textContent = msg
    el.className = 'status' + (kind ? ' is-' + kind : '')
  }

  function coursesFromApi(items) {
    var out = []
    ;(items || []).forEach(function (item) {
      if (!item || !item.name) return
      var course = {
        name: item.name,
        credits: Number(item.credits) || 0,
        semester: item.semester || L.UNKNOWN_SEMESTER,
        type: item.courseType || ''
      }
      var scoreNum = parseFloat(item.score)
      if (!isNaN(scoreNum) && scoreNum >= 0 && scoreNum <= 100) {
        course.score = scoreNum
        course.gpa = item.gpa ? parseFloat(item.gpa) : L.scoreToGPA(scoreNum)
      } else {
        var grade = L.normalizeGrade(item.score)
        if (!grade) return
        course.grade = grade
        course.gpa = L.gradeToGPA(grade)
      }
      out.push(course)
    })
    return out
  }

  // 合并导入：覆盖 或 追加（按课程名去重）
  function mergeCourses(list, overwrite) {
    var existing = overwrite ? [] : L.getCourses()
    var seen = {}
    existing.forEach(function (c) { seen[c.name] = true })

    var result = existing.slice()
    var added = 0
    list.forEach(function (c) {
      if (seen[c.name]) return
      seen[c.name] = true
      c.id = L.generateId()
      result.push(c)
      added++
    })

    if (added > 0) {
      L.saveCourses(result, (overwrite ? '重新导入' : '导入') + added + '门课程')
      L.saveHistory({
        type: 'import',
        course: { name: (overwrite ? '重新导入' : '手动导入') + added + '门课程' },
        time: new Date().toISOString()
      })
    }
    return added
  }

  function finishImport(added) {
    closeModal()
    state.tab = 'calc'
    renderAll()
    toast('成功导入 ' + added + ' 门课程')
  }

  function runAutoImport() {
    if (state.importing) return
    var username = String(state.autoUsername || '').trim()
    var password = String(state.autoPassword || '')

    if (!username) return setImportStatus('请输入学号', 'error')
    if (!password) return setImportStatus('请输入密码', 'error')

    state.importing = true
    renderModal()
    setImportStatus('正在检测成绩服务…')

    checkHealth().then(function (online) {
      if (!online) throw new Error('无法连接成绩服务，请稍后重试')
      setImportStatus('正在登录教务系统并抓取成绩，约需 10–30 秒…')
      return fetchGrades(username, password)
    }).then(function (data) {
      var list = coursesFromApi(data.courses || [])
      if (!list.length) throw new Error('未查询到成绩数据')
      var added = mergeCourses(list, state.importOverwrite)
      if (!added) throw new Error('这些课程都已经存在，没有新增课程')
      state.importing = false
      state.autoPassword = ''
      if (state.rememberUsername) L.storage.set(L.KEYS.username, username)
      else L.storage.remove(L.KEYS.username)
      finishImport(added)
    }).catch(function (err) {
      state.importing = false
      renderModal()
      var msg = err && err.name === 'AbortError' ? '请求超时，教务系统响应较慢，请稍后再试' : (err && err.message) || '导入失败'
      if (err && err.remainingAttempts !== undefined) {
        msg += '（还可尝试 ' + err.remainingAttempts + ' 次，连续失败 5 次将暂时禁止登入）'
      }
      setImportStatus(msg, 'error')
    })
  }

  // ==================== 导入：剪贴板表格 ====================
  function parseHTMLTable(html) {
    try {
      var doc = new DOMParser().parseFromString(html, 'text/html')
      var table = doc.querySelector('table')
      if (!table) return null
      var trs = table.querySelectorAll('tr')
      var grid = []
      for (var i = 0; i < trs.length; i++) {
        var cells = trs[i].querySelectorAll('td,th')
        if (!cells.length) continue
        var vals = []
        for (var j = 0; j < cells.length; j++) vals.push((cells[j].textContent || '').replace(/\s+/g, ' ').trim())
        grid.push(vals)
      }
      if (!grid.length) return null

      // 找到真正的表头行（含「课程名称」），找不到就把第一行当表头
      var headerIndex = -1
      for (var k = 0; k < grid.length; k++) {
        if (grid[k].some(function (v) { return v.indexOf('课程名称') !== -1 })) { headerIndex = k; break }
      }
      if (headerIndex === -1) headerIndex = 0

      return { headers: grid[headerIndex], rows: grid.slice(headerIndex + 1) }
    } catch (e) {
      return null
    }
  }

  function parsePaste() {
    state.parseError = ''
    state.pastePreview = null

    var result
    if (state.pasteRows) {
      result = L.mapRows(state.pasteRows.headers, state.pasteRows.rows)
    } else {
      var text = String(state.pasteText || '')
      if (!text.trim()) {
        state.parseError = '请先粘贴成绩表格内容'
        return renderModal()
      }
      if (text.indexOf('请评教') !== -1) {
        state.parseError = '检测到尚未完成评教，请先到教务系统完成「学生评教」后再查询并复制成绩。'
        return renderModal()
      }
      result = L.parseScoreText(text)
    }

    if (!result.ok) {
      state.parseError = result.error
      return renderModal()
    }
    state.pastePreview = result
    renderModal()
  }

  function confirmPaste() {
    if (!state.pastePreview) return
    var added = mergeCourses(state.pastePreview.courses, state.importOverwrite)
    if (!added) {
      state.parseError = '这些课程都已经存在，没有新增课程'
      return renderModal()
    }
    state.pastePreview = null
    state.pasteText = ''
    state.pasteRows = null
    finishImport(added)
  }

  // ==================== 事件 ====================
  var ACTIONS = {
    tab: function (el) { state.tab = el.getAttribute('data-tab'); render() },
    'open-add': function () { openCourseModal(null) },
    'open-method': function () { state.modal = 'method'; renderModal() },
    'pick-method': function (el) {
      L.setGPAMethod(el.getAttribute('data-method'))
      closeModal()
      renderAll()
      toast('已切换为 ' + L.getGPAMethod())
    },
    'close-modal': function () { closeModal() },
    semester: function (el) { state.filterSemester = el.getAttribute('data-sem'); render() },
    'toggle-excluded': function () { state.showExcluded = !state.showExcluded; render() },
    edit: function (el) { openCourseModal(el.getAttribute('data-id')) },
    delete: function (el) { deleteCourse(el.getAttribute('data-id')) },
    exclude: function (el) { excludeCourse(el.getAttribute('data-id')) },
    include: function (el) { includeCourse(el.getAttribute('data-id')) },
    'include-all': function () { includeAllExcluded() },
    'clear-all': function () { clearAll() },
    undo: function () { doUndo() },
    redo: function () { doRedo() },
    'clear-history': function () { clearHistory() },
    restore: function (el) { restoreSnapshot(Number(el.getAttribute('data-index'))) },
    'open-import': function () {
      state.modal = 'import'
      state.parseError = ''
      state.pastePreview = null
      renderModal()
    },
    'import-tab': function (el) {
      state.importTab = el.getAttribute('data-mode')
      state.parseError = ''
      renderModal()
    },
    'score-type': function (el) {
      state.draft.scoreType = el.getAttribute('data-type')
      renderModal()
    },
    'save-course': function () { saveCourse() },
    'run-auto-import': function () { runAutoImport() },
    'parse-paste': function () { parsePaste() },
    'confirm-paste': function () { confirmPaste() }
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null
    if (!el) return
    var act = el.getAttribute('data-act')
    var handler = ACTIONS[act]
    if (!handler) return
    if (el.tagName === 'A') e.preventDefault()
    handler(el)
  })

  document.addEventListener('input', function (e) {
    var el = e.target
    if (!el || !el.getAttribute) return
    var field = el.getAttribute('data-field')
    if (!field) return
    var value = el.value
    if (field === 'username') state.autoUsername = value
    else if (field === 'password') state.autoPassword = value
    else if (field === 'paste') { state.pasteText = value; state.pasteRows = null; state.pastePreview = null }
    else if (field === 'remember') state.rememberUsername = el.checked
    else if (field === 'overwrite') state.importOverwrite = el.checked
    else if (state.draft) state.draft[field] = value
  })

  document.addEventListener('change', function (e) {
    var el = e.target
    if (!el || !el.getAttribute) return
    var field = el.getAttribute('data-field')
    if (!field) return
    if (field === 'remember') state.rememberUsername = el.checked
    else if (field === 'overwrite') state.importOverwrite = el.checked
    else if (state.draft) state.draft[field] = el.value
  })

  // 粘贴整张表格时优先解析 HTML，比纯文本更稳
  document.addEventListener('paste', function (e) {
    var el = e.target
    if (!el || el.getAttribute('data-field') !== 'paste') return
    var cd = e.clipboardData || window.clipboardData
    if (!cd) return
    var html = ''
    try { html = cd.getData('text/html') } catch (err) { html = '' }
    if (!html || html.indexOf('<table') === -1) return
    var parsed = parseHTMLTable(html)
    if (!parsed) return
    e.preventDefault()
    state.pasteRows = parsed
    state.pastePreview = null
    state.parseError = ''
    state.pasteText = parsed.rows.map(function (r) { return r.join(' | ') }).join('\n')
    renderModal()
    var status = document.getElementById('import-status')
    if (status) {
      status.textContent = '已识别到剪贴板中的表格（' + parsed.rows.length + ' 行），点击「解析成绩」继续'
      status.className = 'status is-ok'
    }
  })

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.modal) closeModal()
  })

  // ==================== 启动 ====================
  L.initGPAMethod()
  var savedUsername = L.storage.get(L.KEYS.username)
  if (savedUsername) {
    state.autoUsername = savedUsername
    state.rememberUsername = true
  }
  render()
})()
