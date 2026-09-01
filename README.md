# CUI

[English](README.en.md) | 简体中文

CUI 是一个面向 coding agents 的协作界面，用来改善人与 AI 共同完成代码任务时的工作流。它把 TRAEX 驱动的编码会话、执行输出、代码审查结果和后续提示词集中在同一个按工作区组织的界面中。

## 功能

- 按工作区分组保存编码会话，支持活跃会话和分页历史会话视图。
- 同一个输入框支持聊天模式和 shell 命令模式。
- 流式展示 assistant 输出，并支持展开查看执行轨迹。
- 按 assistant 每一轮修改提供 review 入口。
- Atomic review 可以把一轮 diff 拆成更小、更容易审查的能力单元。
- 支持在 diff 行内添加 review 评论，并把评论作为后续提示词发送回原会话。
- 支持分别配置普通回复、会话摘要和 atomic review 使用的模型与 reasoning effort。

## 截图

以下截图只使用 fake 示例数据，不包含项目真实数据。

![CUI session view with fake checkout analytics data](docs/assets/cui-session-demo.png)

![CUI atomic review view with fake checkout analytics data](docs/assets/cui-atomic-review-demo.png)

## 快速开始

```sh
npm install
npm run build
npm run start
```

打开 `http://localhost:5173/`。

默认情况下，生产预览 Web 应用运行在 `5173` 端口，并连接本地 `3000` 端口的 API 服务。

## 运行数据

`npm run start` 默认把生产预览数据保存在 `prod/` 目录下：

- 会话数据：`prod/data/sessions.json`
- API 日志：`prod/logs/`

需要隔离本地数据集时，可以指定自定义路径：

```sh
npm run start -- --store-path prod/data/local-sessions.json --log-dir prod/local-logs
```

## 开发文档

开发工作流、脚本、端口和测试说明见 [DEVELOPMENT.md](DEVELOPMENT.md)。
