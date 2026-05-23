# SandboxBackendProtocol

SandboxBackendProtocol 扩展 BackendProtocol，添加命令执行能力。

**源码路径**: `libs/deepagents/deepagents/backends/protocol.py`

## 协议定义

```python
class SandboxBackendProtocol(BackendProtocol):
    """扩展 BackendProtocol，添加命令执行能力。

    设计用于在隔离环境（容器、VM、远程主机）中运行的后端。
    """

    @property
    def id(self) -> str:
        """沙箱唯一标识符"""
        raise NotImplementedError

    def execute(
        self,
        command: str,
        *,
        timeout: int | None = None,
    ) -> ExecuteResponse:
        """在沙箱环境中执行 Shell 命令"""
        raise NotImplementedError
```

## ExecuteResponse

```python
@dataclass
class ExecuteResponse:
    output: str  # stdout 和 stderr 合并输出
    exit_code: int | None = None  # 退出码，0 表示成功
    truncated: bool = False  # 输出是否被截断
```

## 内置实现

### LocalShellBackend

**源码路径**: `libs/deepagents/deepagents/backends/local_shell.py`

**注意**: LocalShellBackend 继承 FilesystemBackend，提供**无隔离**的本地命令执行。

```python
class LocalShellBackend(FilesystemBackend, SandboxBackendProtocol):
    """本地 Shell 后端，无沙箱隔离"""
```

```python
from deepagents.backends import LocalShellBackend

# 本地 Shell 执行（无隔离）
backend = LocalShellBackend(
    root_dir="/workspace",
    timeout=120,  # 默认超时 120 秒
    inherit_env=True,  # 继承环境变量
    env={"PATH": "/usr/bin:/bin"},  # 自定义环境变量
)
```

**安全警告**: LocalShellBackend 直接在主机执行命令，**不提供任何隔离**，仅限于：
- 本地开发 CLI
- 可信环境
- CI/CD 流水线

**不适用于**:
- Web 服务器
- API 服务
- 多租户系统
- 不可信用户输入

### 第三方沙箱实现

Deep Agents 通过集成包支持真正的沙箱环境：

```python
# Daytona 沙箱（推荐）
from langchain_daytona import DaytonaSandbox

sandbox = DaytonaSandbox(api_key="...")
agent = create_deep_agent(backend=sandbox)
```

```python
# Docker 沙箱
from langchain_docker import DockerSandbox

sandbox = DockerSandbox(image="python:3.11")
agent = create_deep_agent(backend=sandbox)
```

## 创建自定义沙箱

```python
import subprocess
from deepagents.backends.protocol import (
    SandboxBackendProtocol,
    ExecuteResponse,
)

class MySandboxBackend(SandboxBackendProtocol):
    def __init__(self, sandbox_id: str):
        self._id = sandbox_id

    @property
    def id(self) -> str:
        return self._id

    def execute(
        self,
        command: str,
        *,
        timeout: int | None = None,
    ) -> ExecuteResponse:
        """在沙箱中执行命令"""
        try:
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=timeout or 60,
            )
            return ExecuteResponse(
                output=result.stdout + result.stderr,
                exit_code=result.returncode,
                truncated=False,
            )
        except subprocess.TimeoutExpired:
            return ExecuteResponse(
                output="Command timed out",
                exit_code=-1,
                truncated=False,
            )
        except Exception as e:
            return ExecuteResponse(
                output=str(e),
                exit_code=-1,
                truncated=False,
            )

    # 继承 BackendProtocol 的文件操作方法...
```

## execute 工具

当后端实现 SandboxBackendProtocol 时，FilesystemMiddleware 会提供 `execute` 工具：

```python
def execute(
    command: str,
    timeout: int | None = None,
    runtime: ToolRuntime,
) -> str:
    """执行 Shell 命令"""
    backend = runtime.state["backend"]
    if not isinstance(backend, SandboxBackendProtocol):
        return "Error: Command execution not supported. Backend must implement SandboxBackendProtocol."

    response = backend.execute(command, timeout=timeout)
    return f"Exit code: {response.exit_code}\n{response.output}"
```

## 使用示例

### 开发环境

```python
from deepagents.backends import LocalShellBackend
from deepagents import create_deep_agent

# 本地沙箱（无隔离）
backend = LocalShellBackend()

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=backend,
)
```

### 生产环境

```python
from langchain_daytona import DaytonaSandbox
from deepagents import create_deep_agent

# Daytona 沙箱（完全隔离）
sandbox = DaytonaSandbox(api_key="...", image="python:3.11")

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=sandbox,
)
```

### 带文件系统的沙箱

```python
from deepagents.backends import CompositeBackend, StateBackend
from langchain_daytona import DaytonaSandbox

sandbox = DaytonaSandbox(api_key="...")

# 组合：StateBackend 用于文件，沙箱用于执行
composite = CompositeBackend(
    default=StateBackend(),  # 文件在内存中
)

# 但将沙箱作为主后端（实现 execute）
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=sandbox,  # 提供 execute
)
```

## 超时支持

```python
def execute_accepts_timeout(cls: type[SandboxBackendProtocol]) -> bool:
    """检查后端是否支持 timeout 参数"""
    try:
        sig = inspect.signature(cls.execute)
        return "timeout" in sig.parameters
    except (ValueError, TypeError):
        return False
```

### 使用超时

```
# 工具调用
execute(command="python train.py", timeout=300)  # 5 分钟超时
```

## 安全考虑

### 1. 隔离

沙箱后端应该在隔离环境中执行命令：
- Docker 容器
- 虚拟机
- 云沙箱（如 Daytona）

### 2. 资源限制

```python
class LimitedSandboxBackend(SandboxBackendProtocol):
    def execute(self, command: str, *, timeout: int | None = None) -> ExecuteResponse:
        # 限制 CPU、内存、磁盘
        limited_command = f"""
            docker run --rm \
                --cpus=1 \
                --memory=512m \
                --pids-limit=100 \
                my-sandbox-image \
                {command}
        """
        # ...
```

### 3. 命令过滤

```python
class FilteredSandboxBackend(SandboxBackendProtocol):
    def __init__(self, backend: SandboxBackendProtocol):
        self._backend = backend
        self._blocked = {"rm", "sudo", "chmod", "chown"}

    def execute(self, command: str, *, timeout: int | None = None) -> ExecuteResponse:
        # 检查命令
        for blocked in self._blocked:
            if blocked in command.split():
                return ExecuteResponse(
                    output=f"Error: Command '{blocked}' is blocked",
                    exit_code=-1,
                )

        return self._backend.execute(command, timeout=timeout)
```

### 4. 用户隔离

```python
class UserSandboxBackend(SandboxBackendProtocol):
    def __init__(self, backend: SandboxBackendProtocol, user_id: str):
        self._backend = backend
        self._user_id = user_id

    def execute(self, command: str, *, timeout: int | None = None) -> ExecuteResponse:
        # 以特定用户执行
        safe_command = f"sudo -u {self._user_id} {command}"
        return self._backend.execute(safe_command, timeout=timeout)
```

## 下一步

- [FilesystemBackend](./filesystem-backend.md) - 文件系统后端
- [CompositeBackend](./composite-backend.md) - 组合路由后端
- [最佳实践](../advanced/best-practices.md) - 安全实践