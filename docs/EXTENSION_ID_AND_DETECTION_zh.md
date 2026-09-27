# 扩展 ID 确定化 & 安装检测(改代码前必读)

> 目的:消除"手动 Load unpacked → 抄扩展 ID → 用该 ID 启动后台"这一步的痛点,并给出安全检测"扩展是否已安装"的手段。
> 本文是调研结论 + 实测记录,方便下次改代码时直接参照。最后更新:2026-09-27。

---

## 1. 问题本质:扩展 ID 只在一个地方被用到

后台(native messaging host)需要知道扩展 ID,唯一用途是写进 manifest 的 `allowed_origins`,授权"哪个扩展可以连我"。

- 硬编码默认值:[`app/native-server/src/scripts/constant.ts:2`](../app/native-server/src/scripts/constant.ts)
  ```ts
  export const EXTENSION_ID = 'hbdgbgagpkpjffpklnamcljpakneikee';
  ```
- 实际写入 manifest 的唯一位置:[`app/native-server/src/scripts/utils.ts:299`](../app/native-server/src/scripts/utils.ts)
  ```ts
  allowed_origins: [`chrome-extension://${extensionId ?? EXTENSION_ID}/`],
  ```
- CLI 允许覆盖:[`app/native-server/src/cli.ts:29`](../app/native-server/src/cli.ts)
  ```
  -e, --extension-id <id>   Override extension ID (useful for local dev builds)
  ```

> Load unpacked 的扩展 ID 由 Chrome 从**公钥**推导。没有固定 `key` 时,ID 依机器/profile 而变,所以每台机器 register 都要重新抄 ID —— 这就是痛点根源。

---

## 2. 一劳永逸方案:固定 `key` → 确定性 ID

`wxt.config.ts` **已经支持**从环境变量注入 `key`,只是没设置:

- [`app/chrome-extension/wxt.config.ts:13`](../app/chrome-extension/wxt.config.ts) `const CHROME_EXTENSION_KEY = process.env.CHROME_EXTENSION_KEY;`
- [`app/chrome-extension/wxt.config.ts:36`](../app/chrome-extension/wxt.config.ts) `key: CHROME_EXTENSION_KEY,`

落地步骤(下次改代码时做):

1. **生成 RSA 密钥对**,导出 manifest 用的 base64 公钥:
   ```bash
   openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out key.pem
   # manifest 里 key 字段要的是 SubjectPublicKeyInfo 的 base64(去掉换行)
   openssl rsa -in key.pem -pubout -outform DER 2>/dev/null | base64 | tr -d '\n'
   ```
2. **算出确定性扩展 ID**(公钥 DER 的 SHA256 前 16 字节,按 a–p 映射):
   ```bash
   openssl rsa -in key.pem -pubout -outform DER 2>/dev/null \
     | openssl dgst -sha256 -binary \
     | head -c16 | xxd -p -c256 \
     | tr '0-9a-f' 'a-p'
   ```
3. 构建时注入:`CHROME_EXTENSION_KEY=<base64公钥> npx wxt build`
4. 把算出的 ID 更新到 [`constant.ts:2`](../app/native-server/src/scripts/constant.ts) 的 `EXTENSION_ID`。
5. 之后 `mcp-chrome-bridge register` **无需再传 `--extension-id`**;换机器 / 重建,ID 都不变,Load unpacked 一辈子只手动做一次。

---

## 3. 检测"扩展是否已安装"(两级,越省事越靠前)

用途:只有在"确实没装"时,才去引导 / 自动打开管理页面;装了但没连,应引导重连而不是重装。

> 现成脚本:[`scripts/detect-mcp-chrome.py`](../scripts/detect-mcp-chrome.py)
> 输出 `ready` / `installed-not-running` / `not-installed`(退出码 0 / 1 / 2;`--json` 出结构化结果并反查扩展 ID)。
>
> ```bash
> python3 scripts/detect-mcp-chrome.py --json
> # {"status": "ready", "code": 0}
> python3 scripts/detect-mcp-chrome.py --json --port 65500   # 模拟 ping 断
> # {"status": "installed-not-running", "code": 1, "id": "...", "path": "...", "profile": "Default"}
> ```
>
> 下面两节是脚本内部逻辑说明,便于以后维护。

### 第 1 级 —— 端口探活(最快、最准的"就绪"信号)

```bash
curl -s --max-time 2 http://127.0.0.1:12306/ping   # → {"status":"ok","message":"pong"}
```

- 通 ⇒ 扩展已装 **且** service worker 已连上 native host ⇒ 一切就绪,什么都不用做。
- 几毫秒,不碰 Chrome、不弹窗、不抢焦点。
- ⚠️ 坑:MV3 service worker 空闲 5 分钟休眠 → native host 退出 → 端口不通。**所以 ping 不通 ≠ 没装**,需第 2 级区分。

### 第 2 级 —— 只读 Secure Preferences(区分"装了没跑" vs "真没装")

Chrome(macOS)把扩展信息存在带 HMAC 防篡改的 **`Secure Preferences`** 里,**不是** `Preferences`。
关键实测结论:**unpacked 扩展在这里不缓存 `manifest.name`(显示 "(no manifest)"),但 `path` 字段是准的** —— 所以按"加载目录"匹配,而不是按名字或 ID(ID 现在还不固定,反而能从命中项的 key 里反查出来)。

```python
import json, os, glob

