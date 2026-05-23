# SkillsMiddleware

SkillsMiddleware 实现渐进式披露的技能系统，从后端加载技能元数据并注入到系统提示。

**源码路径**: `libs/deepagents/deepagents/middleware/skills.py`

## 技能结构

```
/skills/
└── web-research/
    └── SKILL.md
```

**SKILL.md 格式**:

```markdown
---
name: web-research
description: Conduct thorough web research
license: MIT
compatibility: Python 3.10+
allowed-tools: web_search read_file
---

# Web Research Skill

## When to Use
- User asks for research on a topic
- Need to gather information from multiple sources

## Workflow
1. Define research scope
2. Search for information
3. Synthesize findings
```

## 技能元数据

```python
class SkillMetadata(TypedDict):
    path: str  # SKILL.md 路径
    name: str  # 技能名称 (1-64 字符)
    description: str  # 描述 (1-1024 字符)
    license: str | None  # 许可证
    compatibility: str | None  # 兼容性
    metadata: dict[str, str]  # 额外元数据
    allowed_tools: list[str]  # 推荐工具
```

## 初始化

```python
class SkillsMiddleware(AgentMiddleware[SkillsState, ContextT, ResponseT]):
    state_schema = SkillsState

    def __init__(
        self,
        *,
        backend: BACKEND_TYPES,
        sources: Sequence[SkillSource],
        system_prompt: str | None = SKILLS_SYSTEM_PROMPT,
    ):
        self._backend = backend
        self.sources = [_source_path(s) for s in sources]
        self.source_labels = [_derive_source_label(s) for s in sources]
        self.system_prompt_template = system_prompt
```

## 加载技能

```python
def before_agent(self, state, runtime, config) -> SkillsStateUpdate | None:
    """在 Agent 开始执行前加载技能"""
    if "skills_metadata" in state:
        return None  # 已加载

    backend = self._get_backend(state, runtime, config)
    all_skills: dict[str, SkillMetadata] = {}

    for source_path in self.sources:
        skills, error = _list_skills_with_errors(backend, source_path)
        for skill in skills:
            all_skills[skill["name"]] = skill  # 后加载的覆盖先加载的

    return SkillsStateUpdate(skills_metadata=list(all_skills.values()))
```

## 渐进式披露

系统提示只显示技能名称和描述，完整内容需要按需读取：

```
## Skills System

**Available Skills:**

- **web-research**: Conduct thorough web research (License: MIT)
  -> Read `/skills/web-research/SKILL.md` for full instructions
- **code-review**: Review code for quality and security
  -> Read `/skills/code-review/SKILL.md` for full instructions

**How to Use Skills:**
1. Recognize when a skill applies
2. Read the skill's full instructions with `read_file(path, limit=1000)`
3. Follow the skill's workflow
```

## 技能验证

```python
def _validate_skill_name(name: str, directory_name: str) -> tuple[bool, str]:
    """验证技能名称"""
    if not name:
        return False, "name is required"
    if len(name) > 64:
        return False, "name exceeds 64 characters"
    if name.startswith("-") or name.endswith("-") or "--" in name:
        return False, "name must be lowercase alphanumeric with single hyphens"
    if name != directory_name:
        return False, f"name '{name}' must match directory name '{directory_name}'"
    return True, ""
```

## 使用示例

```python
agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    backend=FilesystemBackend(root_dir="/"),
    skills=[
        "/skills/user/",  # 用户技能
        "/skills/project/",  # 项目技能
    ],
)
```

## 下一步

- [MemoryMiddleware](./memory-middleware.md)
- [create_deep_agent](./create-deep-agent.md)