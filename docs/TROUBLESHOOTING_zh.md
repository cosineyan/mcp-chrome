## 🚀 安装和连接问题

### 快速诊断

运行诊断工具来识别常见问题：

```bash
mcp-chrome-bridge doctor
```

自动修复常见问题：

```bash
mcp-chrome-bridge doctor --fix
```

### 导出诊断报告

如果需要提交 Issue，可以导出诊断报告：

```bash
# 打印 Markdown 报告到终端（复制粘贴到 GitHub Issue）
mcp-chrome-bridge report

# 写入到文件
mcp-chrome-bridge report --output mcp-report.md

# 直接复制到剪贴板
mcp-chrome-bridge report --copy
```

默认情况下，用户名、路径和令牌会被脱敏。如果你需要提供完整路径，可以使用 `--no-redact`。

### 常见问题

#### 连接成功，但是服务启动失败

启动失败基本上都是**权限问题**或者用包管理工具安装的**node**导致的启动脚本找不到对应的node。

**推荐先运行诊断工具：**

```bash
mcp-chrome-bridge doctor
```

核心排查流程

1. npm包全局安装后，确认清单文件com.chromemcp.nativehost.json的位置，里面有一个**path**字段，指向的是一个启动脚本:

1.1 **检查mcp-chrome-bridge是否安装成功**，确保是**全局安装**的

```bash
mcp-chrome-bridge -V
```

<img width="612" alt="截屏2025-06-11 15 09 57" src="https://github.com/user-attachments/assets/59458532-e6e1-457c-8c82-3756a5dbb28e" />

1.2 **检查清单文件是否已放在正确目录**

windows路径：C:\Users\xxx\AppData\Roaming\Google\Chrome\NativeMessagingHosts

mac路径： /Users/xxx/Library/Application\ Support/Google/Chrome/NativeMessagingHosts

如果npm包安装正常的话，这个目录下会生成一个`com.chromemcp.nativehost.json`

```json
{
  "name": "com.chromemcp.nativehost",
  "description": "Node.js Host for Browser Bridge Extension",
  "path": "/Users/xxx/Library/pnpm/global/5/.pnpm/mcp-chrome-bridge@1.0.23/node_modules/mcp-chrome-bridge/dist/run_host.sh",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://hbdgbgagpkpjffpklnamcljpakneikee/"]
}
```

> 如果发现没有此清单文件，可以尝试命令行执行：`mcp-chrome-bridge register`

2. **检查日志**

日志现在存储在用户可写目录：

- **macOS**: `~/Library/Logs/mcp-chrome-bridge/`
- **Windows**: `%LOCALAPPDATA%\mcp-chrome-bridge\logs\`（例如 `C:\Users\xxx\AppData\Local\mcp-chrome-bridge\logs\`）
- **Linux**: `~/.local/state/mcp-chrome-bridge/logs/`

<img width="804" alt="截屏2025-06-11 15 09 41" src="https://github.com/user-attachments/assets/ce7b7c94-7c84-409a-8210-c9317823aae1" />

3. 一般失败的原因就是两种

3.1. run_host.sh(windows是run_host.bat)没有执行权限：运行以下命令修复：

```bash
mcp-chrome-bridge fix-permissions
```

3.2. 脚本找不到node：如果你使用 Node 版本管理工具（nvm、volta、asdf、fnm），可以设置 `CHROME_MCP_NODE_PATH` 环境变量：

```bash
export CHROME_MCP_NODE_PATH=/path/to/your/node
```

或者运行 `mcp-chrome-bridge doctor --fix` 来写入当前 Node 路径。

#### macOS：连接后报 "Native host has exited"，退出码 126

**现象**：点击插件弹窗的 Connect 按钮后，控制台出现 "Native host has exited."，日志文件中显示：

```
bash: /opt/homebrew/.../run_host.sh: Operation not permitted
```

或者 run_host 脚本以退出码 126 退出。

**原因**：在 macOS 上，Chrome 的进程树受到 TCC（透明度、同意与控制）沙箱限制。Chrome 通过 `bash` 启动 Native Messaging Host 时，macOS 会阻止执行位于 `/opt/homebrew/` 或 `~/Documents/` 等路径下的 shell 脚本，返回 "Operation not permitted"。这**不是**文件权限问题（`chmod 755` 无法修复），而是基于路径的安全策略。

| 路径                                                                | 结果                                 |
| ------------------------------------------------------------------- | ------------------------------------ |
| `/opt/homebrew/lib/node_modules/mcp-chrome-bridge/dist/run_host.sh` | ❌ exit 126，Operation not permitted |
| `~/Documents/.../run_host.sh`                                       | ❌ exit 126，Operation not permitted |
| `~/Library/Application Scripts/mcp-chrome-bridge/run_host.sh`       | ✅ 正常执行                          |

**解决方案**：重新运行 register 命令。从修复版本起，`mcp-chrome-bridge register` 会自动在 `~/Library/Application Scripts/mcp-chrome-bridge/` 下创建启动目录，并将清单指向该路径。

```bash
mcp-chrome-bridge register
```

如需手动恢复，执行以下命令：

```bash
LAUNCHER_DIR="$HOME/Library/Application Scripts/mcp-chrome-bridge"
DIST_DIR="/opt/homebrew/lib/node_modules/mcp-chrome-bridge/dist"   # 按实际路径调整

mkdir -p "$LAUNCHER_DIR"
cp "$DIST_DIR/run_host.sh" "$LAUNCHER_DIR/"
cp "$DIST_DIR/node_path.txt" "$LAUNCHER_DIR/"
chmod 755 "$LAUNCHER_DIR/run_host.sh"

# 写入代理 index.js，让真实 index.js 内部的相对路径仍能正确解析
echo "\"use strict\"; require('$DIST_DIR/index.js');" > "$LAUNCHER_DIR/index.js"
```

然后将清单文件的 `path` 字段更新为 `~/Library/Application Scripts/mcp-chrome-bridge/run_host.sh`。

---

#### 本地开发：注册 Dev 扩展 ID

在开发者模式下加载未打包的 Chrome 扩展时，Chrome 会随机分配一个扩展 ID。Native Messaging Host 清单中的 `allowed_origins` 必须包含这个 ID，否则连接会被拒绝。

**第一步**：在 `chrome://extensions` 页面（开启开发者模式）找到你的扩展 ID。

**第二步**：用 `--extension-id` 参数注册：

```bash
mcp-chrome-bridge register --extension-id <你的开发扩展ID>
```

**第三步**（可选，固定 ID）：在 `app/chrome-extension/.env.local` 中设置 `CHROME_EXTENSION_KEY`，将一个固定公钥写入扩展 manifest，这样无论从哪个路径加载，Chrome 都会分配相同的扩展 ID。

---

包装器日志现在存储在用户可写的位置：

- **macOS**: `~/Library/Logs/mcp-chrome-bridge/`
- **Windows**: `%LOCALAPPDATA%\mcp-chrome-bridge\logs\`
- **Linux**: `~/.local/state/mcp-chrome-bridge/logs/`

#### 工具执行超时

有可能长时间连接的时候session会超时，这个时候重新连接即可

#### 效果问题

不同的agent，不同的模型使用工具的效果是不一样的，这些都需要你自行尝试，我更推荐用聪明的agent，比如augment，claude code等等...
