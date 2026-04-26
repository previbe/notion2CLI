export const PROMPT_PROFILE_RAW = 'raw';
export const PROMPT_PROFILE_BUILD = 'build';

const BUILD_INSTRUCTION = `PreVibe 是一套将文档推进到软件的开发系统。你是 PreVibe 的开发执行引擎。现在根据输入文档开始构建。

输出语言匹配文档主语言。

## 执行前

1. 完整阅读输入文档，理解目标、约束和验收标准。
2. 使用 Glob/Grep/Read 等方式了解当前项目结构、代码风格和已有约定。
3. 如果文档存在明显歧义，优先根据现有代码和最小可行实现做审慎决策；只有在无法安全推进时才说明阻塞。

## 执行中

- 自行完成必要的架构和技术决策。
- 使用 Write/Edit/Bash 等工具直接完成代码修改。
- 遵循当前代码库已有的风格、结构和约定。
- 不做与文档目标无关的重构。
- 如果任务确实要求更新当前 Notion 文档，可以使用 Notion MCP 修改当前页面；否则不要修改 Notion 正文。

## 执行后

最终输出 Brief，包含：

- summary：用用户能理解的语言说明构建了什么。
- reason：用清晰分段说明：
  1. 关键决策及原因
  2. 已完成的验证
  3. 已知限制和后续改进方向`;

const PROMPT_PROFILES = new Map([
  [
    PROMPT_PROFILE_RAW,
    {
      id: PROMPT_PROFILE_RAW,
      name: '原样运行',
      instruction: '',
    },
  ],
  [
    PROMPT_PROFILE_BUILD,
    {
      id: PROMPT_PROFILE_BUILD,
      name: 'Build',
      instruction: BUILD_INSTRUCTION,
    },
  ],
]);

export function listPromptProfiles() {
  return [...PROMPT_PROFILES.values()].map(clonePromptProfile);
}

export function isPromptProfileId(value) {
  return PROMPT_PROFILES.has(normalizePromptProfileId(value));
}

export function normalizePromptProfileId(value) {
  const candidate = String(value || PROMPT_PROFILE_RAW).trim().toLowerCase();
  return candidate || PROMPT_PROFILE_RAW;
}

export function getPromptProfile(value) {
  const id = normalizePromptProfileId(value);
  const profile = PROMPT_PROFILES.get(id);
  return profile ? clonePromptProfile(profile) : null;
}

function clonePromptProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    instruction: profile.instruction,
  };
}
