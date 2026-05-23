# 快速开始

本文档将帮助你搭建 Deep Agents 的开发环境，并运行第一个 Agent。

## 环境准备

### 系统要求

- Python 3.11+
- Git
- uv（推荐）或 pip

### 克隆源码

```bash
git clone https://github.com/langchain-ai/deepagents.git
cd deepagents
```

### 安装依赖

**使用 uv（推荐）**:

```bash
# 安装 uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# 安装项目依赖
uv sync

# 安装核心 SDK
uv pip install -e libs/deepagents

# 安装开发依赖
uv sync --group test
```

**使用 pip**:

```bash
# 创建虚拟环境
python -m venv .venv
source .venv/bin/activate  # Linux/macOS
# .venv\Scripts\activate  # Windows

# 安装核心 SDK
pip install -e libs/deepagents
```

### 安装可选依赖

```bash
# QuickJS 后端（用于沙箱 JavaScript 执行）
uv pip install -e libs/partners/quickjs

# Daytona 沙箱后端
uv pip install -e libs/partners/daytona

# Modal 沙箱后端
uv pip install -e libs/partners/modal
```

## 第一个 Agent

### 最简示例

```python
from deepagents import create_deep_agent

# 创建 Agent
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
)

# 运行 Agent
result = agent.invoke({
    "messages": "Hello, Deep Agents!"
})

print(result["messages"][-1].content)
```

### 配置 API Key

```bash
# Anthropic
export ANTHROPIC_API_KEY=your_key_here

# OpenAI
export OPENAI_API_KEY=your_key_here

# Google
export GOOGLE_API_KEY=your_key_here
```

### 使用不同模型

```python
# Anthropic Claude
agent = create_deep_agent(model="anthropic:claude-sonnet-4-6")

# OpenAI GPT
agent = create_deep_agent(model="openai:gpt-4o")

# Google Gemini
agent = create_deep_agent(model="google:gemini-2.0-flash")
```

## 核心功能演示

### 1. 文件系统操作

```python
from deepagents import create_deep_agent
from deepagents.backends.state import StateBackend

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=StateBackend(),  # 使用状态后端（默认）
)

result = agent.invoke({
    "messages": "Create a file named hello.txt with content 'Hello World'"
})
```

Agent 会自动使用 `write_file` 工具创建文件。

### 2. 子代理任务委托

```python
from deepagents import create_deep_agent, SubAgent

# 定义研究型子代理
researcher: SubAgent = {
    "name": "researcher",
    "description": "Deep research on a specific topic",
    "system_prompt": "You are a thorough researcher. Investigate deeply and return comprehensive findings.",
    "model": "anthropic:claude-sonnet-4-6",
    "tools": [],  # 继承主 Agent 的工具
}

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    subagents=[researcher],
)

result = agent.invoke({
    "messages": "Use the researcher to investigate the history of AI agents"
})
```

### 3. 持久化记忆

创建 `AGENTS.md` 文件：

```markdown
# Project Memory

## User Preferences
- Always write clean, well-documented code
- Prefer Python for scripting tasks
- Use type hints in all function definitions

## Project Conventions
- Follow PEP 8 style guide
- Write tests for all new features
```

加载记忆：

```python
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    memory=["./AGENTS.md"],
)
```

### 4. 人工审核（HITL）

```python
from langgraph.checkpoint.memory import MemorySaver

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    interrupt_on={"edit_file": True},  # 编辑文件前暂停
    checkpointer=MemorySaver(),  # 需要持久化
)

# 第一次调用：Agent 决定编辑文件，然后暂停
result = agent.invoke({"messages": "Edit hello.txt"})

# 检查挂起的工具调用
pending = result.get("__interrupt__")
print(f"Pending tool call: {pending}")

# 批准并继续
result = agent.invoke(None, config={"configurable": {"thread_id": "test"}})
```

### 5. 技能加载

创建技能目录：

```
/skills/
└── code-review/
    └── SKILL.md
```

`SKILL.md` 内容：

```markdown
---
name: code-review
description: Perform thorough code reviews with best practices
---

# Code Review Skill

## When to Use
- After writing significant code
- Before committing changes
- When reviewing PRs

## Review Checklist
1. Code correctness
2. Error handling
3. Performance
4. Security
5. Documentation
```

加载技能：

```python
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    skills=["/skills/"],
)
```

### 6. 权限控制

```python
from deepagents import create_deep_agent, FilesystemPermission
from deepagents.backends.filesystem import FilesystemBackend

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=FilesystemBackend(root_dir="/"),
    permissions=[
        # 允许读写项目目录
        FilesystemPermission(
            operations=["read", "write"],
            paths=["/project/**"],
            mode="allow",
        ),
        # 禁止写入只读目录
        FilesystemPermission(
            operations=["write"],
            paths=["/readonly/**"],
            mode="deny",
        ),
    ],
)
```

## 运行测试

```bash
# 运行所有测试
uv run --group test pytest

# 运行核心 SDK 测试
uv run --group test pytest libs/deepagents/tests/

# 运行特定测试
uv run --group test pytest libs/deepagents/tests/unit_tests/test_end_to_end.py

# 运行带覆盖率
uv run --group test pytest --cov=deepagents libs/deepagents/tests/
```

## 调试技巧

### 1. 启用调试模式

```python
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    debug=True,
)
```

### 2. 启用 LangSmith 追踪

```bash
export LANGCHAIN_TRACING_V2=true
export LANGCHAIN_API_KEY=your_key_here
```

### 3. 查看中间件栈

```python
# 打印 Agent 的中间件栈
for mw in agent.builder.middleware:
    print(type(mw).__name__)
```

### 4. 流式输出

```python
for event in agent.stream({"messages": "Hello"}):
    for key, value in event.items():
        print(f"Event: {key}")
        print(value)
```

## 常见问题

### Q: 如何禁用默认的 general-purpose 子代理？

```python
from deepagents import create_deep_agent, HarnessProfile, GeneralPurposeSubagentProfile

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    # 方法 1：通过 HarnessProfile
    # ... (需要在 profiles 中配置)
)

# 方法 2：提供空 subagents 列表（但会失去 task 工具）
# agent = create_deep_agent(model="...", subagents=[])
```

### Q: 如何添加自定义工具？

```python
from langchain_core.tools import tool

@tool
def my_custom_tool(query: str) -> str:
    """A custom tool for specific purposes."""
    return f"Processed: {query}"

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    tools=[my_custom_tool],
)
```

### Q: 如何使用自定义后端？

```python
from deepagents.backends.protocol import BackendProtocol, ReadResult, WriteResult

class MyBackend(BackendProtocol):
    def read(self, file_path: str, offset: int = 0, limit: int = 2000) -> ReadResult:
        # 自定义实现
        pass

    def write(self, file_path: str, content: str) -> WriteResult:
        # 自定义实现
        pass

    # 实现其他方法...

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=MyBackend(),
)
```

## 下一步

- [源码结构](/guide/structure)：了解项目的目录结构和包间依赖
- [调试指南](/guide/debugging)：学习如何调试 Agent 和中间件
- [整体架构](/architecture/overview)：深入理解框架的分层设计