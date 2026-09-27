# 发布预构建包到 GitHub Releases

本文档说明如何将 `mcp-chrome-bridge` 打包为可直接使用的预构建包并发布到 GitHub Releases。

## 发布产物

每次发版产出两个文件：

| 文件                    | 说明                                  | 大小    |
| ----------------------- | ------------------------------------- | ------- |
| `mcp-chrome-bridge.tgz` | 预构建 Node.js 包（dist/ + 生产依赖） | ~16MB   |
| `mcp-chrome-plugin.tgz` | Chrome 扩展（Load Unpacked 用）       | ~几百KB |

用户下载后只需 `tar -xzf` + `npm link`，无需克隆仓库、无需 pnpm、无需执行构建。仍需要 Node.js >= 20 运行。

## 打包原理

`pack-bridge.sh` 脚本执行以下步骤：

1. **构建 TypeScript** → `dist/`
2. **内联 workspace 包** — `chrome-mcp-shared`（`workspace:*` 协议无法通过 npm 解析）直接复制到 `node_modules/`
3. **生成干净的 `package.json`** — 移除 `devDependencies`、`pkg` 配置、开发脚本
4. **安装生产依赖** — `npm install --production`（真实文件，非 pnpm 符号链接）
5. **裁剪不必要的大文件**：
   - `chrome-devtools-frontend`（~77MB）— 仅 trace-analyzer 使用，非核心功能
   - `@img/sharp-*`（~15MB）— 图像处理，native-server 不使用
   - `@anthropic-ai/claude-agent-sdk/vendor/ripgrep/` — 仅保留当前平台的 rg 二进制，删除其他 4 个平台（节省 ~40MB）
   - `sql.js/dist/` — 仅保留 `sql-wasm.js` + `sql-wasm.wasm`，删除 debug/asm/browser 变体（节省 ~20MB）
   - `@types/` — 运行时不需要
6. **打包 tgz** — `tar -czf mcp-chrome-bridge.tgz mcp-chrome-bridge/`

最终从 163MB 压缩到 16MB。

## 方式一：GitHub Actions 自动发版（推荐）

`.github/workflows/release-native-server.yml` 在以下情况自动构建并发布：

### 方式 1a：推送 Tag 触发

```bash
git tag v1.0.6
git push origin v1.0.6
```

Actions 自动：

1. 在 `macos-latest` Runner 上构建 shared 包、Chrome 扩展、bridge tgz
2. 创建对应 Tag 的 GitHub Release 并上传两个 tgz

### 方式 1b：手动触发（无需 Tag）

1. 打开 https://github.com/cosineyan/mcp-chrome/actions/workflows/release-native-server.yml
2. 点击 **Run workflow**
3. 填写 Tag 名称（如 `v1.0.6`）
4. 点击 **Run workflow**

## 方式二：本地手动打包

### 1. 打包 bridge tgz

```bash
# 从仓库根目录
pnpm --filter mcp-chrome-bridge pack:release

# 或从 app/native-server 目录
bash scripts/pack-bridge.sh
```

如果 `dist/` 已经是最新（刚执行过 `npm run build`），可以跳过构建：

```bash
bash scripts/pack-bridge.sh --no-build
```

输出：`releases/mcp-chrome-bridge.tgz`

### 2. 打包 Chrome 扩展 tgz

```bash
cd app/chrome-extension && pnpm build && cd ../..
tar -czf releases/mcp-chrome-plugin.tgz -C app/chrome-extension/.output/chrome-mv3 .
```

### 3. 发布到 GitHub Release

```bash
# 创建 Release 并上传
gh release create v1.0.6 \
  releases/mcp-chrome-bridge.tgz \
  releases/mcp-chrome-plugin.tgz \
  --title "v1.0.6" \
  --notes "Release notes here"
```

或在已有 Release 上追加/替换文件：

```bash
gh release upload v1.0.6 releases/mcp-chrome-bridge.tgz --clobber
```

### 4. 验证下载

```bash
curl -fsSL -o /tmp/mcp-chrome-bridge.tgz \
  https://github.com/cosineyan/mcp-chrome/releases/latest/download/mcp-chrome-bridge.tgz
tar -xzf /tmp/mcp-chrome-bridge.tgz -C /tmp
cd /tmp/mcp-chrome-bridge && node dist/cli.js --version
```

## 用户安装体验

```bash
# 1. 下载预构建包
curl -fsSL \
  "https://github.com/cosineyan/mcp-chrome/releases/latest/download/mcp-chrome-bridge.tgz" \
  -o /tmp/mcp-chrome-bridge.tgz

# 2. 解压并全局链接
mkdir -p "$HOME/mcp-chrome-bridge"
tar -xzf /tmp/mcp-chrome-bridge.tgz --strip-components=1 -C "$HOME/mcp-chrome-bridge"
cd "$HOME/mcp-chrome-bridge" && npm link

# 3. 注册 Native Messaging Host
mcp-chrome-bridge register --force

# 4. 验证
mcp-chrome-bridge --version   # → 1.0.29
```

无需 git、无需 pnpm、无需编译。仅需 Node.js >= 20。

## 相关文件

| 文件                                              | 说明                                    |
| ------------------------------------------------- | --------------------------------------- |
| `app/native-server/scripts/pack-bridge.sh`        | 打包脚本，输出 `mcp-chrome-bridge.tgz`  |
| `app/native-server/scripts/build-release.sh`      | 旧版 pkg 独立二进制打包脚本（保留备用） |
| `app/native-server/package.json` → `pack:release` | npm script 入口                         |
| `.github/workflows/release-native-server.yml`     | CI 自动发版工作流                       |
| `releases/`                                       | 本地打包输出目录（已加入 `.gitignore`） |

## 注意事项

- **tgz 不进 git**：`releases/` 已在 `.gitignore` 中
- **ripgrep 平台裁剪**：本地打包只保留当前平台的 rg 二进制。CI 在 macOS Runner 上运行，因此只保留 `arm64-darwin`。Intel Mac 用户需要 Agent 功能时可能需要从源码构建
- **Node.js 版本**：用户需要 Node.js >= 20。`run_host.sh` 会自动检测系统 Node.js 路径
- **重新打包时机**：依赖升级（尤其是 `sql.js`、`@anthropic-ai/claude-agent-sdk`）后需重新打包并发版
