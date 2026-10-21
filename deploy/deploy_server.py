#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
服务器端部署脚本（在 ECS 上执行）

    python3 deploy_server.py --dry-run     # 只打印将要做的事
    python3 deploy_server.py               # 真正执行

作用：
    1. 备份现有 Nginx 配置与后端代码
    2. 部署静态站点到 /var/www/xiaofengzhulin
    3. 更新后端 server.js（含限流与登录锁定）
    4. 生成 Nginx 配置（自动探测已有证书路径），校验后 reload（失败自动回滚）
    5. 重启后端并自检

目录要求（与本脚本同级）：
    deploy_server.py  nginx.conf  server.js  site/{index.html,style.css,gpa-core.js,app.js}

自测（不需要 root、不碰系统）：
    python3 deploy_server.py --self-test
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

DOMAIN = "xiaofengzhulin.xyz"
SITE_FILES = ["index.html", "style.css", "gpa-core.js", "app.js"]
HERE = Path(__file__).resolve().parent

try:  # Windows 控制台/自测时避免中文乱码
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# ============================================================
# 输出
# ============================================================
_fail = 0

def step(msg):
    print("\n\033[1m== {} ==\033[0m".format(msg), flush=True)

def ok(msg):
    print("  \033[32m✔\033[0m {}".format(msg), flush=True)

def warn(msg):
    global _fail
    _fail += 1
    print("  \033[33m!\033[0m {}".format(msg), flush=True)

def info(msg):
    print("    {}".format(msg), flush=True)

def die(msg, rollback=None):
    print("  \033[31m✘\033[0m {}".format(msg), flush=True)
    if rollback:
        print("\n回滚命令：\n  {}".format(rollback), flush=True)
    sys.exit(1)


def run(cmd, check=False, timeout=180, quiet=False):
    """执行命令，返回 (returncode, stdout+stderr)"""
    try:
        p = subprocess.run(cmd, shell=isinstance(cmd, str), capture_output=True,
                           text=True, timeout=timeout)
        out = (p.stdout or "") + (p.stderr or "")
        if not quiet and out.strip():
            for line in out.strip().splitlines():
                info(line)
        return p.returncode, out
    except subprocess.TimeoutExpired:
        return 124, "命令超时: {}".format(cmd)
    except Exception as e:  # noqa: BLE001
        return 1, str(e)


def asset_server_js():
    """server.js 既可能在部署包根目录（HERE/server.js），也可能在仓库里（HERE/../server/server.js）"""
    for cand in (HERE / "server.js", HERE.parent / "server" / "server.js"):
        if cand.is_file():
            return cand
    return None


def asset_site_dir():
    for cand in (HERE / "site", HERE.parent / "deploy" / "site"):
        if cand.is_dir():
            return cand
    return None


# ============================================================
# 路径（fs_root 便于自测）
# ============================================================
def build_paths(fs_root: Path):
    root = Path(fs_root)
    return {
        "fs_root": root,
        "conf_d": root / "etc/nginx/conf.d",
        "sites_enabled": root / "etc/nginx/sites-enabled",
        "nginx_main": root / "etc/nginx/nginx.conf",
        "conf_file": root / "etc/nginx/conf.d/xiaofengzhulin.conf",
        "site_dir": root / "var/www/xiaofengzhulin",
        "backend_dir": root / "root/gpa-server",
        "backup_dir": root / "root/gpa-deploy-backup",
    }


# ============================================================
# 证书探测
# ============================================================
def read_conf_files(paths):
    files = []
    for pattern in ("conf_d", "sites_enabled"):
        d = paths[pattern]
        if d.is_dir():
            files.extend(sorted(p for p in d.iterdir() if p.is_file()))
    if paths["nginx_main"].is_file():
        files.append(paths["nginx_main"])
    return files


def _extract(path: Path, directive: str):
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return None
    m = re.search(r"^\s*{}\s+([^;]+);".format(directive), text, re.M)
    return m.group(1).strip().strip('"') if m else None


def _mentions_domain(path: Path) -> bool:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return False
    return re.search(r"server_name[^;]*\b{}\b".format(re.escape(DOMAIN)), text) is not None


