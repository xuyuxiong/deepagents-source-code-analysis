# Deep Agents 源码深度解析

<div align="center">
  <strong>深入解析 LangChain Deep Agents 框架的核心机制与实现原理</strong>

  <br><br>
  <a href="https://langchain-ai.github.io/deepagents/">官方文档</a> |
  <a href="https://github.com/langchain-ai/deepagents">GitHub 仓库</a>
</div>

---

## 项目信息

| 项目 | 信息 |
|------|------|
| **分析版本** | Deep Agents v0.6.3 |
| **源码地址** | [https://github.com/langchain-ai/deepagents](https://github.com/langchain-ai/deepagents) |
| **文档框架** | VitePress 1.x |
| **更新时间** | 2026-05-23 |

## 在线阅读

📖 [https://xilin.github.io/deepagents-source-code-analysis/](https://xilin.github.io/deepagents-source-code-analysis/)

## 本地开发

```bash
# 克隆仓库
git clone https://github.com/xilin/deepagents-source-code-analysis.git
cd deepagents-source-code-analysis

# 安装依赖
pnpm install

# 启动开发服务器
pnpm docs:dev

# 构建生产版本
pnpm docs:build
```

## 文档目录

### 指南篇

| 文档 | 描述 |
|------|------|
| [概览](docs/guide/overview.md) | Deep Agents 介绍、核心特性、设计哲学 |
| [快速开始](docs/guide/getting-started.md) | 环境搭建、第一个 Agent、核心功能演示 |
| [源码结构](docs/guide/structure.md) | Monorepo 架构、包间依赖、核心模块 |
| [调试指南](docs/guide/debugging.md) | VSCode 配置、断点技巧、日志分析 |

### 架构篇

| 文档 | 描述 |
|------|------|
| [整体架构](docs/architecture/overview.md) | 分层架构、核心组件、执行流程 |
| [中间件系统](docs/architecture/middleware-system.md) | 中间件接口、执行顺序、核心中间件分析 |
| [后端系统](docs/architecture/backend-system.md) | BackendProtocol、不同后端实现、选择指南 |
| [子代理系统](docs/architecture/subagent-system.md) | SubAgent 类型、task 工具、执行流程 |
| [配置系统](docs/architecture/profile-system.md) | HarnessProfile、ProviderProfile、系统提示组装 |

### 核心篇

| 文档 | 描述 |
|------|------|
| [create_deep_agent](docs/core/create-deep-agent.md) | 入口函数、执行流程、参数详解 |
| [FilesystemMiddleware](docs/core/filesystem-middleware.md) | 文件系统工具、权限控制、大内容卸载 |
| [SubAgentMiddleware](docs/core/subagent-middleware.md) | task 工具、子代理调用、状态隔离 |
| [MemoryMiddleware](docs/core/memory-middleware.md) | AGENTS.md 加载、记忆注入 |
| [SkillsMiddleware](docs/core/skills-middleware.md) | 技能加载、渐进式披露 |
| [SummarizationMiddleware](docs/core/summarization-middleware.md) | 上下文摘要、Token 优化 |
| [BackendProtocol](docs/core/backend-protocol.md) | 后端协议定义、数据结构 |
| [StateBackend](docs/core/state-backend.md) | 状态存储后端实现 |

### 进阶篇

| 文档 | 描述 |
|------|------|
| [自定义中间件](docs/advanced/custom-middleware.md) | 中间件开发、最佳实践 |
| [自定义后端](docs/advanced/custom-backend.md) | 后端实现、协议遵守 |
| [自定义子代理](docs/advanced/custom-subagent.md) | 子代理配置、专业化设计 |
| [最佳实践](docs/advanced/best-practices.md) | 生产部署、性能优化 |
| [性能优化](docs/advanced/performance.md) | Token 优化、上下文管理 |

## 源码统计

| 指标 | 数量 |
|------|------|
| 核心源码文件 | 524+ |
| 中间件数量 | 7+ |
| 后端类型 | 4+ |
| 工具数量 | 7+ |

## 相关项目

- [LangChain](https://github.com/langchain-ai/langchain) - LLM 应用框架
- [LangGraph](https://github.com/langchain-ai/langgraph) - 图运行时
- [Deep Agents](https://github.com/langchain-ai/deepagents) - Agent Harness

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT License

---
