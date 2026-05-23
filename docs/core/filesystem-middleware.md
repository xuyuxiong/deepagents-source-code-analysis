# FilesystemMiddleware

FilesystemMiddleware 是 Deep Agents 中最核心的中间件之一，提供文件系统工具和大内容卸载功能。

**源码路径**: `libs/deepagents/deepagents/middleware/filesystem.py`

## 概述

FilesystemMiddleware 提供 7 个文件系统工具：

| 工具 | 功能 | 权限操作 |
|------|------|----------|
| `ls` | 列出目录 | read |
| `read_file` | 读取文件 | read |
| `write_file` | 写入新文件 | write |
| `edit_file` | 编辑文件 | write |
| `glob` | 模式匹配 | read |
| `grep` | 文本搜索 | read |
| `execute` | 执行命令 | - |

## 初始化

```python
class FilesystemMiddleware(AgentMiddleware[FilesystemState, ContextT, ResponseT]):

    state_schema = FilesystemState  # 定义状态 Schema

    def __init__(
        self,
        *,
        backend: BACKEND_TYPES | None = None,  # 后端实例或工厂
        system_prompt: str | None = None,  # 自定义系统提示
        custom_tool_descriptions: Mapping[str, str] | None = None,  # 工具描述覆盖
        tool_token_limit_before_evict: int | None = 20000,  # 工具结果卸载阈值
        human_message_token_limit_before_evict: int | None = 50000,  # 用户消息卸载阈值
        max_execute_timeout: int = 3600,  # 命令执行超时
        _permissions: list[FilesystemPermission] | None = None,  # 权限规则
    ):
        # 使用默认后端
        self.backend = backend if backend is not None else StateBackend()

        # 大内容卸载路径
        artifacts_root = self.backend.artifacts_root if isinstance(self.backend, CompositeBackend) else "/"
        self._large_tool_results_prefix = f"{artifacts_root.rstrip('/')}/large_tool_results"
        self._conversation_history_prefix = f"{artifacts_root.rstrip('/')}/conversation_history"

        # 存储配置
        self._custom_tool_descriptions = custom_tool_descriptions or {}
        self._tool_token_limit_before_evict = tool_token_limit_before_evict
        self._human_message_token_limit_before_evict = human_message_token_limit_before_evict
        self._permissions = list(_permissions or [])

        # 创建工具
        self.tools = [
            self._create_ls_tool(),
            self._create_read_file_tool(),
            self._create_write_file_tool(),
            self._create_edit_file_tool(),
            self._create_glob_tool(),
            self._create_grep_tool(),
            self._create_execute_tool(),
        ]
```

## 状态 Schema

```python
class FilesystemState(AgentState):
    """文件系统中间件的状态"""

    files: Annotated[
        NotRequired[dict[str, FileData]],
        DeltaChannel(_file_data_delta_reducer, snapshot_frequency=50)
    ]
```

使用 `DeltaChannel` 优化文件存储，避免每次 Checkpoint 都保存完整文件列表。

## 工具实现

### ls 工具

```python
def _create_ls_tool(self) -> BaseTool:
    """创建 ls 工具"""

    def sync_ls(runtime: ToolRuntime, path: str) -> ToolMessage:
        backend = self._get_backend(runtime)

        # 路径验证
        try:
            validated_path = validate_path(path)
        except ValueError as e:
            return ToolMessage(content=f"Error: {e}", status="error", ...)

        # 权限检查
        if _check_fs_permission(self._permissions, "read", validated_path) == "deny":
            return ToolMessage(content=f"Error: permission denied", status="error", ...)

        # 调用后端
        ls_result = backend.ls(validated_path)
        if ls_result.error:
            return ToolMessage(content=f"Error: {ls_result.error}", status="error", ...)

        # 过滤权限
        paths = _apply_permissions_to_ls_results(self._permissions, ls_result.entries or [])

        return ToolMessage(content=str(truncate_if_too_long(paths)), status="success", ...)

    return StructuredTool.from_function(
        name="ls",
        description=LIST_FILES_TOOL_DESCRIPTION,
        func=sync_ls,
        coroutine=async_ls,
        args_schema=LsSchema,
    )
```

### read_file 工具