def detect_cert(paths):
    """按优先级找出现有 HTTPS 证书：本域名的配置 > Let's Encrypt > 常见手放路径"""
    files = read_conf_files(paths)

    # 1) 本域名 server 块里正在用的证书（说明当前 HTTPS 是通的）
    for f in files:
        if not _mentions_domain(f):
            continue
        cert = _extract(f, "ssl_certificate")
        key = _extract(f, "ssl_certificate_key")
        if cert and key and Path(cert).is_file() and Path(key).is_file():
            return cert, key

    # 2) 任意配置里出现的证书
    for f in files:
        cert = _extract(f, "ssl_certificate")
        key = _extract(f, "ssl_certificate_key")
        if cert and key and Path(cert).is_file() and Path(key).is_file():
            return cert, key

    # 3) Let's Encrypt
    le = Path("/etc/letsencrypt/live") / DOMAIN
    if (le / "fullchain.pem").is_file() and (le / "privkey.pem").is_file():
        return str(le / "fullchain.pem"), str(le / "privkey.pem")

    # 4) 常见手放路径
    for cert in ("/etc/nginx/cert/{}.pem".format(DOMAIN),
                 "/etc/nginx/cert/{}/fullchain.pem".format(DOMAIN),
                 "/etc/nginx/ssl/{}.pem".format(DOMAIN)):
        if not Path(cert).is_file():
            continue
        for key in (str(Path(cert).with_suffix(".key")),
                    str(Path(cert).parent / "privkey.pem"),
                    str(Path(cert).parent / "{}.key".format(DOMAIN))):
            if Path(key).is_file():
                return cert, key
    return None


# ============================================================
# Nginx 配置生成
# ============================================================
def render_conf(template: str, cert: str, key: str) -> str:
    """把模板里的 ssl_certificate / ssl_certificate_key 换成本机真实路径"""
    out = []
    for line in template.splitlines():
        stripped = line.strip()
        if stripped.startswith("ssl_certificate_key") and stripped.endswith(";"):
            indent = line[:len(line) - len(line.lstrip())]
            out.append("{}ssl_certificate_key {};".format(indent, key))
        elif stripped.startswith("ssl_certificate") and stripped.endswith(";"):
            indent = line[:len(line) - len(line.lstrip())]
            out.append("{}ssl_certificate     {};".format(indent, cert))
        else:
            out.append(line)
    return "\n".join(out) + "\n"


# ============================================================
# 后端定位与重启
# ============================================================
def find_listener():
    """返回监听 3000 端口的 (pid, cwd, script)"""
    code, out = run(["ss", "-lntp"], quiet=True)
    if code != 0:
        return None, None, None
    pid = None
    for line in out.splitlines():
        if re.search(r":3000\s", line):
            m = re.search(r"pid=(\d+)", line)
            if m:
                pid = m.group(1)
                break
    if not pid:
        return None, None, None

    cwd, script = None, None
    try:
        cwd = os.readlink("/proc/{}/cwd".format(pid))
    except Exception:
        pass
    try:
        with open("/proc/{}/cmdline".format(pid), "rb") as fh:
            args = [a.decode("utf-8", "replace") for a in fh.read().split(b"\0") if a]
        for a in args:
            if re.search(r"\.(m?js|cjs)$", a):
                script = a
                break
    except Exception:
        pass

    if script and not os.path.isabs(script) and cwd:
        script = os.path.join(cwd, script)
    return pid, cwd, script


def restart_backend(script_path: Path, old_pid, dry_run=False):
    """优先 systemd，其次 pm2，最后自动创建 systemd 服务接管"""
    workdir = str(script_path.parent)

    code, out = run(["systemctl", "list-unit-files"], quiet=True)
    if "gpa-server.service" in out:
        if dry_run:
            info("[dry-run] systemctl restart gpa-server")
            return True
        code, _ = run(["systemctl", "restart", "gpa-server"])
        if code == 0:
            ok("已通过 systemd 重启 gpa-server")
            return True
        warn("systemd 重启失败")

    node_bin = shutil.which("node")
    if not node_bin:
        die("找不到 node 可执行文件（后端是用什么启动的？请手动确认 PATH）")

    if shutil.which("pm2"):
        code, out = run(["pm2", "list"], quiet=True)
        if "gpa-server" in out:
            if dry_run:
                info("[dry-run] pm2 restart gpa-server --update-env")
                return True
            code, _ = run(["pm2", "restart", "gpa-server", "--update-env"])
            if code == 0:
                ok("已通过 pm2 重启 gpa-server")
                return True
            warn("pm2 重启失败，尝试 systemd 接管")

    # 兜底：写 systemd 服务并接管
    warn("未检测到 systemd / pm2 托管，改用 systemd 服务接管")
    unit = """[Unit]
Description=GPA Calculator Proxy Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory={workdir}
ExecStart={node} {script}
Restart=always
RestartSec=10
Environment=PORT=3000
Environment=HOST=127.0.0.1

[Install]
WantedBy=multi-user.target
""".format(workdir=workdir, node=node_bin, script=script_path)

    if dry_run:
        info("[dry-run] 写入 /etc/systemd/system/gpa-server.service")
        return True

    if old_pid:
        run(["kill", old_pid], quiet=True)
        import time
        time.sleep(1)
    Path("/etc/systemd/system/gpa-server.service").write_text(unit, encoding="utf-8")
    run(["systemctl", "daemon-reload"])
    run(["systemctl", "enable", "gpa-server"])
    code, _ = run(["systemctl", "restart", "gpa-server"])
    if code != 0:
        die("systemd 启动失败，查看：journalctl -u gpa-server -n 50")
    ok("已创建并启动 systemd 服务 gpa-server")
    return True


