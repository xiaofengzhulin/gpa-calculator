# 上线部署清单（xiaofengzhulin.xyz → 182.92.80.164）

> 目标：让公安备案审核人员在任意时间都能访问 `https://xiaofengzhulin.xyz` 并看到网站内容。
> 公安备案「网站访问地址」一栏就填这个地址；审核期间网站必须一直可访问，否则会被退回。

## 0. 前置检查

| 项目 | 值 |
|---|---|
| 域名 | `xiaofengzhulin.xyz`（阿里云注册） |
| 服务器 | 阿里云 ECS `182.92.80.164` |
| 工信部备案号 | 蒙ICP备2026007686号-2（已通过） |
| 后端服务 | `server/server.js`，监听 3000 端口 |

## 🚀 一键部署（推荐）

在仓库根目录的 PowerShell 里执行：

```powershell
# 密码登录（按提示输入 admin 的密码；admin 需要免密 sudo）
powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1

# 或用密钥登录
powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -KeyPath C:\path\to\key

# 只看会做什么、不连服务器
powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -DryRun
```

> 脚本以普通用户 `admin` 登录（不是 root）：安装包解到 `/tmp/gpa-deploy`，真正动系统文件的那一步用 `sudo -n` 提权。
> 如果提示「admin 没有免密 sudo 权限」，先在服务器上给 admin 配好 NOPASSWD 再运行。

脚本会：打包 → 上传 → 在服务器上执行 [`deploy_server.py`](deploy_server.py)，后者依次完成

1. 备份现有 Nginx 配置与后端代码到 `/root/gpa-deploy-backup-<时间戳>/`
2. 部署 `index.html / style.css / gpa-core.js / app.js` 到 `/var/www/xiaofengzhulin`
3. 用新版 `server.js`（含限流 + 登录失败锁定）替换正在运行的后端，并重启
4. **自动探测服务器上已有的 HTTPS 证书路径**，据此重写 Nginx 配置
5. `nginx -t` 校验，失败自动回滚；成功则 reload
6. 自检首页 / 静态资源 / `/api/health` / HTTP 跳转 / 备案号展示

> `deploy_server.py` 可单独自测：`python3 deploy_server.py --self-test`（不碰系统文件）。
> 下面的 1~9 步是同一件事的手工版本，脚本失败时可按它逐条排查。



## 1. 域名解析

阿里云 → 云解析 DNS → `xiaofengzhulin.xyz` → 添加记录：

| 记录类型 | 主机记录 | 记录值 |
|---|---|---|
| A | `@` | `182.92.80.164` |
| A | `www` | `182.92.80.164` |

验证（本地执行）：

```bash
nslookup xiaofengzhulin.xyz
```

## 2. 申请 HTTPS 证书（二选一）

**方式 A：阿里云免费证书（推荐，最稳）**

1. 阿里云控制台 → 数字证书管理服务 → 免费证书 → 创建证书，绑定 `xiaofengzhulin.xyz` 和 `www.xiaofengzhulin.xyz`；
2. 按提示完成 DNS 校验，签发后下载 **Nginx 格式**；
3. 上传到服务器 `/etc/nginx/cert/`，重命名为：
   - `/etc/nginx/cert/xiaofengzhulin.xyz.pem`
   - `/etc/nginx/cert/xiaofengzhulin.xyz.key`

**方式 B：Let's Encrypt（certbot，自动续期）**

```bash
sudo apt-get install -y certbot python3-certbot-nginx   # Debian/Ubuntu
sudo certbot --nginx -d xiaofengzhulin.xyz -d www.xiaofengzhulin.xyz
```

> 阿里云免费证书有效期较短，到期前记得在控制台重新签发并替换文件（或在阿里云开启自动续期提醒）。

## 3. 部署网页版（4 个静态文件）

网站是一个纯静态单页应用，无需构建、无外部 CDN，直接丢到 `/var/www/xiaofengzhulin/` 即可：

| 文件 | 作用 |
|---|---|
| `index.html` | 页面骨架 + 备案信息页脚 |
| `style.css` | 样式（移动优先） |
| `gpa-core.js` | GPA 算法与数据层（与小程序 `utils/util.js` 同口径） |
| `app.js` | 页面交互（课程管理 / 导入 / 统计 / 历史） |

```bash
# 一键上传整个站点目录
scp -r deploy/site/* root@182.92.80.164:/var/www/xiaofengzhulin/

# 服务器上确保目录与权限
ssh root@182.92.80.164 "mkdir -p /var/www/xiaofengzhulin && chown -R www-data:www-data /var/www/xiaofengzhulin"
```

