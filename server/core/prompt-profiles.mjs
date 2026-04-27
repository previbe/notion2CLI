export const PROMPT_PROFILE_RAW = 'raw';
export const PROMPT_PROFILE_BUILD = 'build';

const BUILD_INSTRUCTION = `Turn the requirements in the input document into concrete changes in the current codebase, then finish with a Brief.
Match the output language to the document's primary language.

## Task Judgment

- If the requirements are ambiguous but can be implemented safely from the existing code and the smallest viable change, make a careful decision and proceed.
- Stop only when critical information is missing and implementation would be unsafe. Explain the blocker in the Brief.

## Before Implementing

1. Read the input document and extract the goal, constraints, acceptance criteria, and explicit non-goals.
2. Use the available file search, reading, editing, and command execution tools to understand the project structure, coding style, and existing conventions.
3. Prefer the existing architecture, components, toolchain, and test patterns.

## While Implementing

- Make the necessary architecture and technical decisions yourself.
- Directly update the relevant code, configuration, tests, or documentation.
- Keep the change tightly scoped to the request. Avoid unrelated refactors.
- Follow the codebase's existing style, naming, directory structure, and error-handling patterns.
- Add focused tests for high-risk or cross-module changes.
- Verify when possible. If verification is not possible, explain why.

## After Implementing

Return only a Brief. Do not include a long process log.

The Brief must include:

- summary: explain what was built in language the user can understand.
- reason:
  1. Key decisions and why they were made.
  2. Verification completed.
  3. Known limitations and follow-up work.`;

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