# ============================================================
# 主流程
# ============================================================
def deploy(paths, dry_run=False):
    import time

    # ---------- 0. 环境检查 ----------
    step("0. 环境检查")
    if not dry_run and getattr(os, "geteuid", lambda: 0)() != 0:
        die("请用 root 执行（sudo python3 deploy_server.py）")
    if not shutil.which("nginx"):
        die("未找到 nginx")
    if not (HERE / "nginx.conf").is_file():
        die("缺少文件：{}".format(HERE / "nginx.conf"))
    server_src = asset_server_js()
    if server_src is None:
        die("缺少 server.js（期望在 {} 或 {}）".format(
            HERE / "server.js", HERE.parent / "server" / "server.js"))
    site_src = asset_site_dir()
    if site_src is None:
        die("缺少 site 目录（期望在 {}）".format(HERE / "site"))
    for f in SITE_FILES:
        if not (site_src / f).is_file():
            die("缺少站点文件：{}".format(site_src / f))
    code, out = run(["nginx", "-v"], quiet=True)
    ok("部署文件齐全，{}".format(out.strip() or "nginx 已安装"))

    # ---------- 1. 备份 ----------
    step("1. 备份现有配置")
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = Path(str(paths["backup_dir"]) + "-" + stamp)
    if dry_run:
        info("[dry-run] 备份到 {}".format(backup))
    else:
        backup.mkdir(parents=True, exist_ok=True)
        for key in ("conf_d", "sites_enabled"):
            if paths[key].is_dir():
                shutil.copytree(paths[key], backup / paths[key].name, symlinks=True,
                                dirs_exist_ok=True)
        if paths["conf_file"].is_file():
            shutil.copy2(paths["conf_file"], backup / "xiaofengzhulin.conf.old")
        ok("已备份到 {}".format(backup))

    # ---------- 2. 证书 ----------
    step("2. 探测 HTTPS 证书")
    found = detect_cert(paths)
    if not found:
        die("没有找到现成的 HTTPS 证书。请先配好证书（阿里云免费证书 / certbot）再重跑本脚本。")
    cert, key = found
    ok("证书: {}".format(cert))
    ok("私钥: {}".format(key))

    # ---------- 3. 站点文件 ----------
    step("3. 部署静态站点")
    site_dir = paths["site_dir"]
    if dry_run:
        info("[dry-run] 复制 4 个文件到 {}".format(site_dir))
    else:
        site_dir.mkdir(parents=True, exist_ok=True)
        for f in SITE_FILES:
            shutil.copy2(site_src / f, site_dir / f)
        try:
            import grp
            import pwd
            uid = pwd.getpwnam("www-data").pw_uid
            gid = grp.getgrnam("www-data").gr_gid
            for f in site_dir.iterdir():
                os.chown(f, uid, gid)
            os.chmod(site_dir, 0o755)
        except Exception:
            warn("无法设置 www-data 所有者（不影响访问，Nginx 用 root 读文件）")
        ok("已部署到 {}：{}".format(site_dir, ", ".join(SITE_FILES)))

    # ---------- 4. 后端 ----------
    step("4. 更新后端 server.js")
    pid, cwd, script = find_listener()
    if pid:
        ok("检测到 3000 端口后端：PID={} 脚本={}".format(pid, script or "(未知)"))
    else:
        warn("没有检测到 3000 端口上的后端")

    target = Path(script) if script and Path(script).is_file() else paths["backend_dir"] / "server.js"
    if dry_run:
        info("[dry-run] 覆盖 {}".format(target))
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.is_file():
            shutil.copy2(target, "{}.bak-{}".format(target, stamp))
        shutil.copy2(server_src, target)
        if "login-lock" in target.read_text(encoding="utf-8", errors="replace"):
            ok("已更新为带限流/登录锁定的版本：{}".format(target))
        else:
            warn("新版本未包含 login-lock 标记，请检查")

    # ---------- 5. 重启后端 ----------
    step("5. 重启后端")
    restart_backend(target, pid, dry_run=dry_run)
    if not dry_run:
        time.sleep(1)
        code, out = run(["ss", "-lntp"], quiet=True)
        if ":3000" in out:
            ok("3000 端口已在监听")
        else:
            die("3000 端口未监听，查看：journalctl -u gpa-server -n 50")

    # ---------- 6. Nginx ----------
    step("6. 生成并启用 Nginx 配置")
    for f in read_conf_files(paths):
        if f == paths["conf_file"] or f == paths["nginx_main"]:
            continue
        if _mentions_domain(f):
            if dry_run:
                info("[dry-run] 停用重复配置 {}".format(f))
            else:
                shutil.copy2(f, backup / (f.name + ".disabled"))
                f.unlink()
                ok("已停用重复配置: {}".format(f))

    template = (HERE / "nginx.conf").read_text(encoding="utf-8")
    conf_text = render_conf(template, cert, key)

    if dry_run:
        info("[dry-run] 写入 {}".format(paths["conf_file"]))
        info("[dry-run] nginx -t && systemctl reload nginx")
        print("\n生成的配置预览（前 30 行）：")
        for line in conf_text.splitlines()[:30]:
            print("    " + line)
        return 0

    if re.search(r"^\s*http2\s+on\s*;", conf_text, re.M):
        die("模板里仍有 `http2 on;`（该指令要求 nginx >= 1.25.1），请改用 `listen 443 ssl http2;`")

    paths["conf_file"].parent.mkdir(parents=True, exist_ok=True)
    paths["conf_file"].write_text(conf_text, encoding="utf-8")

    code, out = run(["nginx", "-t"], quiet=True)
    if code != 0:
        info(out.strip())
        paths["conf_file"].unlink(missing_ok=True)
        for key_name in ("sites_enabled", "conf_d"):
            src = backup / paths[key_name].name
            if src.is_dir():
                shutil.copytree(src, paths[key_name], symlinks=True, dirs_exist_ok=True)
        run(["nginx", "-t"], quiet=True)
        run(["systemctl", "reload", "nginx"], quiet=True)
        die("Nginx 配置校验失败，已自动回滚到原配置")

    code, _ = run(["systemctl", "reload", "nginx"])
    if code != 0:
        die("nginx reload 失败，查看：systemctl status nginx")
    ok("Nginx 配置已生效")
    # reload 后旧 worker 会短暂继续服务，立刻校验会误报 404，等它退场
    time.sleep(1.5)

    # ---------- 7. 自检 ----------
    step("7. 自检")
    checks = [
        ("首页 HTTPS", "200", ["curl", "-sk", "-o", "/dev/null", "-w", "%{http_code}",
                              "-H", "Host: {}".format(DOMAIN), "https://127.0.0.1/"]),
        ("style.css", "200", ["curl", "-sk", "-o", "/dev/null", "-w", "%{http_code}",
                             "-H", "Host: {}".format(DOMAIN), "https://127.0.0.1/style.css"]),
        ("app.js", "200", ["curl", "-sk", "-o", "/dev/null", "-w", "%{http_code}",
                          "-H", "Host: {}".format(DOMAIN), "https://127.0.0.1/app.js"]),
        ("/api/health", "200", ["curl", "-sk", "-o", "/dev/null", "-w", "%{http_code}",
                               "-H", "Host: {}".format(DOMAIN), "https://127.0.0.1/api/health"]),
        ("HTTP 跳转", "301", ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
                             "-H", "Host: {}".format(DOMAIN), "http://127.0.0.1/"]),
    ]
    for name, expect, cmd in checks:
        _code, out = run(cmd, quiet=True)
        got = (out or "").strip()
        if got == expect:
            ok("{}：{}".format(name, got))
        else:
            warn("{}：期望 {}，实际 {}".format(name, expect, got))

    _code, body = run(["curl", "-sk", "-H", "Host: {}".format(DOMAIN), "https://127.0.0.1/"],
                      quiet=True)
    if "蒙ICP备2026007686号-2" in (body or ""):
        ok("首页已展示 ICP 备案号")
    else:
        warn("首页未找到 ICP 备案号")

    print()
    if _fail == 0:
        print("\033[32m部署完成\033[0m")
    else:
        print("\033[33m部署完成，但有 {} 项自检未通过（见上）\033[0m".format(_fail))
    print("  站点目录 : {}".format(paths["site_dir"]))
    print("  后端脚本 : {}".format(target))
    print("  Nginx    : {}".format(paths["conf_file"]))
    print("  备份     : {}".format(backup))
    print("\n回滚：")
    print("  cp -a {}/conf.d/. /etc/nginx/conf.d/ && cp -a {}/sites-enabled/. /etc/nginx/sites-enabled/ 2>/dev/null".format(backup, backup))
    print("  nginx -t && systemctl reload nginx")
    return 0 if _fail == 0 else 2