PLUGIN_DIRS = {  # 你 Load unpacked 用的目录,按需增删
    "/Users/I517429/mcp-chrome/app/chrome-extension/.output/chrome-mv3",
    os.path.expanduser("~/Downloads/mcp-chrome-plugin"),
}

def find_mcp_extension():
    base = os.path.expanduser("~/Library/Application Support/Google/Chrome")
    # 遍历所有 profile(Default / Profile 1 / ...)
    for pref in glob.glob(os.path.join(base, "*", "Secure Preferences")):
        settings = json.load(open(pref)).get("extensions", {}).get("settings", {})
        for ext_id, meta in settings.items():
            # location==4 表示 LOAD_UNPACKED
            if meta.get("location") == 4 and meta.get("path") in PLUGIN_DIRS:
                return {"installed": True, "id": ext_id, "path": meta["path"]}
    return {"installed": False}
```

`location` 取值速查:`1`=内部/CWS、`4`=unpacked、`5`=组件、`7`=外部策略、`10`=CWS 支付组件。

### 决策表

| ping    | Secure Prefs 命中 | 结论              | 动作                                                                              |
| ------- | ----------------- | ----------------- | --------------------------------------------------------------------------------- |
| ✅ 通   | —                 | 已装且在跑        | 什么都不做                                                                        |
| ❌ 不通 | ✅ 命中           | 装了,SW 休眠/没连 | `pkill -f mcp-chrome-bridge/index.js` 后引导点扩展 **Connect**;**不要**打开管理页 |
| ❌ 不通 | ❌ 没命中         | 真没装            | **这时才**触发引导 / 自动打开 chrome://extensions                                 |

### 安全要点

- **全程只读**。检测不需要 Chrome 自动化、不需要 Accessibility 权限、不弹窗、不抢焦点。
- **绝不写** `Preferences` / `Secure Preferences`:它们带 HMAC 签名(`protection.macs`),一改 Chrome 就判定被篡改,会重置/禁用相关扩展。
- 上了第 2 节的固定 `key` 后,第 2 级可简化为直接查 `settings[<固定ID>]` 是否存在。

---

## 4. "自动打开管理页面 + 自动点 Load unpacked" 的可行性(实测)

结论:**打开页面可行且可靠,自动点按钮这一半不可靠**,不建议作为默认路径。

| 步骤                         | 结果    | 说明                                                                     |
| ---------------------------- | ------- | ------------------------------------------------------------------------ |
| 自动打开 chrome://extensions | ✅ 可靠 | `osascript` 设 `URL of active tab`,开发者模式 / Load unpacked 都正常渲染 |
| 截图确认状态                 | ✅ 可靠 | `screencapture -x` 在 OS 层截,绕过 Chrome "特殊页面不能截图"             |
| 点 "Load unpacked" 按钮      | ❌ 卡住 | 见下                                                                     |

自动点击卡在两点:

1. **chrome://extensions 是 WebUI Shadow DOM**,"Load unpacked" 按钮**不在 macOS 无障碍树**里 ⇒ 无法按 UI 元素名点,只能按屏幕坐标点(依赖窗口位置/大小、Retina 缩放、Chrome 版本,极脆弱)。
2. 本次在 agent 执行上下文中,`System Events` 的**合成键盘事件能用**(`keystroke`/`key code` 成功,Cmd+F 弹出查找栏),但**坐标鼠标点击** `click at {x,y}` **一直报 `-609 "Connection is invalid"`**(重启 System Events、`launchctl asuser` 塞进 GUI 会话都无效)。
   - `-609` 与执行上下文相关:用户自己在 **Terminal.app**(有完整 Aqua 会话 + 已授权 Accessibility)跑 `install.sh` 时,`click at` 通常能成;但依旧脆弱。

Retina 坐标换算备忘:`screencapture` 出的是物理像素;`System Events` 用逻辑点。逻辑 = 物理 ÷ 2。本机屏 3024×1964(物理)= 1512×982(逻辑)。

**推荐**:固定 `key` + 手动 Load unpacked 一次为主方案;UI 自动化因坐标脆弱 + 环境 `-609`,不作为默认路径。

---

## 5. 相关文件索引

| 文件                                                                                             | 作用                                                      |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| [`app/native-server/src/scripts/constant.ts`](../app/native-server/src/scripts/constant.ts)      | 硬编码 `EXTENSION_ID` / `HOST_NAME`                       |
| [`app/native-server/src/scripts/utils.ts`](../app/native-server/src/scripts/utils.ts)            | `createManifestContent()` — 写 `allowed_origins` 的唯一处 |
| [`app/native-server/src/cli.ts`](../app/native-server/src/cli.ts)                                | `register --extension-id` 覆盖入口                        |
| [`app/chrome-extension/wxt.config.ts`](../app/chrome-extension/wxt.config.ts)                    | 已支持 `CHROME_EXTENSION_KEY` 注入固定 `key`(未设置)      |
| `~/Library/Application Support/Google/Chrome/Default/Secure Preferences`                         | 扩展安装状态真源(只读)                                    |
| `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.chromemcp.nativehost.json` | register 写出的 host manifest                             |
