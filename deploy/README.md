# 部署后端、数据库与图片

此目录提供可审阅的服务器部署配置。配置文件存在不表示已经上线；真正部署还需要选定服务器或云平台、访问权限和后端域名。

## 部署内容

- Caddy：对外提供 HTTPS，反向代理到后端。
- Django + Gunicorn：处理指南、账号、投稿、审核和受控图片读取。
- PostgreSQL 17：保存账号、指南和投稿，使用独立持久卷。
- `app_data` 持久卷：保存上传图片、管理入口凭据文件和临时备份。

数据库和应用的内部端口不直接暴露到互联网；仅 Caddy 对外开放 80 和 443。图片仍由 Django 检查访问权限，不配置公开的 `/media/` 文件目录。

## 使用已有 Linux 服务器

1. 准备 Docker Engine 与 Compose 插件，以及一个解析到服务器的自有域名。
2. 上传项目源码，保留 `server`、`deploy`、`Dockerfile`、`.dockerignore` 等文件。不要上传 `.local`、`.venv`、本机数据库或密码文件。
3. 在项目根目录运行：

```sh
sudo python3 deploy/init.py --domain campus.example.com
docker compose --env-file deploy/.env -f deploy/compose.yaml config --quiet
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
```

将示例域名替换为自己控制的域名。初始化脚本只生成本地部署文件和随机密钥，不会联系云平台，也不会替换已有密码。`deploy/secrets` 和 `deploy/.env` 已加入 Git 忽略规则。

Caddy 取得公开证书需要正确的 DNS、可达的 80/443 端口及持久证书目录。参考 [Caddy 官方 HTTPS 说明](https://caddyserver.com/docs/automatic-https)。

首次启动会迁移数据库、生成共享缓存表、补充初始指南、创建管理员、收集静态资源，并执行 Django 部署检查。管理员账号为 `hku_admin`，密码存放在服务器上的 `deploy/secrets/admin_password`，请由项目维护者在自己的终端中查看并保管。

浏览器访问 `https://域名/admin/`；手机端配置 `EXPO_PUBLIC_API_URL=https://域名` 后重新启动 Expo。上线后验证健康检查、管理员登录、注册、上传、审核和公开读取。

## 备份与恢复

在服务器执行：

```sh
sudo sh deploy/backup.sh
```

脚本短暂停止应用写入，导出数据库和图片，生成文件摘要，再重新启动应用。备份复制到 `deploy/backups`；请另存到独立的安全位置，单独保存在同一台服务器上不足以防止整机损坏。

备份包括密码摘要、恢复码摘要和投稿图片，不能作为公开的小组分享包。服务端密钥不进入备份，需要单独保管。登录会话不恢复，恢复后用户重新登录。

恢复到新的空数据目录和数据库：先执行迁移与 `createcachetable`，再执行 `manage.py restore_project /备份路径.zip`。不要先运行 `seed_guide` 或 `init_admin`；恢复命令会拒绝覆盖已有账号、分类、内容或图片。然后重新执行 `collectstatic` 并启动应用。

容器中可以先初始化空数据库，再覆盖入口执行恢复；生产入口会再次执行幂等迁移。恢复操作应指向新的部署卷，确认恢复结果后再切换服务，原部署继续保留以便回退。

提供的新部署恢复命令为：

```sh
sudo env COMPOSE_PROJECT_NAME=hku-walk-restore sh deploy/restore.sh /绝对路径/备份.zip
```

脚本要求使用不同的 Compose 项目名，不覆盖原部署。它只启动恢复后的内部服务，不抢占原站点的 80/443 端口。验证后再切换公开入口。恢复后保留备份中的账号密码，首次初始化生成的 `admin_password` 文件不会替换已有管理员密码。

跨 SQLite/PostgreSQL 使用 Django 的可移植数据备份；数据与图片一起恢复，指南标识和版本关系会保留。数据库本身的原生快照可另行增加，但不能替代图片备份。

## 云平台

当前免费部署方案为 Render 免费 Web Service 加 Supabase 免费 PostgreSQL。应用表位于不对 Data API 开放的 `hku_app` schema，Django 使用单独的 `hku_walk_app` 数据库角色。手机只访问 Django 接口，不携带数据库密码。

Render 的临时磁盘不用于持久保存图片。小组演示设置 `DJANGO_STORAGE=database`，将清理后的图片保存在同一私有数据库，默认图片总量限制 100 MiB（`DJANGO_MEDIA_MAX_BYTES`）；达到限制时仍可提交无配图内容。此方案针对少量演示数据，大量图片应切换到私有 S3 存储。也支持 `DJANGO_STORAGE=s3`，需要服务端的 `S3_ENDPOINT_URL`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY` 与区域配置。凭据不能放进手机端或仓库。

云端变量包括 `DJANGO_DEBUG=0`、`DJANGO_SECRET_KEY`、`DATABASE_URL`、`DJANGO_DB_SCHEMA=hku_app`、`DJANGO_TRUST_PROXY=1`、`DJANGO_STORAGE=database`、`WEB_CONCURRENCY=1` 和首次初始化用的 `DJANGO_ADMIN_PASSWORD`。Render 的 `RENDER_EXTERNAL_HOSTNAME` 用于限制域名及生成 HTTPS 地址；其他平台需明确配置域名。Supabase 使用 Connect 页面提供的 Session pooler（5432），保留 SSL；私有 schema 不使用 transaction pooler（6543）。

免费服务有休眠与容量限制。Render 空闲后首次访问可能较慢；指南加载会等待唤醒，并支持失败后重试。具体限制以 [Render 免费服务说明](https://render.com/docs/free) 和 [Supabase 价格说明](https://supabase.com/pricing) 为准。

也可以使用支持 Python/Docker 的云平台，但必须同时配置 PostgreSQL 和持久图片存储。不能将本地 SQLite 或图片保存在会重启清空的临时文件系统里。

若使用平台托管的数据库，提供 `DATABASE_URL`（或 `DATABASE_URL_FILE`）；外部连接默认要求 SSL。平台的 HTTPS 代理应覆盖 `X-Forwarded-Proto`，并隐藏应用直连端口，再启用 `DJANGO_TRUST_PROXY=1`。设置 `DJANGO_DEBUG=0`、独立密钥、明确的 `DJANGO_ALLOWED_HOSTS` 与 HTTPS `DJANGO_PUBLIC_ORIGIN`。

源站遵循 [Django 的部署检查要求](https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/)。不同免费平台有数据保留、存储和休眠限制，需在选定平台后核实，避免测试结束后数据失效。

## 已验证范围

`scripts/verify_production.py` 在隔离目录中启动关闭 DEBUG 的 WSGI 服务，检查代理头、静态资源、账号恢复、图片可见范围、已发布内容修改，以及备份校验和恢复。

该本机检查使用 SQLite，并不表示 Docker、真实 PostgreSQL、公开 TLS 证书或真实手机已经验证。`.github/workflows/check.yml` 包含 PostgreSQL 和容器集成检查，推送到支持 Actions 的仓库后才会运行。
