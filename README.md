# 港大漫游 · HKU-Walk

面向香港大学学生和访客的校园地图与学生指南 App。手机端使用 React Native、Expo SDK 58 和 TypeScript，后端使用 Django。当前交付方式为可独立安装的 Android APK，正式后端和 PostgreSQL 数据库运行在香港服务器上。

## 主要功能

| 功能 | 当前实现 |
| --- | --- |
| 校园地图 | 本部及百周年校园底图，地点与设施筛选、缩放、定位、楼层及出入口说明、地点照片 |
| 地点搜索 | 简繁中文、英文、简称、拼音、别名及相近输入匹配；支持按餐饮等需求查找地点 |
| 步行路线 | 起终点选择与交换、地图位置示意、已发布路线的有序图文步骤、步骤照片放大查看 |
| 学生指南 | 常用链接、入学指南、美食和娱乐群，内置专题阅读、搜索、用户帖子、评论和点赞 |
| 问港大 | 结合地点、路线、指南、管理员上传的知识资料及港大官网信息回答校园问题 |
| 个人账号 | 注册登录、资料编辑、头像及背景图、密码修改、恢复码找回、消息、投稿记录 |
| 收藏与历史 | 地点、路线和帖子的记录按账号同步到后端，本机保留缓存与待同步操作 |
| 投稿与审核 | 新地点、图文路线、美食、群资料和纠错投稿；支持审核、退回修改、拒绝及已发布内容的修改申请 |
| 三语界面 | 手机端和管理后台均支持简体中文、香港繁体中文和英文 |

地图和指南可免登录浏览。收藏、评论、个人记录和投稿等功能需要账号。已发布路线使用审核后的说明和照片；内置演示路线的距离、连线和步骤是示例，不能作为已核实的逐向导航。

## 正式 App、后端与数据库

```text
Android APK / 从源码运行的手机端
                ↓ HTTPS API
       香港服务器上的 Django 后端
                ↓
       PostgreSQL 与受控图片存储
```

| 入口 | 地址 |
| --- | --- |
| 正式 API | `https://47.239.18.183` |
| 健康检查 | <https://47.239.18.183/api/health/> |
| 管理后台 | <https://47.239.18.183/admin/> |

正式 APK 自带手机端代码，安装后无需启动电脑或 Expo Go。联网功能通过上述后端读取数据；手机不直接连接数据库，也不携带数据库密码。

**希望看到与正式 App 相同的已发布地点、照片、路线和帖子时，应把源码运行的手机端也指向正式 API。** 无需导入生产数据库。个人收藏、消息和投稿仍按登录账号区分；管理后台需要独立的工作人员权限。线上内容会随后台维护和审核发布而更新，评审期间需要保持服务器可用。

本地后端默认使用 SQLite。迁移和 `seed_guide` 可以重建内置地点、设施和指南初始内容，但不会复制后来在线上上传的照片、帖子、账号、讨论或知识资料。生产数据库、上传文件、备份、管理员凭据及 API 私钥均不随源码分发。

## 从源码启动 Android 手机端

环境：Node.js 24.x、npm、Android Studio、Android SDK 和支持当前 Gradle 的 JDK。2026-11-26 的独立构建使用 Node 24.13.0、JDK 25、Android SDK 37、NDK 27.1.12297006；后端使用 Python 3.12。首次安装和构建需要联网下载依赖。

在任意可写目录克隆项目，并进入包含 `package.json` 的项目根目录。Windows 原生构建建议使用较短路径，例如 `C:\hku-review\HKU-Walk`。

```powershell
git clone https://github.com/lrk126336-glitch/HKU-Walk.git
cd HKU-Walk
npm ci
npm run locales:prepare
Set-Content -LiteralPath .env.local -Encoding ascii -Value 'EXPO_PUBLIC_API_URL=https://47.239.18.183'
```

仓库为私有仓库，克隆需要仓库访问权限；收到源码 ZIP 的读者可直接解压，从 `npm ci` 开始执行。`.env.local` 中这里只保存公开接口地址。JavaScript 依赖版本由 `package-lock.json` 锁定，使用 `npm ci` 安装。

### 生成原生项目并运行

在新克隆或新解压的副本中，先执行以下命令，为本次源码运行使用独立的 Android 应用标识，并关闭正式热更新下载：

```powershell
node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('app.json','utf8')); p.expo.android.package='com.hkuwalk.review'; p.expo.updates.enabled=false; fs.writeFileSync('app.json',JSON.stringify(p,null,2)+'\n');"
npx expo prebuild --platform android --no-install
```

这两项配置使自编译 App 可以与正式 APK 并存，并持续运行当前源码。它们不会更换后端地址或复制数据库。本节配置用于独立测试副本，正式发布保留 `com.hkuwalk` 及签名 OTA 配置。`android/` 是在本机生成的原生工程；不要复用其他电脑的生成目录、本机 SDK 路径或签名文件。

