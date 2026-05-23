# 工具排除

ToolExclusionMiddleware 允许从模型请求中排除特定工具，根据配置文件或运行时设置动态过滤工具列表。

**源码路径**: `libs/deepagents/deepagents/middleware/_tool_exclusion.py`

## 核心功能

- 从工具列表中移除指定工具
- 支持中间件堆栈中的任何位置
- 同步和异步支持

## 实现

```python
class _ToolExclusionMiddleware(AgentMiddleware):
    """过滤排除的工具

    应放在中间件堆栈的后部（在所有工具注入中间件之后），
    以便过滤中间件注入的工具（filesystem, subagent 等）。
    """

    def __init__(self, *, excluded: frozenset[str]) -> None:
        self._excluded = excluded

    def wrap_model_call(self, request, handler):
        if self._excluded:
            filtered = [
                t for t in request.tools
                if _tool_name(t) not in self._excluded
            ]
            request = request.override(tools=filtered)
        return handler(request)
```

## 工具名提取

```python
def _tool_name(tool: BaseTool | dict[str, str]) -> str | None:
    """从 BaseTool 或 dict 工具提取名称"""
    if isinstance(tool, dict):
        name = tool.get("name")
        return name if isinstance(name, str) else None
    name = getattr(tool, "name", None)
    return name if isinstance(name, str) else None
```

## 使用方式

工具排除通过 `create_deep_agent` 的 `exclude_tools` 参数配置：

```python
from deepagents import create_deep_agent

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=backend,
    exclude_tools=["execute"],  # 排除命令执行工具
)
```

## 配置文件排除

在 HarnessProfile 中配置工具排除：

```python
from deepagents.profiles import HarnessProfile

profile = HarnessProfile(
    name="safe-mode",
    exclude_tools=["execute", "write_file", "edit_file"],
)

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    profile=profile,
)
```

## 内置排除配置

某些 Harness Profile 自动排除特定工具：

```python
# Anthropic Haiku 配置可能排除某些工具
ANTHROPIC_HAIKU_PROFILE = HarnessProfile(
    name="anthropic-haiku",
    model="anthropic:claude-haiku-3-5",
    exclude_tools=frozenset(["execute"]),  # 不支持命令执行
)
```

## 中间件顺序

ToolExclusionMiddleware 应放在中间件堆栈的后部：

```
中间件执行顺序（wrap_model_call）:
1. SummarizationMiddleware
2. MemoryMiddleware
3. SkillsMiddleware
4. FilesystemMiddleware  ← 注入文件工具
5. SubAgentMiddleware     ← 注入 task 工具
6. AsyncSubAgentMiddleware ← 注入异步任务工具
7. ToolExclusionMiddleware ← 过滤工具
8. 模型调用
```

## 排除场景

### 1. 安全限制

```python
# 禁用危险的命令执行
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=FilesystemBackend(root_dir="/workspace"),
    exclude_tools=["execute"],  # 禁止执行命令
)
```

### 2. 只读模式

```python
# 只读访问
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=FilesystemBackend(root_dir="/workspace", virtual_mode=True),
    exclude_tools=["execute", "write_file", "edit_file"],
)
```

### 3. 模型限制

```python
# 某些模型不支持特定工具类型
agent = create_deep_agent(
    model="anthropic:claude-haiku-3-5",
    exclude_tools=["execute"],  # Haiku 不推荐用于代码执行
)
```

### 4. 自定义限制

```python
# 用户自定义限制
class RestrictedAgent:
    def __init__(self, allowed_tools: set[str]):
        all_tools = {"ls", "read_file", "write_file", "edit_file", "grep", "glob", "execute"}
        excluded = all_tools - allowed_tools

        self.agent = create_deep_agent(
            model="anthropic:claude-sonnet-4-6",
            exclude_tools=list(excluded),
        )
```

## 与其他中间件互动

### 与 FilesystemMiddleware

```python
# FilesystemMiddleware 注入文件工具
# ToolExclusionMiddleware 过滤它们

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    middleware=[
        FilesystemMiddleware(backend=backend),  # 注入: ls, read, write, edit, grep, glob, execute
    ],
    exclude_tools=["execute"],  # 过滤: execute
)
# 最终工具: ls, read, write, edit, grep, glob
```

### 与 SubAgentMiddleware

```python
# SubAgentMiddleware 注入 task 工具
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    subagents=[research_subagent, code_review_subagent],
    exclude_tools=["task"],  # 禁用子代理
)
```

## 调试

### 查看可用工具

```python
# 在 wrap_model_call 中添加日志
def wrap_model_call(self, request, handler):
    tool_names = [_tool_name(t) for t in request.tools]
    print(f"Tools before filtering: {tool_names}")

    if self._excluded:
        filtered = [t for t in request.tools if _tool_name(t) not in self._excluded]
        filtered_names = [_tool_name(t) for t in filtered]
        print(f"Tools after filtering: {filtered_names}")
        request = request.override(tools=filtered)

    return handler(request)
```

## 示例

### 安全沙箱

```python
# 创建安全的只读分析代理
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=FilesystemBackend(
        root_dir="/data",
        virtual_mode=True,
    ),
    exclude_tools=[
        "execute",      # 禁止命令执行
        "write_file",   # 禁止写入
        "edit_file",    # 禁止编辑
    ],
    # 只保留: ls, read_file, grep, glob
)
```

### 自定义工具集

```python
# 只允许搜索和读取
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=FilesystemBackend(root_dir="/workspace"),
    exclude_tools=["execute", "write_file", "edit_file", "glob"],
    # 只保留: ls, read_file, grep
)
```

## 下一步

- [工具系统](./tools.md) - 工具概述
- [FilesystemMiddleware](./filesystem-middleware.md) - 文件系统中间件
- [最佳实践](../advanced/best-practices.md) - 安全实践