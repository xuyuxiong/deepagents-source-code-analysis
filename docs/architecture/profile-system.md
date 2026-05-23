# 配置系统 (Profiles)

Profile 系统是 Deep Agents 实现模型特定优化的关键机制。通过 HarnessProfile 和 ProviderProfile，框架可以根据使用的模型自动应用不同的配置。

## 设计理念

不同的 LLM 有不同的特性和最佳实践：

- **Anthropic Claude**：支持提示缓存、特定的工具调用格式
- **OpenAI GPT**：支持 Responses API、不同的提示格式
- **Google Gemini**：不同的上下文限制

Profile 系统允许针对每个模型应用特定的优化，而用户无需手动配置。

## HarnessProfile

**源码路径**: `libs/deepagents/deepagents/profiles/harness/harness_profiles.py`

### 定义

```python
@dataclass
class GeneralPurposeSubagentProfile:
    """通用子代理配置"""
    enabled: bool = True  # 是否启用默认 general-purpose 子代理
    description: str | None = None  # 自定义描述
    system_prompt: str | None = None  # 自定义系统提示


@dataclass
class HarnessProfile:
    """模型特定配置"""

    # 系统提示覆盖
    base_system_prompt: str | None = None  # 替换默认系统提示
    system_prompt_suffix: str | None = None  # 添加到系统提示末尾

    # 工具配置
    tool_description_overrides: dict[str, str] = field(default_factory=dict)  # 工具描述覆盖
    excluded_tools: list[str] = field(default_factory=list)  # 排除的工具

    # 中间件配置
    excluded_middleware: list[type[AgentMiddleware] | str] = field(default_factory=list)  # 排除的中间件
    extra_middleware: list[AgentMiddleware] | Callable[[], list[AgentMiddleware]] = field(default_factory=list)  # 额外中间件

    # 子代理配置
    general_purpose_subagent: GeneralPurposeSubagentProfile | None = None  # GP 子代理配置
```

### 使用示例

```python
from deepagents import HarnessProfile, register_harness_profile
from langchain_anthropic import ChatAnthropic

# 定义自定义 Profile
@cached_harness_profile
def my_custom_profile(model: BaseChatModel) -> HarnessProfile | None:
    return HarnessProfile(
        base_system_prompt="You are a specialized agent...",
        tool_description_overrides={
            "task": "Custom task tool description...",
        },
        excluded_tools=["execute"],  # 禁用命令执行
        extra_middleware=[MyCustomMiddleware()],
    )

# 注册 Profile
register_harness_profile(my_custom_profile)
```

### Profile 匹配机制

**源码路径**: `libs/deepagents/deepagents/profiles/harness/harness_profiles.py`

```python
def _harness_profile_for_model(model: BaseChatModel, model_spec: str | None) -> HarnessProfile:
    """根据模型选择 Profile"""

    # 1. 尝试精确匹配模型标识符
    if model_spec:
        for provider, profile_fn in _PROVIDER_PROFILES.items():
            if model_spec.startswith(f"{provider}:"):
                model_name = model_spec.split(":", 1)[1]
                # 检查是否有针对此模型的 Profile
                ...

    # 2. 尝试根据模型类匹配
    provider = get_model_provider(model)
    if provider:
        profile_fn = _PROVIDER_PROFILES.get(provider)
        if profile_fn:
            return profile_fn(model, model_spec)

    # 3. 返回默认空 Profile
    return HarnessProfile()
```

### 内置 Profiles

#### Anthropic Sonnet Profile

**源码路径**: `libs/deepagents/deepagents/profiles/harness/_anthropic_sonnet_4_6.py`

```python
@cached_harness_profile
def _anthropic_sonnet_4_6(model: BaseChatModel) -> HarnessProfile | None:
    """Claude Sonnet 4.6 优化配置"""
    return HarnessProfile(
        base_system_prompt=None,  # 使用默认
        system_prompt_suffix=ANTHROPIC_SPECIFIC_SUFFIX,
        tool_description_overrides={
            "task": TASK_TOOL_DESCRIPTION_ANTHROPIC,
        },
    )
```