Windows 若出现 CMake 路径长度错误，可在生成的 `android/app/build.gradle` 的 `android { ... }` 中设置较短的构建目录；`projectRoot` 是该文件已定义的项目路径：

```groovy
externalNativeBuild.cmake.buildStagingDirectory file(System.getProperty("java.io.tmpdir") + "/hku-review-cxx-" + Integer.toHexString(projectRoot.hashCode()))
defaultConfig {
    externalNativeBuild.cmake.arguments "-DCMAKE_OBJECT_PATH_MAX=245"
}
```

启动 Android Studio 中的模拟器，或连接已开启 USB 调试的手机，然后在项目根目录运行：

```powershell
npx expo run:android
```

此命令构建并安装开发版本，同时启动 Metro。开发运行期间保持 Metro 开启；不需要 Expo Go 或 Expo 云构建账号。`npm run android` 只启动 Expo 开发服务器并尝试打开安卓设备，不等于编译 APK。

### 编译独立 APK

完成上述配置与 `prebuild` 后，在项目根目录运行：

```powershell
cd android
.\gradlew.bat assembleRelease
cd ..
```

macOS/Linux 使用 `./gradlew assembleRelease`。生成文件位于 `android/app/build/outputs/apk/release/app-release.apk`。新生成的 Expo 模板使用开发签名来构建这个独立测试版本；它可以脱离 Metro 运行，在线功能仍依赖所选后端。正式版升级 APK 需要维护者的正式签名，签名私钥不在仓库中。

需要 Android SDK 时，通过 Android Studio 安装构建要求的组件并接受许可；检查 `ANDROID_HOME` 与 `JAVA_HOME` 指向本机实际安装位置。Windows 若遇到 C++ 路径过长，应先使用较短的项目目录再生成原生工程。Expo 在线兼容检查可能提示更新的补丁版本，依赖升级应单独验证。

## 在本机运行后端

本地开发或独立检查审核流程时，先安装 Python 3.12，再在项目根目录运行：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r server/requirements.txt
.\Start-Backend.ps1
```

脚本执行数据库迁移、导入初始内容、初始化管理员，并在 `http://127.0.0.1:8000` 启动服务。默认数据库为 `.local/hku-walk.sqlite3`，本机管理员的随机登录信息保存在 `.local/admin-access.txt`。重复运行会保留已有账号和管理员修改。浏览器打开 <http://127.0.0.1:8000/admin/> 管理这套本地数据。

将手机端改为本地后端时，在生成原生工程和启动 Metro 之前设置对应接口地址：

```powershell
Set-Content -LiteralPath .env.local -Encoding ascii -Value 'EXPO_PUBLIC_API_URL=http://10.0.2.2:8000'
```

`10.0.2.2` 是安卓模拟器访问宿主电脑的地址。开发版本支持本地 HTTP；为本地 HTTP 后端单独构建 release APK 时，还需在 Android 网络配置中允许该地址的明文连接。

真机使用电脑的实际局域网 IP，后端需要监听该网卡并在 `DJANGO_ALLOWED_HOSTS` 中加入对应 IP。两台设备须能互相访问，防火墙须允许所用端口。网络设置与可选 Expo Go 预览脚本见 [PHONE_TEST.md](PHONE_TEST.md)；该文档包含历史检查记录，正式 APK 的运行方式以上文为准。

macOS/Linux 可使用 `python3 -m venv .venv` 和 `.venv/bin/python`，依次执行 `server/manage.py migrate --noinput`、`seed_guide`、`init_admin`，最后运行 `server/manage.py runserver 127.0.0.1:8000 --noreload`。

## 管理、知识库与语言

管理员可以维护地点、设施、路线和指南，审核投稿及已发布内容的修改申请。投稿状态包括待审核、已通过、需修改和已拒绝；退回修改后可以重交，已拒绝的投稿不能重交。已发布内容的修改申请通过前，公开版本保持不变。

后台支持 Word 知识资料上传，供问港大检索和回答。上传文档与原文来源页受工作人员权限保护，普通用户回答中的引用展示公开来源。独立本地环境可以自行上传资料；连接正式 API 的手机端使用现有线上知识库。

问港大及 AI 翻译的模型密钥只配置在后端。默认模型配置见 `server/config/settings.py`；可通过 `DEEPSEEK_API_KEY`，或兼容服务的 `ASSISTANT_API_BASE_URL`、`ASSISTANT_API_KEY`、`ASSISTANT_MODEL` 设置。详细配置见 [deploy/README.md](deploy/README.md)。本地未配置模型密钥时，AI 问答和相关翻译功能不可用；地图、账号、投稿和内置翻译可独立使用。

