<#
.SYNOPSIS
    一键部署 GPA 绩点计算器到阿里云 ECS（Windows 侧执行）

.DESCRIPTION
    负责：打包 → 上传 → 在服务器上执行 deploy_server.py → 打印结果。
    服务器端会：备份现有配置、部署静态站点、更新后端 server.js、
                自动探测证书路径重写 Nginx 配置、校验失败自动回滚、重启并自检。

.PARAMETER Server
    服务器公网 IP，默认 182.92.80.164

.PARAMETER User
    SSH 用户名，默认 admin（该账号需具备免密 sudo 权限；安装步骤内部用 sudo -n 执行）

.PARAMETER KeyPath
    私钥路径（.pem / id_ed25519）。不填则使用密码登录，运行时按提示输入。

.PARAMETER DryRun
    只打包、打印将执行的命令，不连服务器。

.EXAMPLE
    .\deploy\deploy.ps1
    .\deploy\deploy.ps1 -KeyPath C:\Users\xiaof\.ssh\dsh-deploy-gpa
#>
param(
    [string]$Server = '182.92.80.164',
    [string]$User = 'admin',
    [string]$KeyPath = '',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "  [!]  $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "  [X]  $msg" -ForegroundColor Red; exit 1 }

$repoRoot = Split-Path -Parent $PSScriptRoot
$siteDir  = Join-Path $repoRoot 'deploy\site'
$bundle   = Join-Path $env:TEMP 'gpa-deploy.tar.gz'
$stage    = Join-Path $env:TEMP ('gpa-deploy-stage-' + [guid]::NewGuid().ToString('N').Substring(0, 8))

# ============================================================
Step '1. 检查本地工具与文件'
# ============================================================
foreach ($tool in @('tar', 'scp', 'ssh')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        Fail "缺少命令：$tool（请启用 Windows 可选功能「OpenSSH 客户端」）"
    }
}
Ok 'tar / scp / ssh 均可用'

$required = @{
    (Join-Path $PSScriptRoot 'deploy_server.py') = '服务器端安装器'
    (Join-Path $PSScriptRoot 'nginx.conf')       = 'Nginx 配置模板'
    (Join-Path $repoRoot 'server\server.js')     = '后端服务'
    (Join-Path $siteDir 'index.html')            = '网页首页'
    (Join-Path $siteDir 'style.css')             = '网页样式'
    (Join-Path $siteDir 'gpa-core.js')           = '网页算法'
    (Join-Path $siteDir 'app.js')                = '网页逻辑'
}
foreach ($f in $required.Keys) {
    if (-not (Test-Path $f)) { Fail "缺少文件：$f（$($required[$f])）" }
}
Ok '部署文件齐全（站点 4 个 + 后端 + Nginx 模板 + 安装器）'

# ============================================================
Step '2. 打包'
# ============================================================
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $stage 'site') -Force | Out-Null

Copy-Item (Join-Path $PSScriptRoot 'deploy_server.py') $stage
Copy-Item (Join-Path $PSScriptRoot 'nginx.conf') $stage
Copy-Item (Join-Path $repoRoot 'server\server.js') $stage
Copy-Item (Join-Path $siteDir '*') (Join-Path $stage 'site')

if (Test-Path $bundle) { Remove-Item $bundle -Force }
& tar -czf $bundle -C $stage .
if ($LASTEXITCODE -ne 0) { Fail '打包失败' }
Ok ("已打包：{0}（{1:N1} KB）" -f $bundle, ((Get-Item $bundle).Length / 1KB))

if (-not $DryRun) { Remove-Item $stage -Recurse -Force }

# ============================================================
Step '3. 上传并在服务器上执行'
# ============================================================
$sshArgs = @('-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15')
if ($KeyPath) {
    if (-not (Test-Path $KeyPath)) { Fail "私钥不存在：$KeyPath" }
    $sshArgs += @('-i', $KeyPath)
    Ok "使用密钥认证：$KeyPath"
} else {
    Warn '未指定 -KeyPath，将使用密码登录（按提示输入密码）'
}

$remoteCmd = @'
set -e
command -v python3 >/dev/null 2>&1 || { echo "[X] 服务器缺少 python3"; exit 3; }
# admin 是普通用户：解包放在 /tmp，安装步骤用免密 sudo 提权执行
sudo -n true 2>/dev/null || { echo "[X] admin 没有免密 sudo 权限，请先配置 NOPASSWD"; exit 4; }
rm -rf /tmp/gpa-deploy && mkdir -p /tmp/gpa-deploy
tar -xzf /tmp/gpa-deploy.tar.gz -C /tmp/gpa-deploy
cd /tmp/gpa-deploy && sudo -n python3 deploy_server.py
'@

if ($DryRun) {
    Warn 'DryRun 模式，不连接服务器。将执行：'
    Write-Host ('  scp {0} "{1}" {2}@{3}:/tmp/gpa-deploy.tar.gz' -f ($sshArgs -join ' '), $bundle, $User, $Server)
    Write-Host ('  ssh {0} {1}@{2} "<远程脚本>"' -f ($sshArgs -join ' '), $User, $Server)
    Write-Host "`n  远程脚本内容："
    $remoteCmd -split "`n" | ForEach-Object { Write-Host "    $_" }
    Write-Host "`n  包内容："
    & tar -tzf $bundle | ForEach-Object { Write-Host "    $_" }
    exit 0
}

Write-Host "`n上传中（如提示密码，请输入 $User@$Server 的密码）..." -ForegroundColor DarkGray
& scp @sshArgs $bundle "${User}@${Server}:/tmp/gpa-deploy.tar.gz"
if ($LASTEXITCODE -ne 0) { Fail '上传失败（检查网络、IP、密码或密钥）' }
Ok '上传完成'

Write-Host "`n服务器端执行中（备份 -> 站点 -> 后端 -> Nginx -> 重启 -> 自检）...`n" -ForegroundColor DarkGray
& ssh @sshArgs "${User}@${Server}" $remoteCmd
$code = $LASTEXITCODE

# ============================================================
Step '4. 结果'
# ============================================================
if ($code -ne 0) {
    Fail "服务器端返回 $code，请查看上面输出；回滚命令已打印在末尾"
}
Ok '部署脚本执行完成'

Write-Host @"

站点已上线：https://xiaofengzhulin.xyz

还需要你在阿里云控制台手动做两件事：
  1. 关闭 3000 端口入方向规则（它现在对整个公网开放，只应通过 Nginx 反代访问）
     ECS -> 安全组 -> 入方向 -> 删除 3000/3000 那条规则
  2. 用手机 4G（关掉 WiFi）打开 https://xiaofengzhulin.xyz 复验一次
     备案审核人员不一定在与你相同的网络环境里访问

如果页面异常，回滚（在服务器上执行，需要 sudo）：
  sudo bash -c 'cp -a /root/gpa-deploy-backup-*/. / 2>/dev/null; nginx -t && systemctl reload nginx'

"@ -ForegroundColor Cyan
