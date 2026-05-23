---
layout: home
hero:
  name: Deep Agents 源码深度解析
  text: 构建于 LangGraph 之上的 AI Agent 框架
  tagline: 深入解析 Deep Agents 的核心机制、中间件系统、后端架构与子代理实现
  image:
    src: /logo.svg
    alt: Deep Agents Logo
  actions:
    - theme: brand
      text: 开始阅读
      link: /guide/overview
    - theme: alt
      text: GitHub
      link: https://github.com/langchain-ai/deepagents

features:
  - icon: 🏗️
    title: 架构深度解析
    details: 从 Monorepo 结构到中间件栈，全面理解 Deep Agents 的分层架构设计
    link: /architecture/overview

  - icon: 🔧
    title: 中间件系统
    details: 深入 FilesystemMiddleware、SubAgentMiddleware、MemoryMiddleware 等核心中间件的实现原理
    link: /core/filesystem-middleware

  - icon: 🔌
    title: 后端抽象
    details: 解析 BackendProtocol 协议设计，理解 StateBackend、FilesystemBackend、SandboxBackend 的实现差异
    link: /core/backend-protocol

  - icon: 🤖
    title: 子代理机制
    details: 揭秘 task 工具如何将任务委托给具有独立上下文窗口的子代理
    link: /architecture/subagent-system

  - icon: ⚡
    title: 上下文管理
    details: 分析大内容卸载、会话摘要等上下文管理策略，理解如何处理超长对话
    link: /core/summarization-middleware

  - icon: 📦
    title: Profiles 系统
    details: 探索 HarnessProfile 和 ProviderProfile 如何实现模型特定配置
    link: /architecture/profile-system
---

## 为什么学习 Deep Agents 源码？

Deep Agents 是 LangChain 团队开发的开源 AI Agent 框架，它代表了当前 AI Agent 开发的最新实践。通过学习其源码，你将获得：

### 1. Agent 架构设计最佳实践

Deep Agents 基于 LangGraph 构建，展示了如何设计一个生产级的 Agent 框架：
- **中间件模式**：通过 `AgentMiddleware` 实现可插拔的功能扩展
- **后端抽象**：统一的后端协议支持多种存储和执行后端
- **子代理机制**：将复杂任务委托给独立的子代理处理

### 2. 生产级工程实践

从代码中学习如何构建生产就绪的 AI 应用：
- 流式响应和状态持久化
- 上下文管理和 Token 优化
- 权限控制和安全隔离
- 可观测性和调试支持

### 3. 可扩展性设计

理解如何设计可扩展的系统：
- 自定义中间件扩展功能
- 自定义后端适配不同环境
- 自定义子代理处理特定领域任务

## 📂 源码结构

```
deepagents/
├── libs/
│   ├── deepagents/          # 核心 SDK (~200+ 文件)
│   │   ├── graph.py         # create_deep_agent 入口
│   │   ├── backends/        # 后端协议与实现
│   │   ├── middleware/      # 中间件系统
│   │   └── profiles/        # 模型配置 Profile
│   ├── code/               # Deep Agents Code CLI
│   ├── cli/                # 部署相关 CLI
│   ├── acp/                # Agent Context Protocol
│   ├── evals/              # 评估套件
│   └── partners/           # 合作伙伴集成
├── examples/               # 示例代码
└── .github/                # CI/CD 配置
```

## 📚 文档导航

| 章节 | 内容 | 链接 |
|------|------|------|
| **指南** | 概览、快速开始、源码结构、调试指南 | [开始阅读](/guide/overview) |
| **架构** | 整体架构、中间件系统、后端系统、子代理系统、配置系统 | [开始阅读](/architecture/overview) |
| **核心** | 入口函数、中间件实现、后端实现 | [开始阅读](/core/create-deep-agent) |
| **进阶** | 自定义扩展、最佳实践、性能优化 | [开始阅读](/advanced/custom-middleware) |

## 🚀 快速开始

### 1. 克隆源码

```bash
git clone https://github.com/langchain-ai/deepagents.git
cd deepagents
```

### 2. 安装依赖

```bash
# 使用 uv (推荐)
uv sync

# 或使用 pip
pip install -e libs/deepagents
```

### 3. 运行示例

```python
from deepagents import create_deep_agent

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    system_prompt="You are a research assistant.",
)

result = agent.invoke({"messages": "Hello, Deep Agents!"})
print(result)
```

## 📖 关于本文档

本文档是对 Deep Agents **v0.6.3** 版本的源码深度解析，涵盖：

- **核心入口**：`create_deep_agent` 函数的完整实现流程
- **中间件系统**：7 个核心中间件的详细分析
- **后端系统**：4 种后端实现的协议设计与实现差异
- **子代理机制**：同步/异步子代理的创建与调度
- **配置系统**：HarnessProfile 和 ProviderProfile 的设计理念

所有文档内容均基于实际源码编写，代码片段标注了源码路径，方便对照阅读。

---

**版本**: Deep Agents v0.6.3
**源码地址**: [https://github.com/langchain-ai/deepagents](https://github.com/langchain-ai/deepagents)
**文档生成时间**: 2026-05-23