```python
def _create_read_file_tool(self) -> BaseTool:
    """创建 read_file 工具"""

    def sync_read_file(file_path: str, runtime: ToolRuntime, offset: int = 0, limit: int = 100) -> ToolMessage:
        backend = self._get_backend(runtime)

        # 路径验证和权限检查
        try:
            validated_path = validate_path(file_path)
        except ValueError as e:
            return ToolMessage(content=f"Error: {e}", status="error", ...)

        if _check_fs_permission(self._permissions, "read", validated_path) == "deny":
            return ToolMessage(content=f"Error: permission denied", status="error", ...)

        # 读取文件
        read_result = backend.read(validated_path, offset=offset, limit=limit)

        if read_result.error:
            return ToolMessage(content=f"Error: {read_result.error}", status="error", ...)

        # 处理多模态内容
        file_type = _get_file_type(validated_path)
        if file_type != "text":
            # 返回多模态内容块
            return ToolMessage(
                content_blocks=[{"type": file_type, "base64": content, "mime_type": mime_type}],
                status="success",
                ...
            )

        # 格式化并截断
        content = format_content_with_line_numbers(read_result.file_data["content"], start_line=offset + 1)
        return ToolMessage(content=_truncate(content, validated_path, limit), status="success", ...)

    return StructuredTool.from_function(...)
```

### edit_file 工具

```python
def _create_edit_file_tool(self) -> BaseTool:
    """创建 edit_file 工具"""

    def sync_edit_file(
        file_path: str,
        old_string: str,
        new_string: str,
        runtime: ToolRuntime,
        *,
        replace_all: bool = False,
    ) -> ToolMessage:
        backend = self._get_backend(runtime)

        # 路径验证和权限检查
        validated_path = validate_path(file_path)
        if _check_fs_permission(self._permissions, "write", validated_path) == "deny":
            return ToolMessage(content=f"Error: permission denied", status="error", ...)

        # 执行编辑
        result = backend.edit(validated_path, old_string, new_string, replace_all=replace_all)

        if result.error:
            return ToolMessage(content=result.error, status="error", ...)

        return ToolMessage(
            content=f"Successfully replaced {result.occurrences} instance(s)",
            status="success",
            ...
        )

    return StructuredTool.from_function(...)
```

### execute 工具

```python
def _create_execute_tool(self) -> BaseTool:
    """创建 execute 工具（需要 SandboxBackend）"""

    def sync_execute(command: str, runtime: ToolRuntime, timeout: int | None = None) -> ToolMessage:
        backend = self._get_backend(runtime)

        # 检查后端是否支持执行
        if not supports_execution(backend):
            return ToolMessage(
                content="Error: Execution not available. Backend does not implement SandboxBackendProtocol.",
                status="error",
                ...
            )

        # 超时验证
        if timeout is not None:
            if timeout < 0:
                return ToolMessage(content=f"Error: timeout must be non-negative", status="error", ...)
            if timeout > self._max_execute_timeout:
                return ToolMessage(
                    content=f"Error: timeout exceeds maximum ({self._max_execute_timeout}s)",
                    status="error",
                    ...
                )

        # 执行命令
        executable = cast("SandboxBackendProtocol", backend)
        result = executable.execute(command, timeout=timeout)

        # 格式化输出
        parts = [result.output]
        if result.exit_code is not None:
            cmd_status = "succeeded" if result.exit_code == 0 else "failed"
            parts.append(f"\n[Command {cmd_status} with exit code {result.exit_code}]")
        if result.truncated:
            parts.append("\n[Output was truncated due to size limits]")

        return ToolMessage(content="".join(parts), status="success", ...)

    return StructuredTool.from_function(...)
```

## 权限控制

### FilesystemPermission

```python
@dataclass
class FilesystemPermission:
    """文件系统权限规则"""

    operations: list[FilesystemOperation]  # ["read"] 或 ["write"] 或 ["read", "write"]
    paths: list[str]  # glob 模式路径列表
    mode: Literal["allow", "deny"] = "allow"  # 允许或拒绝

    def __post_init__(self):
        """验证路径"""
        for path in self.paths:
            if not path.startswith("/"):
                raise ValueError(f"Permission path must start with '/': {path!r}")
            if ".." in PurePosixPath(path.replace("\\", "/")).parts:
                raise ValueError(f"Permission path must not contain '..': {path!r}")
```

### 权限检查

```python
def _check_fs_permission(
    rules: list[FilesystemPermission],
    operation: FilesystemOperation,
    path: str,
) -> Literal["allow", "deny"]:
    """检查权限"""
    for rule in rules:
        if operation not in rule.operations:
            continue
        if any(wcglob.globmatch(path, pattern, flags=_FS_WCMATCH_FLAGS) for pattern in rule.paths):
            return rule.mode
    return "allow"  # 默认允许
```

