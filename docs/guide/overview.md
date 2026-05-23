# 概览

Deep Agents 是 LangChain 团队开发的开源 AI Agent 框架，它是一个"开箱即用"的 Agent Harness（代理线束），构建于 LangGraph 之上。本文档将带你深入了解其设计哲学、核心特性和架构概览。

## 什么是 Deep Agents？

Deep Agents 是一个 **Opinionated（有主见）** 的 Agent 框架，这意味着它提供了一套经过精心设计的默认配置，针对长周期、多步骤工作进行了优化。同时，它又是 **Extensible（可扩展）** 的，任何组件都可以被覆盖或替换，无需 Fork 项目。

### 核心定位

```
┌─────────────────────────────────────────────────────────────────┐
│                        应用层                                    │
│  (你的业务逻辑、自定义工具、特定领域 Agent)                       │
├─────────────────────────────────────────────────────────────────┤
│                     Deep Agents                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              Agent Harness (代理线束)                        ││
│  │  • 中间件系统 (Middleware System)                            ││
│  │  • 后端抽象 (Backend Abstraction)                            ││
│  │  • 子代理系统 (Subagent System)                              ││
│  │  • 上下文管理 (Context Management)                           ││
│  │  • 配置系统 (Profile System)                                 ││
│  └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│                     LangGraph                                    │
│  (图运行时、状态管理、持久化、流式)                                │
├─────────────────────────────────────────────────────────────────┤
│                     LangChain                                    │
│  (模型抽象、工具定义、消息格式)                                    │
└─────────────────────────────────────────────────────────────────┘
```

与其他框架的关系：
- **LangGraph**：提供图运行时、状态管理、持久化、流式响应等基础设施
- **LangChain `create_agent`**：提供最小化的 Agent 循环
- **Deep Agents**：在同一抽象层级上提供了更多内置功能（文件系统、子代理、上下文管理等）

## 核心特性

### 1. 子代理（Subagents）

将复杂任务委托给具有**独立上下文窗口**的子代理处理：

```python
from deepagents import create_deep_agent, SubAgent

researcher: SubAgent = {
    "name": "researcher",
    "description": "Deep research on a specific topic",
    "system_prompt": "You are a thorough researcher...",
    "model": "openai:gpt-4o",
    "tools": [web_search_tool],
}

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    subagents=[researcher],
)
```

**支持三种子代理类型**：
- `SubAgent`：声明式配置，自动构建子图
- `CompiledSubAgent`：预编译的 LangGraph 可执行对象
- `AsyncSubAgent`：远程/后台子代理（通过 LangGraph Platform）

### 2. 文件系统（Filesystem）

可插拔的文件读写、编辑、搜索后端：

```python
from deepagents import create_deep_agent, FilesystemPermission
from deepagents.backends.filesystem import FilesystemBackend

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=FilesystemBackend(root_dir="/project"),
    permissions=[
        FilesystemPermission(
            operations=["read", "write"],
            paths=["/project/**"],
            mode="allow",
        ),
    ],
)
```

**提供的工具**：
- `ls`：列出目录内容
- `read_file`：读取文件（支持分页、多模态）
- `write_file`：写入新文件
- `edit_file`：精确字符串替换
- `glob`：文件模式匹配
- `grep`：文本搜索
- `execute`：Shell 命令执行（需要 SandboxBackend）

### 3. 上下文管理

**大内容卸载**：当工具结果超过阈值时，自动卸载到文件系统

**会话摘要**：自动摘要历史对话，防止上下文溢出

### 4. 持久化记忆（Memory）

从 `AGENTS.md` 文件加载项目特定上下文：

```python
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    memory=["./AGENTS.md", "~/.deepagents/AGENTS.md"],
)
```

### 5. 技能系统（Skills）

渐进式披露，按需加载：

```python
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    skills=["/skills/user/", "/skills/project/"],
)
```

