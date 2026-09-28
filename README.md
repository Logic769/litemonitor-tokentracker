# LiteMonitor TokenTracker 插件

把 [TokenTracker](https://www.tokentracker.cc) 的 AI 编程 Token 用量显示到 **LiteMonitor** 的任务栏和面板上。

> 任务栏效果：`今日 15.0M` · `近7天 15.6M` · `近30天 813.6M` · `花费 $0.15`

## 功能

- 任务栏 / 面板实时显示 Token 用量与花费，60 秒刷新一次
- **显示类别可在 LiteMonitor 插件设置里按目标选择**：今日、今日总量（含缓存）、近 7 天、近 30 天、累计、近 7 天花费、累计花费
- 数字自动压缩成 `12.2M` / `813.6M` / `1.2B` 短格式，适合窄任务栏
- 超过阈值自动变色（黄 / 红），阈值可直接改 JSON
- 只访问本机回环地址，数据不出本机

## 环境要求

- [LiteMonitor](https://github.com/Diorser/LiteMonitor) v1.3.4 及以上（Windows）
- [TokenTracker](https://www.tokentracker.cc) 桌面端正在运行（提供本地服务 `http://127.0.0.1:17680`）
  - 也可使用命令行版：`npx tokentracker serve`（默认端口 `7680`），把插件里的「本地地址」改成对应端口即可

## 安装

1. 下载本仓库的 [`TokenTracker.json`](./TokenTracker.json)。
2. 放到 LiteMonitor 的插件目录：

   ```
   <LiteMonitor 安装目录>\resources\plugins\TokenTracker.json
   ```

3. 重启 LiteMonitor（或在插件管理页做一次「关闭 → 保存 → 启动」）。

## 启用与设置

1. 打开 LiteMonitor 设置 → **插件管理** → 找到 **Token 用量 (TokenTracker)**。
2. 打开启用开关。列表里若没有监控目标，点 **+ 添加新监控目标**。
3. 在该目标的 **显示类别** 下拉里选择要显示的内容：

   | 选项 | 含义 |
   | --- | --- |
   | 今日用量 | 今日计费 Token（默认） |
   | 今日总量 | 今日全部 Token（含缓存读取） |
   | 近 7 天用量 | 最近 7 天计费 Token（含今天） |
   | 近 30 天用量 | 最近 30 天计费 Token（含今天） |
   | 累计用量 | 有记录以来的全部计费 Token |
   | 近 7 天花费 | 最近 7 天花费（美元） |
   | 累计花费 | 有记录以来的全部花费（美元） |

4. 打开设置 → **监控项显示** → 勾选对应的 **任务栏**（以及是否在面板显示）。

想同时看多个指标：给同一个插件添加多个监控目标，每个目标选不同的「显示类别」，再分别勾选到任务栏。

## 配置项

| 配置项 | 作用域 | 默认值 | 说明 |
| --- | --- | --- | --- |
| TokenTracker 本地地址 | 全局 | `http://127.0.0.1:17680` | TokenTracker 桌面端本地服务；CLI 版一般填 `http://127.0.0.1:7680` |
| 统计时区 | 全局 | `Asia/Shanghai` | 「今日」按该时区计算。TokenTracker 接口默认按 UTC 分日，带时区才能与本地日期一致 |
| 显示类别 | 每个目标 | 今日用量 | 见上表 |

## 输出项

启用后插件会注册 5 个监控项，可自由勾选：

| 输出 Key | 默认名称 | 内容 |
| --- | --- | --- |
| `main` | 跟随显示类别 | 按「显示类别」选择的指标 |
| `today` | 今日 Token | 今日计费 Token |
| `week` | 近 7 天 Token | 近 7 天计费 Token |
| `month` | 近 30 天 Token | 近 30 天计费 Token |
| `cost` | 近 7 天花费 | 近 7 天累计花费 |

## 颜色阈值

颜色由 JSON 里的 `threshold_switch` 控制，改完重启 LiteMonitor 生效：

| 指标 | 黄色 | 红色 |
| --- | --- | --- |
| 今日用量 | ≥ 3,000 万 | ≥ 1 亿 |
| 近 7 天用量 | ≥ 1.5 亿 | ≥ 5 亿 |
| 近 30 天用量 | ≥ 5 亿 | ≥ 15 亿 |
| 近 7 天花费 | ≥ $1 | ≥ $5 |

累计用量、累计花费固定绿色（累计值很大，做阈值没有意义）。

## 工作原理

插件按 `execution.interval`（默认 60 秒）发起两次本机请求：

```
GET {base_url}/functions/tokentracker-usage-heatmap?weeks=1&tz=Asia/Shanghai
GET {base_url}/functions/tokentracker-usage-summary?tz=Asia/Shanghai&from=&to=2999-12-31
```

- 第一个接口返回最近 7 天逐日数据，最后一个单元格即「今日」，插件用正则从数组文本里取出今日数值，同时得到近 7 天花费。
- 第二个接口返回滚动窗口（近 7 天 / 近 30 天）与累计汇总。

两个请求都走 `127.0.0.1`，不联网、不上传任何数据。

## 自检脚本

`tools/verify-plugin.js` 用与 LiteMonitor 插件引擎（`PluginProcessor` / `PluginExecutor`）等价的解析与变换逻辑，对真实接口跑一遍所有「显示类别」，用于验证提取路径、正则和格式化是否正确：

```bash
node tools/verify-plugin.js
```

前提：本机 TokenTracker 正在运行。全部通过时会输出每种显示类别的最终显示文本。

## 常见问题

**任务栏显示问号 / 错误符号？**
TokenTracker 桌面端没有运行，本地服务没有监听。启动 TokenTracker 后会自动恢复。可在浏览器打开 `http://127.0.0.1:17680/functions/tokentracker-usage-summary` 验证服务是否正常。

**今日数字不更新？**
TokenTracker 需要先同步会话数据（按会话文件增量统计）。等它同步一轮，或打开一次 TokenTracker 仪表盘。

**改了 JSON 没生效？**
插件模板在启动时扫描，重启 LiteMonitor 或在插件管理页做一次「关闭 → 保存 → 启动」。

**卸载**
删除 `resources\plugins\TokenTracker.json`，重启 LiteMonitor。

## License

[MIT](./LICENSE)

---

### English

A [LiteMonitor](https://github.com/Diorser/LiteMonitor) plugin that shows [TokenTracker](https://www.tokentracker.cc) AI coding token usage and cost in the Windows taskbar. Drop `TokenTracker.json` into `<LiteMonitor>\resources\plugins\`, restart LiteMonitor, then enable the plugin and pick a display category (today / 7-day / 30-day / all-time / cost). It only talks to TokenTracker's local API on `127.0.0.1`.