手机端与管理后台的语言设置相互独立，编辑框和数据库保留原文。地点简介、已发布路线标题和步骤随界面语言自动翻译；社区帖子由用户点击「显示翻译」触发。译文按原文版本及目标语言缓存，原文更新后重新生成。

系统文案的英文译文登记在 `locales/*-en.json`，香港繁体由 OpenCC 生成；`locales/messages.json` 为生成文件。使用 `npm run locales:prepare` 生成并检查字典，`npm run locales:check` 检查覆盖和生成文件同步。新增功能须同时完成三语支持，具体约定见 [AGENTS.md](AGENTS.md)。

内置长篇指南的英文正文位于 `locales/guide-articles-en.json`，原文摘要版本位于 `locales/guide-source-revisions.json`。后台翻译位于 `server/locale/*/LC_MESSAGES/django.po`，编译后的 `.mo` 随源码分发；修改后台翻译后，需用 GNU gettext 运行 `compilemessages` 并提交两种文件。

## 发布与更新

| 改动 | 发布方式 |
| --- | --- |
| 后台编辑公开内容、审核通过投稿 | 写入线上数据库，App 后续刷新时读取 |
| Django 接口、权限或数据结构 | 单独部署后端，必要时执行数据库迁移 |
| 与当前原生运行时兼容的手机端代码、图片等资源 | 导出并发布签名 OTA 热更新 |
| 原生插件、权限、SDK 或原生配置 | 构建、签名并分发新的 APK，按兼容性调整 runtime |

`app.json` 当前正式 App 版本为 `1.0.6`、Android `versionCode` 为 `10`，OTA runtime 使用 `appVersion` 策略。Android 正式版由 `StartupUpdate.tsx` 在启动时检查相符 runtime 的已签名更新；开发模式跳过此过程。证书公钥在 `assets/android-update-certificate.cer`，制作更新使用 `scripts/prepare-android-update.mjs`，签名私钥由维护者保管。关闭更新的源码测试副本不会下载正式 OTA。

**推送 GitHub 与发布后端、OTA、APK 是不同操作。** `.github/workflows/check.yml` 执行检查，不部署正式环境。涉及接口和内容的联动发布，应先部署兼容的后端，再发布手机端更新。服务器部署、图片存储及备份恢复操作见 [deploy/README.md](deploy/README.md)。

## 项目结构

| 路径 | 内容 |
| --- | --- |
| 根目录 `.tsx`、`.ts` | 手机端界面、状态、搜索、地图和接口调用 |
| `assets/`、根目录数据 JSON | 图像、地图及内置数据 |
| `locales/` | 手机端翻译与指南翻译版本 |
| `server/guide/` | 校园数据、指南、讨论、问答、知识库和翻译 |
| `server/community/` | 账号、投稿、审核、图片访问、消息与个人记录 |
| `server/locale/`、`server/templates/` | 后台翻译及页面模板 |
| `scripts/` | 语言校验、应用检查和热更新准备 |
| `deploy/`、`Dockerfile` | 部署、存储及备份恢复配置 |

## 检查与已验证范围

安装前后端依赖后，在项目根目录运行：

```powershell
npx tsc --noEmit
npm run locales:check
node scripts/check-localization.cjs
npm run check:content-language
npm run check:guide-reader
node scripts/check-app.cjs
.\.venv\Scripts\python.exe server/manage.py test guide community --noinput
.\.venv\Scripts\python.exe server/manage.py makemigrations --check --dry-run
npx expo export --platform android --output-dir .expo/check-android
```

2026-11-26，源码 `1b90e50` 的独立解压副本通过了 npm 与 Python 依赖安装、类型和语言检查、应用回归检查、144 项后端测试、迁移检查、本地接口启动、Android 导出及 x86_64 release APK 编译。该 APK 已核对内嵌的正式 API 地址；这次检查未进行真机操作。GitHub Actions 的当前结果以对应提交的检查页面为准。

## 数据来源

底图道路及楼宇轮廓主要来自 [OpenStreetMap contributors（ODbL）](https://www.openstreetmap.org/copyright)。地点、出入口、餐饮及设施资料参考港大[校园地图](https://www.estates.hku.hk/download_file/view_inline/674)、[大学街地图](https://www.maps.hku.hk/downloads/201501hkumap.jpg)、[餐饮目录](https://catering.hku.hk/en/eateries/)、[无障碍通行资料](https://www.estates.hku.hk/campus-information/campus-accessibility/wheelchair-friendly-routes-hku-main-estate)及[停车场资料](https://www.estates.hku.hk/our-services/facility-management/parking/parking-space-location-and-parking-fee)。App 同时接收经审核的校园共建内容；设施的楼层说明与示意点位以各条资料展示为准。