#### Anthropic Opus Profile

**源码路径**: `libs/deepagents/deepagents/profiles/harness/_anthropic_opus_4_7.py`

```python
@cached_harness_profile
def _anthropic_opus_4_7(model: BaseChatModel) -> HarnessProfile | None:
    """Claude Opus 4.7 优化配置"""
    return HarnessProfile(
        base_system_prompt=OPUS_SYSTEM_PROMPT,
        tool_description_overrides={
            "task": TASK_TOOL_DESCRIPTION_OPUS,
        },
        excluded_tools=[],  # Opus 可以使用所有工具
    )
```

#### OpenAI Codex Profile

**源码路径**: `libs/deepagents/deepagents/profiles/harness/_openai_codex.py`

```python
@cached_harness_profile
def _openai_codex(model: BaseChatModel) -> HarnessProfile | None:
    """OpenAI Codex 优化配置"""
    return HarnessProfile(
        base_system_prompt=CODEX_SYSTEM_PROMPT,
        tool_description_overrides={
            "task": TASK_TOOL_DESCRIPTION_OPENAI,
        },
        excluded_tools=["execute"],  # Codex 不支持沙箱执行
    )
```

## ProviderProfile

**源码路径**: `libs/deepagents/deepagents/profiles/provider/provider_profiles.py`

### 定义

```python
@dataclass
class ProviderProfile:
    """Provider 级别配置"""

    name: str  # Provider 名称
    init_kwargs: dict[str, Any] = field(default_factory=dict)  # 初始化参数
```

### 使用示例

```python
from deepagents import ProviderProfile, register_provider_profile

# OpenAI Provider 使用 Responses API
register_provider_profile(ProviderProfile(
    name="openai",
    init_kwargs={
        "use_responses_api": True,
    },
))

# OpenRouter Provider 添加 Attribution Headers
register_provider_profile(ProviderProfile(
    name="openrouter",
    init_kwargs={
        "default_headers": {
            "HTTP-Referer": "https://your-app.com",
            "X-Title": "Your App Name",
        },
    },
))
```

### 模型解析

**源码路径**: `libs/deepagents/deepagents/_models.py`

```python
def resolve_model(model: str | BaseChatModel) -> BaseChatModel:
    """解析模型字符串为 BaseChatModel"""
    if isinstance(model, BaseChatModel):
        return model

    # 应用 Provider Profile
    return init_chat_model(model, **apply_provider_profile(model))


def apply_provider_profile(model_spec: str) -> dict[str, Any]:
    """应用 Provider Profile"""
    provider = model_spec.split(":")[0] if ":" in model_spec else None

    if provider and provider in _PROVIDER_PROFILES:
        profile = _PROVIDER_PROFILES[provider]
        return profile.init_kwargs

    return {}
```

## 系统提示组装

**源码路径**: `libs/deepagents/deepagents/graph.py:749-755`

### 组装顺序

```
┌─────────────────────────────────────────────────────────────────┐
│ USER (用户提供的 system_prompt)                                  │
├─────────────────────────────────────────────────────────────────┤
│ BASE 或 CUSTOM (默认提示或 HarnessProfile.base_system_prompt)    │
├─────────────────────────────────────────────────────────────────┤
│ SUFFIX (HarnessProfile.system_prompt_suffix)                    │
└─────────────────────────────────────────────────────────────────┘
```

### 实现代码

```python
def _apply_profile_prompt(profile: HarnessProfile, base_prompt: str) -> str:
    """组装系统提示"""
    # 使用 Profile 的 base_system_prompt 或默认
    prompt = profile.base_system_prompt if profile.base_system_prompt else base_prompt

    # 添加后缀
    if profile.system_prompt_suffix:
        prompt = prompt + "\n\n" + profile.system_prompt_suffix

    return prompt


# 在 create_deep_agent 中
base_prompt = _apply_profile_prompt(_profile, BASE_AGENT_PROMPT)

if system_prompt is None:
    final_system_prompt = base_prompt
elif isinstance(system_prompt, SystemMessage):
    # 保留 cache_control 标记
    final_system_prompt = SystemMessage(
        content_blocks=[
            *system_prompt.content_blocks,
            {"type": "text", "text": f"\n\n{base_prompt}"},
        ]
    )
else:
    final_system_prompt = system_prompt + "\n\n" + base_prompt
```