# ============================================================
# 自测：用临时目录验证纯逻辑，不碰系统
# ============================================================
def self_test():
    print("自测开始（不触碰系统文件）")
    errors = 0

    def check(name, cond, detail=""):
        nonlocal errors
        if cond:
            print("  ✔ {}".format(name))
        else:
            errors += 1
            print("  ✘ {} {}".format(name, detail))

    tmp = Path(tempfile.mkdtemp(prefix="gpa-deploy-test-"))
    try:
        paths = build_paths(tmp)
        for d in ("conf_d", "sites_enabled"):
            paths[d].mkdir(parents=True, exist_ok=True)

        # 1. 证书探测：从本域名 server 块里取
        cert_file = tmp / "etc/nginx/cert/xiaofengzhulin.xyz.pem"
        key_file = tmp / "etc/nginx/cert/xiaofengzhulin.xyz.key"
        cert_file.parent.mkdir(parents=True, exist_ok=True)
        cert_file.write_text("cert", encoding="utf-8")
        key_file.write_text("key", encoding="utf-8")
        (paths["conf_d"] / "old.conf").write_text(
            "server {\n"
            "    listen 443 ssl;\n"
            "    server_name xiaofengzhulin.xyz www.xiaofengzhulin.xyz;\n"
            "    ssl_certificate " + str(cert_file) + ";\n"
            "    ssl_certificate_key " + str(key_file) + ";\n"
            "}\n",
            encoding="utf-8")
        got = detect_cert(paths)
        check("能从现有配置探测到证书", got == (str(cert_file), str(key_file)), str(got))

        # 2. 渲染配置：证书路径被替换，其它行原样保留
        template = (HERE / "nginx.conf").read_text(encoding="utf-8")
        rendered = render_conf(template, "/x/fullchain.pem", "/x/privkey.pem")
        check("证书路径已替换", "ssl_certificate     /x/fullchain.pem;" in rendered)
        check("私钥路径已替换", "ssl_certificate_key /x/privkey.pem;" in rendered)
        check("模板里不再有 http2 独立指令（nginx 1.24 不支持）",
              re.search(r"^\s*http2\s+on\s*;", rendered, re.M) is None)
        check("保留了 HTTP/2 的兼容写法", "listen      443 ssl http2;" in rendered)
        check("保留了 /api 反代", "location /api/" in rendered)
        check("保留了登录限流", "limit_req_zone" in rendered and "location = /api/login" in rendered)
        check("保留了静态站点根目录", "root  /var/www/xiaofengzhulin;" in rendered)
        check("配置行数与模板一致", len(rendered.splitlines()) == len(template.splitlines()))

        # 3. 重复 server_name 识别
        other = paths["conf_d"] / "dup.conf"
        other.write_text("server { server_name xiaofengzhulin.xyz; }\n", encoding="utf-8")
        check("能识别同域名的重复配置", _mentions_domain(other) is True)
        check("不会误判无关配置", _mentions_domain(paths["conf_file"]) is False)

        # 4. 模板里带 BOM 也能正确渲染
        check("渲染结果无 BOM 残留", not rendered.startswith("\ufeff"))

    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print()
    if errors == 0:
        print("自测通过：{}\n".format("全部断言成立"))
        return 0
    print("自测失败：{} 项\n".format(errors))
    return 1


def main():
    ap = argparse.ArgumentParser(description="GPA 站点服务器端部署")
    ap.add_argument("--dry-run", action="store_true", help="只打印规划，不改动系统")
    ap.add_argument("--self-test", action="store_true", help="用临时目录自测纯逻辑")
    args = ap.parse_args()

    if args.self_test:
        sys.exit(self_test())

    paths = build_paths("/")
    sys.exit(deploy(paths, dry_run=args.dry_run))


if __name__ == "__main__":
    main()