### 使用示例

```python
from deepagents import create_deep_agent, FilesystemPermission

permissions = [
    # 允许读写项目目录
    FilesystemPermission(
        operations=["read", "write"],
        paths=["/project/**"],
        mode="allow",
    ),
    # 拒绝写入只读目录
    FilesystemPermission(
        operations=["write"],
        paths=["/readonly/**", "/config/**"],
        mode="deny",
    ),
    # 允许读取用户目录
    FilesystemPermission(
        operations=["read"],
        paths=["/home/**"],
        mode="allow",
    ),
]

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    permissions=permissions,
)
```

## 大内容卸载

### 工具结果卸载

当工具结果超过阈值时，自动卸载到文件系统：

```python
def _process_large_message(
    self,
    message: ToolMessage,
    backend: BackendProtocol,
) -> tuple[ToolMessage, bool]:
    """处理大 ToolMessage"""
    if not self._tool_token_limit_before_evict:
        return message, False

    content_str = _extract_text_from_message(message)

    # 检查是否超过阈值
    if len(content_str) <= NUM_CHARS_PER_TOKEN * self._tool_token_limit_before_evict:
        return message, False

    # 写入文件系统
    file_path = f"{self._large_tool_results_prefix}/{uuid.uuid4()}"
    backend.write(file_path, content_str)

    # 返回截断消息
    processed = _offload_tool_message_content(message, content_str, backend, ...)
    return processed, True
```

### HumanMessage 卸载

```python
def _evict_and_truncate_messages(
    self,
    request: ModelRequest,
) -> tuple[list[AnyMessage], Command | None] | None:
    """卸载大 HumanMessage"""
    messages = list(request.messages)
    has_tagged, new_eviction_needed = self._check_eviction_needed(messages)

    if not has_tagged and not new_eviction_needed:
        return None

    write_result = None
    file_path = None

    if new_eviction_needed:
        backend = self._get_backend_from_runtime(request.state, request.runtime)
        file_path = f"{self._conversation_history_prefix}/{uuid.uuid4()}.md"
        write_result = backend.write(file_path, _extract_text_from_message(messages[-1]))

    return self._apply_eviction_and_truncate(messages, write_result, file_path)
```

## wrap_model_call 实现

```python
def wrap_model_call(
    self,
    request: ModelRequest,
    handler: Callable,
) -> ModelResponse | ExtendedModelResponse:
    """包装模型调用"""

    # 1. 检查 execute 工具是否可用
    has_execute_tool = any(
        (tool.name if hasattr(tool, "name") else tool.get("name")) == "execute"
        for tool in request.tools
    )

    if has_execute_tool:
        backend = self._get_backend(request.runtime)
        if not supports_execution(backend):
            # 过滤掉 execute 工具
            filtered_tools = [t for t in request.tools if ...]
            request = request.override(tools=filtered_tools)

    # 2. 构建系统提示
    if self._custom_system_prompt:
        system_prompt = self._custom_system_prompt
    else:
        prompt_parts = [_FILESYSTEM_SYSTEM_PROMPT_TEMPLATE.format(...)]
        if has_execute_tool and supports_execution(backend):
            prompt_parts.append(EXECUTION_SYSTEM_PROMPT)
        system_prompt = "\n\n".join(prompt_parts)

    new_system_message = append_to_system_message(request.system_message, system_prompt)
    request = request.override(system_message=new_system_message)

    # 3. 处理大消息卸载
    eviction_result = self._evict_and_truncate_messages(request)
    if eviction_result:
        messages, state_command = eviction_result
        request = request.override(messages=messages)
        response = handler(request)
        if state_command:
            return ExtendedModelResponse(model_response=response, command=state_command)
        return response

    return handler(request)
```

## wrap_tool_call 实现

```python
def wrap_tool_call(
    self,
    request: ToolCallRequest,
    handler: Callable,
) -> ToolMessage | Command:
    """包装工具调用"""

    # 执行工具
    tool_result = handler(request)

    # 检查是否需要卸载
    if self._tool_token_limit_before_evict is None:
        return tool_result

    if request.tool_call["name"] in TOOLS_EXCLUDED_FROM_EVICTION:
        return tool_result

    # 处理大内容
    return self._intercept_large_tool_result(tool_result, request.runtime)
```

## 下一步

- [BackendProtocol](/core/backend-protocol)：深入理解后端协议
- [StateBackend](/core/state-backend)：深入理解状态后端
- [权限控制](/core/tool-exclusion)：学习更多权限配置技巧