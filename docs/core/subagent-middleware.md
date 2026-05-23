# SubAgentMiddleware

SubAgentMiddleware 提供 `task` 工具，允许主 Agent 将任务委托给子代理。

**源码路径**: `libs/deepagents/deepagents/middleware/subagents.py`

## 核心职责

1. 提供 `task` 工具
2. 管理子代理生命周期
3. 隔离子代理上下文

## 初始化

```python
class SubAgentMiddleware(AgentMiddleware[AgentState, ContextT, ResponseT]):
    def __init__(
        self,
        *,
        backend: BackendProtocol | BackendFactory,
        subagents: Sequence[SubAgent | CompiledSubAgent],
        system_prompt: str | None = TASK_SYSTEM_PROMPT,
        task_description: str | None = None,
    ):
        # 构建子代理图
        self._subagent_specs = self._get_subagents()
        self.subagent_names = frozenset(spec["name"] for spec in self._subagent_specs)

        # 构建 task 工具
        task_tool = _build_task_tool(self._subagent_specs, task_description)
        self.tools = [task_tool]
```

## task 工具实现

```python
def _build_task_tool(subagents: list[_SubagentSpec], task_description: str | None) -> BaseTool:
    """构建 task 工具"""

    def task(description: str, subagent_type: str, runtime: ToolRuntime) -> str | Command:
        # 1. 验证子代理类型
        if subagent_type not in subagent_graphs:
            return f"Unknown subagent type. Allowed: {list(subagent_graphs.keys())}"

        # 2. 准备子代理状态
        subagent_state = {
            k: v for k, v in runtime.state.items()
            if k not in _EXCLUDED_STATE_KEYS
        }
        subagent_state["messages"] = [HumanMessage(content=description)]

        # 3. 调用子代理
        result = subagent.invoke(subagent_state, subagent_config)

        # 4. 返回结果
        return _return_command_with_state_update(result, runtime.tool_call_id)

    return StructuredTool.from_function(
        name="task",
        func=task,
        description=TASK_TOOL_DESCRIPTION.format(available_agents=...),
        args_schema=TaskToolSchema,
    )
```

## 状态隔离

```python
_EXCLUDED_STATE_KEYS = {
    "messages",  # 由任务描述替代
    "todos",  # 不传递
    "structured_response",  # 不传递
    "skills_metadata",  # 重新加载
    "skills_load_errors",  # 重新加载
    "memory_contents",  # 重新加载
}
```

## 系统提示注入

中间件在 `wrap_model_call` 中注入子代理使用说明：

```python
def wrap_model_call(self, request, handler):
    if self.system_prompt:
        new_system = append_to_system_message(request.system_message, self.system_prompt)
        return handler(request.override(system_message=new_system))
    return handler(request)
```

## 下一步

- [子代理系统](../architecture/subagent-system.md)
- [AsyncSubAgentMiddleware](./async-subagent.md)