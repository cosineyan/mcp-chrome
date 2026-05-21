# 发布预编译二进制到 GitHub Releases

本文档说明如何将 `mcp-chrome-bridge` 原生服务器打包为 macOS 独立可执行文件并发布，使用户无需克隆仓库即可安装。

## 原理

使用 `@yao-pkg/pkg` 将 Node.js 应用（含运行时）打包成单一可执行文件。  
`better-sqlite3` 是 C++ 原生 addon，pkg 会在二进制首次运行时将 `.node` 文件自解压到 `~/.cache/pkg/`，用户无感知。

输出两个文件上传到 GitHub Releases：

- `mcp-chrome-bridge-macos-arm64`（Apple Silicon）
- `mcp-chrome-bridge-macos-x64`（Intel）

> **注意**：`@yao-pkg/pkg` 在打包时需要从 github.com 下载预编译的 Node.js 运行时。  
> 如果本地网络无法访问 github.com（如企业内网），请使用下面的 **GitHub Actions 自动发版**方式，
> 而不是手动本地打包。

## 方式一：GitHub Actions 自动发版（推荐）

`.github/workflows/release-native-server.yml` 会在以下两种情况自动构建并发布：

### 方式 1a：推送 Tag 触发

```bash
git tag v1.0.30
git push origin v1.0.30
```

Actions 会自动：

1. 在 `macos-latest` Runner 上构建两个二进制
2. 创建对应 Tag 的 GitHub Release 并上传二进制

### 方式 1b：手动触发（无需 Tag）

1. 打开 https://github.com/cosineyan/mcp-chrome/actions/workflows/release-native-server.yml
2. 点击 **Run workflow**
3. 填写 Tag 名称（如 `v1.0.30`）
4. 点击 **Run workflow**

## 方式二：本地手动打包（需要 github.com 可访问）

### 1. 打包二进制

```bash
pnpm --filter mcp-chrome-bridge build:release
```

等价于（手动执行）：

```bash
cd app/native-server
bash scripts/build-release.sh
```

输出位置：

```
releases/native-server/
├── mcp-chrome-bridge-macos-arm64   (~80-100MB)
└── mcp-chrome-bridge-macos-x64    (~80-100MB)
```

### 2. 在 GitHub 创建 Release

1. 打开 https://github.com/cosineyan/mcp-chrome/releases/new
2. 填写 Tag（如 `v1.0.30`）和 Release title
3. 上传以下文件：
   - `releases/native-server/mcp-chrome-bridge-macos-arm64`
   - `releases/native-server/mcp-chrome-bridge-macos-x64`
4. 点击 **Publish release**

### 3. 验证下载链接

Release 发布后，下载链接格式为：

```
https://github.com/cosineyan/mcp-chrome/releases/latest/download/mcp-chrome-bridge-macos-arm64
https://github.com/cosineyan/mcp-chrome/releases/latest/download/mcp-chrome-bridge-macos-x64
```

可用 curl 验证：

```bash
curl -fsSL -o /tmp/test-binary \
  https://github.com/cosineyan/mcp-chrome/releases/latest/download/mcp-chrome-bridge-macos-arm64
chmod +x /tmp/test-binary
/tmp/test-binary --version
```

## 用户安装体验

Release 发布后，用户运行 `install.sh` 时会自动：

1. 检测 CPU 架构（arm64 / x86_64）
2. 从 GitHub Releases 下载对应二进制到 `releases/native-server/`
3. 执行 `mcp-chrome-bridge register --extension-id <id>` 完成注册

用户无需安装 Node.js、无需克隆仓库。

### Fallback 机制

`install.sh` 的优先顺序：

| 顺序 | 条件                                         | 行为                       |
| ---- | -------------------------------------------- | -------------------------- |
| 1    | `releases/native-server/<binary>` 本地已存在 | 直接使用                   |
| 2    | GitHub Releases 可访问                       | 下载后使用                 |
| 3    | 下载失败（未发版 / 无网络）                  | 从源码 build（需 Node.js） |

强制从源码构建：

```bash
./install.sh --local-build
```

## 相关文件

| 文件                                               | 说明                                       |
| -------------------------------------------------- | ------------------------------------------ |
| `app/native-server/scripts/build-release.sh`       | 打包脚本，输出两个 macOS 二进制            |
| `app/native-server/package.json` → `build:release` | npm script 入口                            |
| `app/native-server/package.json` → `pkg`           | pkg 配置（assets、scripts）                |
| `install.sh`                                       | 安装脚本，含下载 + fallback 逻辑           |
| `releases/native-server/`                          | 本地打包输出目录（gitignore 中排除大文件） |

## 注意事项

- **二进制不进 git**：`releases/native-server/` 下的二进制文件较大，建议加入 `.gitignore`
- **Node 版本**：pkg 目标为 `node22`，与项目 `engines.node >= 20` 兼容；如升级 Node 主版本需同步更新 `build-release.sh` 中的 target
- **重新打包时机**：依赖（尤其是 `better-sqlite3`）升级后需重新打包并发版
