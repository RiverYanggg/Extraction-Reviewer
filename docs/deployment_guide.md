# Extraction Reviewer 云服务器部署指南

本文档说明如何把当前项目部署到云服务器，并让多人通过浏览器登录使用。

## 1. 代码仓库

项目已推送到 GitHub：

```text
git@github.com:RiverYanggg/Extraction-Reviewer.git
```

当前主分支：

```text
main
```

注意：项目根目录 `.env` 不会提交到 GitHub，需要在服务器上手动创建。

## 2. 安装基础环境

以下命令以 Ubuntu 服务器为例：

```bash
sudo apt update
sudo apt install -y git python3 python3-venv nginx
```

## 3. 拉取项目并安装依赖

```bash
git clone git@github.com:RiverYanggg/Extraction-Reviewer.git
cd Extraction-Reviewer

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

如果服务器没有配置 GitHub SSH key，也可以用 HTTPS 拉取：

```bash
git clone https://github.com/RiverYanggg/Extraction-Reviewer.git
```

## 4. 创建服务器环境变量文件

在项目根目录创建 `.env`：

```bash
nano .env
```

写入：

```env
DEEPSEEK_API_KEY=你的真实deepseek_key
DEEPSEEK_BASE_URL=https://api.deepseek.com
ENVIZ_ASSISTANT_MODEL=deepseek-v4-flash
ENVIZ_AUTH_SECRET=换成一个很长的随机字符串
```

`ENVIZ_AUTH_SECRET` 用于签名登录 Cookie。上云部署时必须换成随机长字符串，不要使用示例值。

## 5. 本地启动测试

先直接启动服务，确认项目可以运行：

```bash
.venv/bin/python -m uvicorn app.enviz.server:app --host 0.0.0.0 --port 8765
```

浏览器访问：

```text
http://服务器IP:8765
```

如果云服务器有安全组或防火墙，需要放行 `8765` 端口；生产环境建议用 Nginx 反向代理后只开放 `80/443`。

## 6. 配置 systemd 后台运行

创建 systemd 服务文件：

```bash
sudo nano /etc/systemd/system/extraction-reviewer.service
```

内容如下。请按实际服务器路径修改 `WorkingDirectory`、`EnvironmentFile`、`ExecStart` 和 `User`：

```ini
[Unit]
Description=Extraction Reviewer
After=network.target

[Service]
WorkingDirectory=/home/ubuntu/Extraction-Reviewer
EnvironmentFile=/home/ubuntu/Extraction-Reviewer/.env
ExecStart=/home/ubuntu/Extraction-Reviewer/.venv/bin/python -m uvicorn app.enviz.server:app --host 127.0.0.1 --port 8765
Restart=always
User=ubuntu

[Install]
WantedBy=multi-user.target
```

启动并设置开机自启：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now extraction-reviewer
sudo systemctl status extraction-reviewer
```

查看日志：

```bash
sudo journalctl -u extraction-reviewer -f
```

重启服务：

```bash
sudo systemctl restart extraction-reviewer
```

## 7. 配置 Nginx 反向代理

如果你有域名，例如 `review.example.com`，创建 Nginx 配置：

```bash
sudo nano /etc/nginx/sites-available/extraction-reviewer
```

写入：

```nginx
server {
    listen 80;
    server_name review.example.com;

    client_max_body_size 100M;

    location / {
        proxy_pass http://127.0.0.1:8765;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/extraction-reviewer /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

之后访问：

```text
http://review.example.com
```

如需 HTTPS，可再用 Certbot 配置证书。

## 8. 账号与密码配置

用户账号统一在 `config/users.json` 中管理。这个文件比 `.env` 中的 `ENVIZ_USERS_JSON` 优先级更高，更适合多人账号维护。

生成密码 SHA-256：

```bash
python3 -c "import hashlib; print(hashlib.sha256('你的密码'.encode()).hexdigest())"
```

`config/users.json` 示例。`workspace` 是该账号在 `data/users/` 下的工作区目录名；不写时默认等于登录账号。

```json
{
  "xuben": {
    "display_name": "Xuben",
    "workspace": "xuben",
    "password_sha256": "替换为密码SHA256"
  },
  "sunyandong": {
    "display_name": "Sunyandong",
    "workspace": "sunyandong",
    "password_sha256": "替换为密码SHA256"
  }
}
```

如果你希望工作区目录和账号一致，直接把账号名设置为想要的目录名，并省略 `workspace` 也可以。例如账号 `xuben` 会默认使用：

```text
data/users/xuben/
```

修改 `config/users.json` 后重启服务：

```bash
sudo systemctl restart extraction-reviewer
```

如果你暂时不想维护文件，也可以删除 `config/users.json`，改用 `.env` 中的 `ENVIZ_USERS_JSON` 一行配置方式。

```bash
sudo systemctl restart extraction-reviewer
```

## 9. 给用户分配论文

每个用户可见的论文由对应工作区目录下的 `assignments.json` 控制：

```text
data/users/<工作区目录>/assignments.json
```

示例：

```json
{
  "papers": [
    "10.1016_j.matlet.2024.136522",
    "10.1016_j.msea.2007.01.014"
  ]
}
```

只把该用户应看到的 `paper_id` 放进 `papers` 数组。未出现在数组里的论文，该用户无法在列表、详情、PDF、图片、导出接口中访问。

新增账号后，也要创建对应的工作区目录和分配文件：

```bash
mkdir -p data/users/xuben
nano data/users/xuben/assignments.json
```
```

## 10. 用户标注数据位置

每个用户的标注结果自动写入：

```text
data/users/<工作区目录>/annotations/
```

例如：

```text
data/users/xuben/annotations/
```

这些文件不会提交到 GitHub。建议服务器定期备份整个 `data/users/` 目录。

## 11. 更新代码

服务器上拉取最新代码：

```bash
cd /home/ubuntu/Extraction-Reviewer
git pull
source .venv/bin/activate
pip install -r requirements.txt
sudo systemctl restart extraction-reviewer
```

## 12. 常见问题

### 访问不了页面

检查服务状态：

```bash
sudo systemctl status extraction-reviewer
sudo journalctl -u extraction-reviewer -n 100
```

如果直接访问端口，确认云服务器安全组放行端口。

### 登录后看不到论文

检查该用户是否有分配文件：

```text
data/users/<工作区目录>/assignments.json
```

并确认其中的 `paper_id` 与 `extracted/` 下的目录名完全一致。

### AI 不工作

检查 `.env` 中是否配置：

```env
DEEPSEEK_API_KEY=...
```

修改后重启服务。

### 导出结果为空或不完整

确认用户已经登录正确账号，并且对应论文已分配给该用户。全体导出只会导出当前账号已分配的论文。
