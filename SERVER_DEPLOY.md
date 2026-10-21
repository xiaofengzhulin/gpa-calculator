# 服务器部署指南

## 📋 服务器信息

- **服务器IP**: `182.92.80.164`
- **服务端口**: `3000`
- **服务地址**: `http://182.92.80.164:3000`（仅调试/反代上游使用）
- **正式域名**: `https://xiaofengzhulin.xyz`（已备案，小程序只应使用这个 HTTPS 地址）
- **工信部备案号**: `蒙ICP备2026007686号-2`

> 正式链路：小程序 → `https://xiaofengzhulin.xyz/api/*` → Nginx(443) → `127.0.0.1:3000`。
> 3000 端口**不要**在阿里云安全组对公网放行。站点部署见 [`deploy/README.md`](deploy/README.md)。

## 🚀 部署步骤

### 1. 上传服务器文件

将以下文件上传到服务器：

```
server/
└── server.js    # 代理服务器（零依赖）
```

可以使用以下方式上传：

```bash
# 使用 scp
scp server.js root@182.92.80.164:/root/gpa-server/

# 或使用 rsync
rsync -avz server.js root@182.92.80.164:/root/gpa-server/
```

### 2. SSH 登录服务器

```bash
ssh root@182.92.80.164
```

### 3. 安装 Node.js（如果未安装）

```bash
# CentOS/RHEL
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs

# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证安装
node -v
npm -v
```

### 4. 启动服务

#### 方式一：直接启动（测试用）

```bash
cd /root/gpa-server
node server.js
```

#### 方式二：使用 PM2 守护进程（推荐）

```bash
# 安装 PM2
npm install -g pm2

# 启动服务
cd /root/gpa-server
pm2 start server.js --name gpa-server

# 设置开机自启
pm2 startup
pm2 save

# 常用命令
pm2 status          # 查看状态
pm2 logs gpa-server # 查看日志
pm2 restart gpa-server # 重启
pm2 stop gpa-server    # 停止
```

#### 方式三：使用 systemd 服务（生产推荐）

创建服务文件 `/etc/systemd/system/gpa-server.service`：

```ini
[Unit]
Description=GPA Calculator Proxy Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/gpa-server
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

启用并启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable gpa-server
sudo systemctl start gpa-server
sudo systemctl status gpa-server
```

### 5. 配置防火墙

确保端口 3000 对外开放：

```bash
# CentOS/RHEL (firewalld)
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --reload

# Ubuntu/Debian (ufw)
sudo ufw allow 3000/tcp
sudo ufw reload

# 或使用 iptables
sudo iptables -A INPUT -p tcp --dport 3000 -j ACCEPT
```

### 6. 配置安全组（阿里云）

登录阿里云控制台：

1. 进入 **云服务器 ECS** → **实例** → 找到实例
2. 点击 **安全组** → **配置规则**
3. 添加入方向规则：
   - **协议类型**: 自定义 TCP
   - **端口范围**: `80/80`、`443/443`
   - **授权对象**: `0.0.0.0/0`

> ⚠️ **不要对公网放行 3000 端口**。正式链路是 `443 → Nginx → 127.0.0.1:3000`，
> 3000 暴露在公网等于把「教务系统登录代理」直接开放给所有人。
> 本机调试需要直连时，用 SSH 隧道：`ssh -L 3000:127.0.0.1:3000 root@182.92.80.164`。

## 🔒 安全建议

### 接口限流与登录锁定（已内置）

`server/server.js` 内置两层防护：**按 IP 的请求频率限制** + **按学号的登录失败锁定**。

#### 一、IP 频率限制

| 接口 | 默认额度 | 环境变量 |
|---|---|---|
| `POST /api/login` | **20 次/分钟/IP** | `RATE_LIMIT_LOGIN_IP` |
| 其它接口（含 `/api/health`） | 60 次/分钟/IP | `RATE_LIMIT_API` |
| 窗口长度 | 60 秒 | `RATE_LIMIT_WINDOW` |

#### 二、登录失败锁定（按学号）

```
初始状态
   │ 连续失败 5 次
   ▼
禁止登入 1 分钟  ──解禁后再次连续失败 5 次──▶  禁止登入 5 分钟
                                                     │ 之后每失败 5 次
                                                     ▼
                                              维持 5 分钟
10 分钟内没有新的失败 → 回到初始状态
登录成功             → 立即回到初始状态
```