## 工具描述覆盖

工具描述覆盖允许针对不同模型优化工具说明：

```python
# Profile 中定义覆盖
tool_description_overrides={
    "task": "为 Anthropic 优化的 task 工具描述...",
    "read_file": "为 Anthropic 优化的 read_file 描述...",
}

# 在 create_deep_agent 中应用
_tools = _apply_tool_description_overrides(
    tools,
    _profile.tool_description_overrides,
)
```

**实现**：

```python
def _apply_tool_description_overrides(
    tools: Sequence[BaseTool | Callable | dict[str, Any]] | None,
    overrides: Mapping[str, str],
) -> list[BaseTool | Callable | dict[str, Any]] | None:
    """应用工具描述覆盖"""
    if tools is None:
        return None

    copied_tools = []
    for tool in tools:
        name = _tool_name(tool)
        override = overrides.get(name) if name else None

        if override is None:
            copied_tools.append(tool)
        elif isinstance(tool, dict):
            rewritten = tool.copy()
            rewritten["description"] = override
            copied_tools.append(rewritten)
        elif isinstance(tool, BaseTool):
            copied_tools.append(tool.model_copy(update={"description": override}))
        else:
            copied_tools.append(tool)

    return copied_tools
```

## 中间件排除

Profile 可以排除特定中间件：

```python
# 在 Profile 中定义排除
excluded_middleware=[
    "SummarizationMiddleware",  # 按名称排除
    HumanInTheLoopMiddleware,   # 按类型排除
]

# 在 create_deep_agent 中应用
deepagent_middleware = _apply_excluded_middleware(
    deepagent_middleware,
    _profile,
    matched_classes=_main_matched_classes,
    matched_names=_main_matched_names,
)
```

**保护中间件**：

某些中间件是必需的，不能被排除：

```python
_REQUIRED_MIDDLEWARE: tuple[tuple[type[AgentMiddleware], tuple[str, ...]], ...] = (
    (FilesystemMiddleware, ()),   # 文件系统必需
    (SubAgentMiddleware, ()),     # 子代理必需
)
```

## 最佳实践

### 1. 创建模型特定 Profile

```python
from deepagents import HarnessProfile, register_harness_profile

@cached_harness_profile
def my_model_profile(model: BaseChatModel) -> HarnessProfile | None:
    """为特定模型创建 Profile"""
    # 检查模型是否匹配
    if not model_matches_spec(model, "my-provider:my-model"):
        return None

    return HarnessProfile(
        base_system_prompt="You are a specialized agent...",
        tool_description_overrides={
            "task": "Optimized task description...",
        },
        excluded_tools=["execute"],
    )

register_harness_profile(my_model_profile)
```

### 2. 创建 Provider Profile

```python
from deepagents import ProviderProfile, register_provider_profile

register_provider_profile(ProviderProfile(
    name="my-provider",
    init_kwargs={
        "api_key_env": "MY_PROVIDER_API_KEY",
        "timeout": 60,
    },
))
```

### 3. 禁用默认 general-purpose 子代理

```python
from deepagents import create_deep_agent, HarnessProfile, GeneralPurposeSubagentProfile

# 方法 1：通过 Profile
profile = HarnessProfile(
    general_purpose_subagent=GeneralPurposeSubagentProfile(enabled=False),
)

# 方法 2：提供自定义子代理列表（不包含 general-purpose）
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    subagents=[my_custom_subagent],  # 只有自定义子代理
)
```

## 下一步

- [HarnessProfile 源码](/architecture/profile-system#harnessprofile)：深入理解 Profile 实现
- [ProviderProfile 源码](/architecture/profile-system#providerprofile)：深入理解 Provider 配置
- [create_deep_agent](/core/create-deep-agent)：入口函数的完整实现分析