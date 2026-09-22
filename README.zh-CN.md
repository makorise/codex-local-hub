# Codex Local Hub · Codex 随身工作台

[English](README.md) · 简体中文

**把 Mac 上的 Codex 任务变成一个可在手机上查看和控制的本地工作台。**

[![License: MIT](https://img.shields.io/badge/license-MIT-2563eb.svg)](LICENSE)
[![CI](https://github.com/brandonwang001/codex-local-hub/actions/workflows/ci.yml/badge.svg)](https://github.com/brandonwang001/codex-local-hub/actions/workflows/ci.yml)
![macOS 15+](https://img.shields.io/badge/macOS-15%2B-111827.svg)
![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-16a34a.svg)
![测试覆盖率](https://img.shields.io/badge/coverage-100%25-16a34a.svg)

Codex Local Hub 是一个开源的 **Codex 手机控制台、任务监控器和 macOS 远程助手**。打开 Mac 客户端，扫描二维码，即可在同一局域网内查看任务进度、最近对话、长程目标和图片交付结果，并从手机继续发送提示词。

> 本项目是独立开源项目，与 OpenAI 没有隶属或官方背书关系。

## 复制一句话，让 Codex 完成安装

普通用户不需要先研究终端命令。请在作为宿主机的 Mac 上打开一个 Codex 任务，把下面整段话复制进去：

```text
使用 $skill-installer 从 https://github.com/brandonwang001/codex-local-hub/tree/main/.agents/skills/setup-codex-local-hub 安装 setup-codex-local-hub Skill。安装后请立即读取已安装的 SKILL.md，并在这个任务中按它完成：在这台 Mac 上安装或更新 Codex Local Hub、安装图片交付 Skill、启动程序并验证手机的局域网访问。优先使用最新正式版；没有合适的正式版时就从源码构建。除非确实有一步必须由我操作，否则请自主继续；最后只需要告诉我程序安装位置、访问方式和验证结果。
```

这一句话会让 Codex 安装可复用的 [`setup-codex-local-hub`](.agents/skills/setup-codex-local-hub) Skill，并立即完成后续工作。这个 Skill 会保持 Gatekeeper 开启、保护已有文件、运行完整测试、验证应用、安装图片交付 Skill；它不会擅自把本地服务暴露到公网。

## 运行效果

### 1. 在 Mac 上启动服务

<p align="center">
  <img src="docs/assets/screenshots/mac-host.zh-CN.png" width="720" alt="Codex 随身工作台 Mac 宿主程序，展示服务状态、安全配对占位图、局域网地址和启动控制">
</p>
<p align="center"><strong>Mac 宿主程序</strong>：启动本地服务、配对手机并打开工作台</p>

### 2. 在主页总览全部任务

<p align="center">
  <img src="docs/assets/screenshots/desktop-home.zh-CN.png" width="920" alt="Codex 随身工作台主页，展示用量、任务数量、筛选项、任务状态，以及尚未选择任务时的对话区域">
</p>
<p align="center"><strong>工作台主页</strong>：用量、正在进行、等待处理和已完成任务一目了然</p>

### 3. 进入具体任务并继续对话

<p align="center">
  <img src="docs/assets/screenshots/desktop-dashboard.zh-CN.png" width="920" alt="Codex 随身工作台任务页面，展示选中的任务、最近对话、目标状态、队列数量、最后问题和消息输入框">
</p>
<p align="center"><strong>任务对话</strong>：查看最近可见消息、目标和队列，再发送下一条提示词</p>

### 4. 在手机上完成同样的操作

<table>
  <tr>
    <td width="50%"><img src="docs/assets/screenshots/mobile-dashboard.zh-CN.png" width="100%" alt="Codex 随身工作台手机主页，展示当前用量和任务状态"></td>
    <td width="50%"><img src="docs/assets/screenshots/mobile-conversation.zh-CN.png" width="100%" alt="Codex 随身工作台手机任务页面，展示最近消息、目标状态、队列数量、最后问题和消息输入框"></td>
  </tr>
  <tr>
    <td align="center"><strong>手机主页</strong>：从紧凑的任务面板中选择任务</td>
    <td align="center"><strong>手机对话</strong>：单手查看进度并发送下一条提示词</td>
  </tr>
</table>

以上为真实产品界面截图，使用的是脱敏示例数据。宿主程序截图中的有效配对二维码和私人局域网地址已经替换为不可扫描的占位图与示例地址，不包含私人任务内容或访问凭据。

## 工作原理

![Codex 随身工作台工作原理图：安装到 Mac、读取本地 Codex 状态、通过局域网同步，并从手机双向控制](docs/assets/how-it-works.zh-CN.svg)

1. **安装宿主程序。** macOS 原生外壳会在 Mac 上启动内置的 Node.js 服务，并显示手机访问地址和一次性配对二维码。
2. **读取 Codex 本地数据。** 服务从本机 `~/.codex` 数据库读取任务、项目、队列、目标、用量和最近可见消息；恢复任务、管理队列和 steer 操作通过 Codex 命令行与 app-server 控制通道完成，不会抓取 ChatGPT 网页界面。
3. **在局域网内同步。** 手机扫码配对后获得 HttpOnly 会话 Cookie。经过认证的接口提供当前状态，实时事件会在任务变化时刷新手机页面。
4. **从手机反向控制。** 新提示词和队列操作会回传到 Mac，再交给指定的 Codex 任务。系统只保留用于监控的少量最近内容，不会建立第二份完整聊天档案。

当前版本只在局域网内工作，数据只在 Mac 与同一可信 Wi-Fi 下的已配对设备之间传输，不经过 Codex Local Hub 的公网中继。

## 能做什么

- 同步 Codex 任务、项目、进度与最近 20 条可见消息
- 从手机发送提示词，空闲任务直接启动，忙碌任务进入队列
- 调整队列优先级、删除任务、将某条消息立即 steer 到当前回合
- 一键恢复被中断或暂停的任务
- 查看长程 goal、执行时长和当前状态
- 查看 Codex 用量与重置时间
- 在交付信箱中查看最近 20 张截图或图片结果
- 首次打开跟随设备语言，支持中英文手动切换并记住选择，也可添加到手机主屏幕
- 不同步隐藏思考过程，不复制保存完整聊天历史

## 适合哪些场景

- 在沙发、床上或另一个房间监控长时间运行的 Codex 编程任务
- 不回到 Mac 前也能发送下一条提示词
- 手动调整任务队列优先级，把紧急消息 steer 到当前回合
- 在手机上检查截图和视觉交付结果，再决定是否验收
- 保持本地优先，不把完整对话复制到第三方托管面板

## 启用图片交付 Skill

**交付信箱**本身已经内置在 Codex Local Hub 中。使用上面的一句话安装方式时，系统会自动安装配套的 [`deliver-to-codex-local-hub`](.agents/skills/deliver-to-codex-local-hub) Skill。它会告诉 Codex 如何检查现有截图或图片，并把它安全地放入交付通道。原图不会被移动或修改，信箱只保留最近 20 张受支持的图片。

推荐安装方式：在 Codex 对话中发送下面这句话，注意这不是终端命令：

```text
$skill-installer 请从 https://github.com/brandonwang001/codex-local-hub/tree/main/.agents/skills/deliver-to-codex-local-hub 安装这个 Skill
```

如果已经克隆本仓库，在仓库目录内使用 Codex 时会自动发现仓库级 Skill。也可以手动安装到个人目录，让它在所有项目中可用：

```bash
mkdir -p "$HOME/.agents/skills"
cp -R ".agents/skills/deliver-to-codex-local-hub" "$HOME/.agents/skills/"
```

Codex 通常会自动发现新 Skill；如果没有出现，请重启 Codex。安装后可以直接描述需求，也可以明确调用：

```text
使用 $deliver-to-codex-local-hub，把 /图片的绝对路径/效果截图.png 以“结账页效果”的名称发送到我的手机。
```

使用时请保持 Codex Local Hub 运行，图片会在下一次刷新时出现在**交付信箱**。支持 PNG、JPEG、WebP 和 GIF，单张不超过 20 MB。Codex 如何发现和调用 Skill，可参考 [OpenAI 官方 Skill 文档](https://learn.chatgpt.com/docs/build-skills)。

## 安装

对大多数用户，推荐直接使用 README 开头的“复制一句话，让 Codex 完成安装”。

首个经过 Apple 公证的公开 DMG 正在准备中。在 GitHub Releases 提供之前，请先按照下面的开发者步骤从源码构建。未来发布包会内置 Apple Silicon 与 Intel 版本的 Node.js，普通用户不需要单独安装 Node 或打开终端。详细说明见[安装指南](docs/INSTALL.md)和[兼容性说明](docs/COMPATIBILITY.md)。

开发者构建：

环境要求：macOS 15+、Node.js 22+、本机已安装并使用 Codex。

```bash
git clone https://github.com/brandonwang001/codex-local-hub.git
cd codex-local-hub
npm install
npm run build:mac
open "dist/Codex Local Hub.app"
```

然后让手机与 Mac 连接同一个 Wi-Fi，使用相机扫描 Mac 程序里的二维码即可。二维码只用于首次安全配对，打开后的网址不会显示 Token。

浏览器开发模式：

```bash
npm start
```

生成包含运行时的 Universal DMG：

```bash
npm run package:mac
```

## 局域网模式说明

- 锁定 Mac 屏幕不影响运行。
- Mac 休眠、关机或退出程序后，手机将无法连接。
- 当前版本只支持同一局域网。
- 不要将 `8787` 端口直接映射到公网。
- 后续远程模式将通过带 TLS 和设备认证的中继实现。

## 添加到手机桌面

在 iPhone 或 iPad 上使用 Safari 打开，然后选择 **分享 → 添加到主屏幕**。Android 可在 Chrome 菜单中选择“添加到主屏幕”或“安装应用”。

## 隐私与安全

- 新设备必须通过 Mac 上的二维码配对。
- API 使用 HttpOnly、SameSite Cookie。
- 会话密钥以仅当前用户可读的权限保存在 Mac。
- 不同步隐藏推理和工具细节。
- 仅展示最近消息和交付图片，服务端不建立完整聊天副本。

详细信息见 [SECURITY.md](SECURITY.md)。

## 测试

```bash
npm test
npm run test:coverage
```

覆盖率命令对核心模块执行 100% 行、分支与函数覆盖率门槛。

## 路线图

- 公网安全中继与远程模式
- 完成、失败、需要回复时的手机通知
- 登录时自动启动与更完整的健康检查
- 语音提示词和常用提示词快捷操作
- 图片对比与标注反馈
- Linux 中继与无界面运行包

## 常见问题

### 这是 OpenAI 或 Codex 官方项目吗？

不是。这是一个面向本地 Codex 工作流的独立开源项目。

### 会同步隐藏思考过程或完整聊天记录吗？

不会。系统只展示最近的可见消息、任务状态、目标、队列、用量和图片交付，不会镜像隐藏推理。

### 可以在外网使用吗？

暂时不可以。当前版本仅支持局域网，请勿把 `8787` 端口直接暴露到公网。路线图中包含带身份验证和 TLS 的远程中继。

### 锁定 Mac 后还可以访问吗？

可以。锁屏不会停止同步；Mac 休眠、关机或退出 Codex Local Hub 后会暂时无法访问。

欢迎阅读 [贡献指南](CONTRIBUTING.md) 并提交 Issue 或 Pull Request。

## License

[MIT](LICENSE)
