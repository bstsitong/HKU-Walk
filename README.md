# HKU-Walk

A campus map and student guide for University of Hong Kong students and visitors.
The mobile app is built with React Native, Expo SDK 58 and TypeScript, with a
Django backend and a hosted PostgreSQL database in Hong Kong.

**[Download HKU-Walk 1.0.6 for Android](https://github.com/bstsitong/HKU-Walk/releases/download/v1.0.6/HKU-Walk-1.0.6.apk)**

[Release details](https://github.com/bstsitong/HKU-Walk/releases/tag/v1.0.6) | [Chinese README](README.zh-CN.md)

## Install the Android app

1. Download the APK using the link above and open it on an Android device.
2. Allow installation from the browser or file manager when Android asks.
3. Open HKU-Walk with an Internet connection and allow the signed startup update
   to finish. The app uses the production backend and its existing published data.
4. Browse the map and guides without signing in, or register an account for
   bookmarks, comments, submissions and other personal features.

The standalone APK does not require Expo Go, a development computer, an Aliyun
account or a database password. It supports ARM64 Android phones and x86_64
emulators, with Android 7.0 / API 24 or later.

| APK detail | Value |
| --- | --- |
| Version | 1.0.6 |
| Android application ID | `com.hkuwalk` |
| Version code | 10 |
| File size | 45.65 MB |
| Download | [HKU-Walk-1.0.6.apk](https://github.com/bstsitong/HKU-Walk/releases/download/v1.0.6/HKU-Walk-1.0.6.apk) |

SHA-256 of the downloadable APK:

```text
1902493d37d1e521f2d372ed4b0c02ad421d66a12d7a0e67e85f347ac56f4911
```

The installer uses the compatible 1.0.6 signed OTA channel for subsequent mobile
code updates. Published campus content is fetched separately from the backend.

## Features

| Feature | Current implementation |
| --- | --- |
| Campus map | Main and Centennial campus basemaps, place and facility filters, zoom, foreground location, floor and entrance information, and place photos |
| Place search | Simplified and Traditional Chinese, English, abbreviations, pinyin, aliases, approximate input matching and category-based queries |
| Walking routes | Endpoint selection and swapping, schematic map connections, ordered instructions for published routes, and enlarged step photos |
| Student guide | Useful links, arrival information, food and social groups, built-in article readers, search, community posts, comments and likes |
| Ask HKU | Campus answers using places, routes, guides, administrator-uploaded reference material and public HKU webpages |
| Accounts | Registration, sign-in, profile editing, avatars, cover photos, password changes, recovery codes, notifications and submission history |
| Bookmarks and history | Per-account records synchronized with the backend, with local caching and queued changes |
| Contributions | New places, illustrated routes, food, groups and corrections, with review, revision requests, rejection and edits to published content |
| Languages | English, Simplified Chinese and Hong Kong Traditional Chinese in both the mobile app and administration interface |

Browsing the map and guide is public. Personal records and contributions require
an account. Published routes display reviewed instructions and photos. Built-in
demonstration routes include illustrative distances and steps; they are not
verified turn-by-turn navigation.

## Hosted backend and database

```text
Android APK or mobile app running from source
                    |
                 HTTPS API
                    |
          Django backend in Hong Kong
                    |
       PostgreSQL and controlled image storage
```

| Service | Address |
| --- | --- |
| Production API | `https://47.239.18.183` |
| Health check | <https://47.239.18.183/api/health/> |
| Administration | <https://47.239.18.183/admin/> |

**To see the same published places, photos, routes and posts as the production
APK, point the mobile source build at this same API.** The client communicates
with Django rather than connecting directly to PostgreSQL. Users do not need
cloud-console access or database credentials. Personal records remain scoped to
the signed-in account; administration requires separately authorized staff access.

A local backend uses SQLite by default. Migrations and `seed_guide` recreate the
repository's built-in content, not a complete copy of production uploads,
accounts, discussions or knowledge documents. Production database backups,
private credentials and signing keys are not included in this repository.

## Run the Android source

Install Node.js 24.x, npm, Android Studio, the Android SDK and a JDK supported by
the generated Gradle project. The isolated build checked on 26 November 2026 used
Node 24.13.0, JDK 25, Android SDK 37 and NDK 27.1.12297006. Python 3.12 is used for
the backend. Initial dependency installation and native builds require Internet.

Clone into a writable directory and open a terminal in the project root, where
`package.json` is located. On Windows, a short path such as
`C:\hku-review\HKU-Walk` helps avoid native C++ path-length limits.

```powershell
git clone https://github.com/bstsitong/HKU-Walk.git
cd HKU-Walk
npm ci
npm run locales:prepare
Set-Content -LiteralPath .env.local -Encoding ascii -Value 'EXPO_PUBLIC_API_URL=https://47.239.18.183'
```

You can also extract a source ZIP and begin with `npm ci`. The value above is a
public API origin; private model or database credentials do not belong in mobile
environment variables. `npm ci` installs the versions in `package-lock.json`.

### Generate and run a native project

In a fresh clone or extracted test copy, use a separate application ID and disable
production OTA downloads so the build keeps running the source being inspected:

```powershell
node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('app.json','utf8')); p.expo.android.package='com.hkuwalk.review'; p.expo.updates.enabled=false; fs.writeFileSync('app.json',JSON.stringify(p,null,2)+'\n');"
npx expo prebuild --platform android --no-install
```

These settings allow the source build to coexist with the production APK. They
do not change the selected API or copy a database. Production releases retain
`com.hkuwalk` and their signed OTA configuration. The native `android/` directory
is generated on the developer's machine.

If a Windows build encounters CMake path-length errors, add the following inside
`android { ... }` in the generated `android/app/build.gradle`. `projectRoot` is
already defined by the generated file:

```groovy
externalNativeBuild.cmake.buildStagingDirectory file(System.getProperty("java.io.tmpdir") + "/hku-review-cxx-" + Integer.toHexString(projectRoot.hashCode()))
defaultConfig {
    externalNativeBuild.cmake.arguments "-DCMAKE_OBJECT_PATH_MAX=245"
}
```

Start an emulator in Android Studio or connect a USB debugging-enabled phone,
then run from the project root:

```powershell
npx expo run:android
```

This builds and installs a development app and starts Metro. Keep Metro running
while using that development build. Expo Go and an Expo cloud-build account are
not required. `npm run android` starts the Expo development server and attempts
to open Android; it does not compile a standalone APK.

### Build a standalone test APK

After configuration and prebuild:

```powershell
cd android
.\gradlew.bat assembleRelease
cd ..
```

On macOS/Linux, use `./gradlew assembleRelease`. The generated file is
`android/app/build/outputs/apk/release/app-release.apk`. The freshly generated Expo
template uses a development signing key for this test release variant. It embeds
the JavaScript bundle and runs without Metro, while online features use the
selected backend. Production upgrades require the maintainer's signing key.

Set `ANDROID_HOME` and `JAVA_HOME` to the actual installations on your computer.
Install SDK components requested by Gradle and accept their licences. Expo's
online compatibility check may recommend newer patch versions than the locked
dependency set; dependency upgrades should be verified separately.

## Run a local backend

For independent backend development and moderation checks, install Python 3.12
and run from the project root:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r server/requirements.txt
.\Start-Backend.ps1
```

The script applies migrations, seeds built-in content, initializes a local
administrator and starts Django at `http://127.0.0.1:8000`. The default database
is `.local/hku-walk.sqlite3`. Randomly generated local administrator credentials
are written to `.local/admin-access.txt`. Repeated starts preserve existing local
accounts and edits. Open <http://127.0.0.1:8000/admin/> to manage local content.

To point the Android emulator at this local backend, set the following before
native generation and Metro startup:

```powershell
Set-Content -LiteralPath .env.local -Encoding ascii -Value 'EXPO_PUBLIC_API_URL=http://10.0.2.2:8000'
```

`10.0.2.2` is the Android emulator's address for its host computer. Development
builds support local HTTP. A standalone release APK using an HTTP backend also
needs an appropriate Android cleartext network configuration.

For a physical phone, use the computer's actual LAN IP, include it in
`DJANGO_ALLOWED_HOSTS`, bind Django to a reachable interface and allow the port
through the local firewall if needed. Both devices must be able to communicate.
See [phone testing notes](PHONE_TEST.md) for network setup and optional Expo Go
preview scripts; that document also contains historical test records.

On macOS/Linux, create the environment with `python3 -m venv .venv`, install with
`.venv/bin/python -m pip install -r server/requirements.txt`, and use
`.venv/bin/python server/manage.py` to run `migrate --noinput`, `seed_guide`,
`init_admin`, then `runserver 127.0.0.1:8000 --noreload`.

## Administration, knowledge and languages

Staff can maintain places, facilities, routes and guides, review contributions
and approve edits to published content. Submission states include pending,
approved, changes requested and rejected. Revision requests can be resubmitted;
rejected submissions are closed. A pending edit leaves the existing public
version visible until approval.

Staff can upload Word reference documents for Ask HKU. Original uploaded
documents and internal source pages require staff access; public answers expose
public source citations. A local environment can be populated with its own
documents. Clients connected to the hosted API use the existing hosted library.

Model keys are configured only on the backend. Use `DEEPSEEK_API_KEY`, or a
compatible provider through `ASSISTANT_API_BASE_URL`, `ASSISTANT_API_KEY` and
`ASSISTANT_MODEL`. Configuration is described in [deployment notes](deploy/README.md).
AI answers and related translations require a configured model service. Map,
account, contribution and built-in translation features can run independently.

Mobile and administration languages are selected independently. Editing fields
and stored records preserve the original text. Place introductions and published
route titles and steps translate with the interface language; community posts
translate when the user selects the translation control. Translation caches are
keyed by source revision and target language.

English system translations are maintained in `locales/*-en.json`; OpenCC
generates Hong Kong Traditional Chinese. `locales/messages.json` is generated.
Use `npm run locales:prepare` to generate and validate it, and
`npm run locales:check` to check coverage and synchronization. New features must
include all three languages; see [development conventions](AGENTS.md).

Built-in long-form guide translations are in `locales/guide-articles-en.json`,
with source revision hashes in `locales/guide-source-revisions.json`.
Administration translations are in `server/locale/*/LC_MESSAGES/django.po` and
the compiled `.mo` files. After editing those translations, use GNU gettext to
run `compilemessages` and commit both formats.

## Deployment and updates

| Change | Delivery |
| --- | --- |
| Edit public content or approve a contribution | Update the hosted database; the app reads it on refresh |
| Django API, permissions or database schema | Deploy the backend separately and apply migrations when required |
| Mobile code or assets compatible with the installed native runtime | Export and publish a signed OTA update |
| Native plugins, permissions, SDK or native configuration | Build, sign and distribute a new APK; adjust the runtime for compatibility |

`app.json` specifies app version `1.0.6`, Android version code `10`, and an
`appVersion` runtime policy. `StartupUpdate.tsx` checks matching signed updates
on Android release startup and skips development mode. The public update
certificate is `assets/android-update-certificate.cer`; release preparation uses
`scripts/prepare-android-update.mjs`. Signing private keys stay with maintainers.
Source test builds with updates disabled do not download production OTA code.

Pushing to GitHub, deploying the backend, publishing OTA and distributing an APK
are separate actions. `.github/workflows/check.yml` runs checks and does not
deploy production. For changes spanning the API and mobile client, deploy a
compatible backend first. See [deployment, storage and recovery notes](deploy/README.md).

## Source layout

| Path | Contents |
| --- | --- |
| Root `.tsx` and `.ts` files | Mobile screens, state, search, map and API clients |
| `assets/` and root JSON files | Images, map resources and bundled data |
| `locales/` | Mobile translations and guide translation revisions |
| `server/guide/` | Campus content, guides, discussions, assistant, knowledge and translations |
| `server/community/` | Accounts, contributions, moderation, image access, messages and personal records |
| `server/locale/` and `server/templates/` | Administration translations and templates |
| `scripts/` | Application checks, language validation and OTA preparation |
| `deploy/` and `Dockerfile` | Deployment, storage and backup/restore configuration |

## Checks and verification scope

After installing frontend and backend dependencies, run from the project root:

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

An isolated copy of source `1b90e50` passed fresh npm and Python installation,
type and language checks, frontend regression checks, 144 backend tests,
migration checks, local HTTP startup, Android export and an x86_64 release APK
build on 26 November 2026. The source-built app was subsequently launched in an
Android emulator and its hosted student guide was inspected. This is not a
physical-phone test. Current GitHub Actions results belong to their individual
commits and are available on the repository's Actions page.

## Data sources

Basemap roads and building outlines primarily use
[OpenStreetMap contributors, licensed under ODbL](https://www.openstreetmap.org/copyright).
Place, entrance, dining and facility information references the HKU
[campus map](https://www.estates.hku.hk/download_file/view_inline/674),
[University Street map](https://www.maps.hku.hk/downloads/201501hkumap.jpg),
[dining directory](https://catering.hku.hk/en/eateries/),
[accessibility information](https://www.estates.hku.hk/campus-information/campus-accessibility/wheelchair-friendly-routes-hku-main-estate)
and [parking information](https://www.estates.hku.hk/our-services/facility-management/parking/parking-space-location-and-parking-fee).
The app also displays reviewed community contributions. Individual records retain
their floor descriptions and any indication that a map position is approximate.