| 参数 | 默认值 | 环境变量 |
|---|---|---|
| 触发锁定的失败次数 | 5 次 | 固定（改代码） |
| 锁定档位 | 1 分钟 → 5 分钟 | `LOGIN_LOCK_SECONDS`（逗号分隔，单位秒） |
| 闲置重置 | 10 分钟 | `LOGIN_LOCK_RESET_SECONDS` |

**只有「账号密码错误」计入失败次数**。超时、教务系统异常、未评教等其他错误不计入，避免网络抖动把用户锁死。

#### 三、返回内容

密码错误（还没到 5 次）返回 `401`，带剩余次数：

```json
{ "success": false, "error": "用户名或密码错误，请检查后重试", "remainingAttempts": 3, "stage": 0 }
```

触发锁定 / 锁定期间访问返回 `429`（`scope=login-lock`），带解锁倒计时：

```json
{ "success": false, "error": "登录失败次数过多，已禁止登入 1 分钟", "retryAfter": 58, "scope": "login-lock", "stage": 1 }
```

IP 频率超限也返回 `429`，但 `scope` 为 `ip`：

```json
{ "success": false, "error": "请求过于频繁，请 37 秒后再试", "retryAfter": 37, "scope": "ip" }
```

前端（小程序 / 网页版）会把 `error` 展示给用户；`remainingAttempts` 会追加成「（还可尝试 N 次）」的提示。

#### 四、调整参数

```bash
# 例：改成 3 次触发、锁定 2 分钟 / 10 分钟、闲置 30 分钟重置（PM2）
LOGIN_LOCK_SECONDS=120,600 LOGIN_LOCK_RESET_SECONDS=1800 pm2 restart gpa-server --update-env

# 或写进 ecosystem 配置文件 / systemd 的 Environment=
```

#### 五、其它细节

- 学号在内存里只存 SHA-256 前 16 位摘要，日志也做了脱敏（`2023****5678`）。
- 只有来自本机 / 内网的连接（也就是自己的 Nginx）才信任 `X-Forwarded-For` / `X-Real-IP`，公网直连无法伪造绕过。
- 请求体上限 16KB（`MAX_BODY_BYTES`），超大 body 返回 `413`。
- 计数保存在内存中，进程重启后清零；若将来做多实例部署，需换成 Redis 之类的共享存储。

### HTTPS 配置（正式发布必须）

微信小程序正式版要求使用 HTTPS 合法域名。推荐使用 Nginx 反向代理 + Let's Encrypt：

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 访问限制

可以在 `server.js` 中添加简单的访问控制：

```javascript
// 在 server 变量声明后添加
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://your-domain.com'
]

// 在 HTTP 服务器处理中添加
server.on('request', (req, res) => {
  const origin = req.headers.origin
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }
  // ... 原有逻辑
})
```

## 🧪 测试服务

### 1. 本地测试

```bash
# 健康检查
curl http://182.92.80.164:3000/api/health

# 应返回：
# {"status":"ok","time":"2024-XX-XXTXX:XX:XX.XXXZ"}
```

### 2. 小程序测试

在微信开发者工具中：

1. 打开项目
2. 点击「详情」→「本地设置」
3. 确保 **「不校验合法域名」** 已勾选
4. 运行小程序，尝试登录功能

## ⚠️ 常见问题

### Q: 连接超时

```bash
# 检查服务是否运行
pm2 status
# 或
systemctl status gpa-server

# 检查端口是否监听
netstat -tlnp | grep 3000
# 或
ss -tlnp | grep 3000

# 检查防火墙
sudo firewall-cmd --list-all
```

### Q: 小程序提示网络错误

1. 确认服务器地址正确：`http://182.92.80.164:3000`
2. 确认已关闭域名校验（开发阶段）
3. 检查服务器安全组是否放行 3000 端口

### Q: 阿里云服务器需要备案吗？

- 使用 IP 地址直接访问：**不需要备案**
- 使用域名访问：**需要备案**
- 小程序正式版必须使用域名，建议提前备案

## 📊 监控

使用 PM2 监控：

```bash
# 实时监控
pm2 monit

# 日志查看
pm2 logs gpa-server --lines 100
```

## 🔄 更新服务

```bash
# 上传新版本
scp server.js root@182.92.80.164:/root/gpa-server/

# 重启服务
pm2 restart gpa-server
# 或
sudo systemctl restart gpa-server
```

---

**注意**: 当前使用 HTTP 协议，仅适用于开发和测试阶段。正式发布前必须配置 HTTPS。