### 本地预览（可选，改样式时用）

```bash
node tests/serve-site.js
# 打开 http://127.0.0.1:8080
```

> 用 `file://` 直接打开 `index.html` 也能看界面，但「教务系统导入」需要同源接口，只能通过域名/本地服务访问。

## 4. 部署代理服务

```bash
scp server/server.js root@182.92.80.164:/root/gpa-server/server.js
ssh root@182.92.80.164 "cd /root/gpa-server && (pm2 restart gpa-server || pm2 start server.js --name gpa-server)"
```

细节见根目录 [`SERVER_DEPLOY.md`](../SERVER_DEPLOY.md)。

> 该服务内置两层防护：`/api/login` **单 IP 20 次/分钟** 的频率限制，以及 **单学号连续失败 5 次 → 禁止登入 1 分钟 → 再失败 5 次 → 5 分钟 → 10 分钟无新失败回到初始** 的失败锁定。
> 可用 `RATE_LIMIT_LOGIN_IP` / `LOGIN_LOCK_SECONDS` / `LOGIN_LOCK_RESET_SECONDS` 调整，详见 `SERVER_DEPLOY.md` 的「接口限流与登录锁定」。

## 5. 配置 Nginx

```bash
# 安装（如未安装）
sudo apt-get install -y nginx        # Debian/Ubuntu
# sudo yum install -y nginx          # CentOS/RHEL

sudo cp deploy/nginx.conf /etc/nginx/conf.d/xiaofengzhulin.conf
sudo nginx -t
sudo systemctl reload nginx
```

## 6. 放行端口（阿里云安全组 + 系统防火墙）

- 阿里云控制台 → ECS → 安全组 → 入方向添加：`80/80`、`443/443`，授权对象 `0.0.0.0/0`
- 系统防火墙：

```bash
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw reload   # Ubuntu
# sudo firewall-cmd --permanent --add-service=http --add-service=https && sudo firewall-cmd --reload
```

> ⚠️ 3000 端口不要在安全组对公网放行，只走 Nginx 反代即可。

## 7. 验证（提交公安备案前必须全绿）

```bash
curl -I https://xiaofengzhulin.xyz            # 200，且能看到 ICP 备案号
curl https://xiaofengzhulin.xyz/api/health    # {"status":"ok", ...}
curl -I http://xiaofengzhulin.xyz             # 301 -> https
```

验证限流确实生效（空 body 连发 21 次，前 20 次是 400，第 21 次被 IP 维度拦下）：

```bash
for i in $(seq 1 21); do
  curl -s -o /dev/null -w "%{http_code} " \
    -X POST https://xiaofengzhulin.xyz/api/login \
    -H 'Content-Type: application/json' -d ''
done; echo
# 期望输出：400 ×20 之后跟一个 429
```

> 学号维度的 5 次/分钟需要真实学号才会触发，用「连点登录 6 次」验证即可，
> 或直接跑 `node tests/rate-limit.test.js`（本地会自动起服务和桩接口）。

浏览器再打开一次 `https://xiaofengzhulin.xyz`，确认：

- [ ] 页面能打开、标题是「yjt燕理绩点计算通」
- [ ] 页脚能看到「蒙ICP备2026007686号-2」
- [ ] 小锁图标正常，无证书告警
- [ ] 手机 4G（关 WiFi）也能打开——审核人员不一定在你这台网络环境里
- [ ] 连点「导入成绩 → 登录并导入」6 次，第 6 次提示「请求过于频繁，请 X 秒后再试」

## 8. 提交公安备案时对应填什么

| 备案表单字段 | 填写内容 |
|---|---|
| 网站访问地址 | `https://xiaofengzhulin.xyz` |
| 主域名 | `xiaofengzhulin.xyz` |
| IP | `182.92.80.164-182.92.80.164` |
| 域名证书 | 阿里云域名控制台 → 域名列表 → 管理 → 域名证书下载 |
| 域名证书有效期 | 证书上的注册日期 → 到期日期 |

## 9. 备案通过后（30 日内必须完成）

1. 把 `deploy/site/index.html` 页脚的「蒙公网安备（公安备案通过后替换）」改成真实编号，并更新链接：

   ```html
   <a href="https://beian.mps.gov.cn/#/query/webSearch?code=你的备案编号" target="_blank" rel="noreferrer">蒙公网安备150104XXXXXXXX号</a>
   ```

2. 重新上传 `index.html`，刷新页面确认展示正确。
3. 小程序侧同样要在显著位置展示备案号（「关于」页），且小程序本身需另行办理 **新增小程序** 的公安备案（数据码不覆盖小程序）。