### 6. 人工审核（Human-in-the-Loop）

工具调用前的审批机制：

```python
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    interrupt_on={"edit_file": True},  # 每次编辑前暂停
)
```

## 设计哲学

Deep Agents 的设计遵循以下原则：

### 1. Opinionated - 有主见

默认配置针对生产场景优化：
- 子代理自动继承主 Agent 的工具和权限
- 大内容自动卸载到文件系统
- Anthropic 模型自动启用提示缓存

### 2. Extensible - 可扩展

任何组件都可以覆盖：
```python
# 替换默认中间件
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    middleware=[MyCustomMiddleware()],
)

# 排除特定工具
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    excluded_tools=["execute"],  # 禁用命令执行
)
```

### 3. Model-agnostic - 模型无关

支持任何支持 Tool Calling 的 LLM：
- Anthropic Claude
- OpenAI GPT
- Google Gemini
- 通过 Ollama/vLLM 托管的开源模型

### 4. Production-ready - 生产就绪

基于 LangGraph 构建，支持：
- 流式响应
- 状态持久化（Checkpointer）
- 分布式部署（LangGraph Platform）
- 可观测性（LangSmith）

## 架构概览

### 中间件栈顺序

```
请求 → TodoListMiddleware
     → SkillsMiddleware (可选)
     → FilesystemMiddleware
     → SubAgentMiddleware (同步子代理)
     → AsyncSubAgentMiddleware (异步子代理)
     → SummarizationMiddleware
     → PatchToolCallsMiddleware
     → [用户自定义中间件]
     → HarnessProfile.extra_middleware
     → _ToolExclusionMiddleware
     → AnthropicPromptCachingMiddleware
     → MemoryMiddleware (可选)
     → HumanInTheLoopMiddleware (可选)
     → 模型调用
```

### 后端抽象

```
┌─────────────────────────────────────────────────────────────────┐
│                    BackendProtocol                               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  文件操作: ls, read, write, edit, glob, grep                 ││
│  │  批量操作: upload_files, download_files                      ││
│  └─────────────────────────────────────────────────────────────┘│
│                              ↑                                   │
│        ┌─────────────────────┼─────────────────────┐            │
│        │                     │                     │            │
│  ┌─────┴─────┐        ┌──────┴──────┐       ┌──────┴──────┐    │
│  │StateBackend│       │Filesystem   │       │Sandbox      │    │
│  │(状态存储)  │       │Backend      │       │Backend      │    │
│  │           │       │(文件系统)   │       │(沙箱执行)   │    │
│  └───────────┘       └─────────────┘       └─────────────┘    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              CompositeBackend (路由组合)                     ││
│  │  routes={"/memories/": StoreBackend, "/sandbox/": Sandbox}  ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## 快速对比

| 特性 | LangGraph | LangChain create_agent | Deep Agents |
|------|-----------|------------------------|-------------|
| 图运行时 | ✅ | ✅ | ✅ |
| 状态管理 | ✅ | ✅ | ✅ |
| 流式响应 | ✅ | ✅ | ✅ |
| 文件系统工具 | ❌ | ❌ | ✅ |
| 子代理系统 | ❌ | ❌ | ✅ |
| 上下文管理 | ❌ | ❌ | ✅ |
| 持久化记忆 | ❌ | ❌ | ✅ |
| 技能系统 | ❌ | ❌ | ✅ |
| 权限控制 | ❌ | ❌ | ✅ |
| 模型特定优化 | ❌ | ❌ | ✅ |

## 下一步

- [快速开始](/guide/getting-started)：搭建开发环境，运行第一个 Agent
- [源码结构](/guide/structure)：了解 Monorepo 架构和包间依赖
- [整体架构](/architecture/overview)：深入理解框架的分层设计
- [create_deep_agent](/core/create-deep-agent)：入口函数的完整实现分析

---

**源码路径**: `libs/deepagents/deepagents/`