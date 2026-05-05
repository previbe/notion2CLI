import { randomUUID } from 'node:crypto';
import { getAppPaths, readJsonFile, writeJsonFile } from '../../cli/paths.mjs';
import { createHttpError, nowIso } from './constants.mjs';

export const PROMPT_PROFILE_RAW = 'raw';
export const PROMPT_PROFILE_PREVIBE = 'previbe';
export const PROMPT_PROFILE_BUILD = 'build';

const STORE_VERSION = 1;
const MAX_NAME_LENGTH = 48;
const MAX_INSTRUCTION_LENGTH = 50000;

const PREVIBE_INSTRUCTION = `Move the input document toward a development-ready brief without losing useful information.

## Rules

- Preserve information value. Compress or remove source notes only after their useful content has been absorbed.
- Treat meeting notes, quick starts, loose ideas, questions, and other seed material as raw input to distill.
- Mark every inference with ⚠️ and an impact label: 🟢 low (easy to change), 🟡 medium (directional), 🔴 high (needs user confirmation).
- Put one blank line between separate confirmation items.
- Do not invent requirements or constraints. When details are missing, mark a ⚠️ assumption and keep progressing on parts that do not depend on it.
- Optimize for decision-ready information, not formatting. Be concise and avoid unnecessary process detail.
- Reply in English by default unless the user requests another language.
- Return only a Brief. Do not include a long process log.`;

const BUILD_INSTRUCTION = `Turn the requirements in the input document into concrete changes in the current codebase, then finish with a Brief.
Reply in English by default unless the user requests another language.

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

const BUILTIN_PROFILES = [
  {
    id: PROMPT_PROFILE_RAW,
    name: 'Raw',
    instruction: '',
    source: 'builtin',
    builtin: true,
    editable: false,
    deletable: false,
    resettable: false,
    order: 10,
  },
  {
    id: PROMPT_PROFILE_PREVIBE,
    name: 'PreVibe',
    instruction: PREVIBE_INSTRUCTION,
    source: 'builtin',
    builtin: true,
    editable: true,
    deletable: true,
    resettable: true,
    order: 20,
  },
  {
    id: PROMPT_PROFILE_BUILD,
    name: 'Build',
    instruction: BUILD_INSTRUCTION,
    source: 'builtin',
    builtin: true,
    editable: true,
    deletable: true,
    resettable: true,
    order: 25,
  },
];

const BUILTIN_PROFILE_IDS = new Set(BUILTIN_PROFILES.map((profile) => profile.id));

export function normalizePromptProfileId(value) {
  const candidate = String(value || PROMPT_PROFILE_RAW).trim().toLowerCase();
  return candidate || PROMPT_PROFILE_RAW;
}

export function getBuiltinPromptProfile(id) {
  const normalizedId = normalizePromptProfileId(id);
  const profile = BUILTIN_PROFILES.find((item) => item.id === normalizedId);
  return profile ? clonePromptProfile(profile) : null;
}

export function listBuiltinPromptProfiles() {
  return BUILTIN_PROFILES.map(clonePromptProfile);
}

export class PromptProfileStore {
  constructor({ filePath = getAppPaths().promptProfilesFile } = {}) {
    this.filePath = filePath;
  }

  async list() {
    const data = await this.readStore();
    return this.mergeProfiles(data);
  }

  async resolve(id) {
    const normalizedId = normalizePromptProfileId(id);
    return (await this.list()).find((profile) => profile.id === normalizedId) || null;
  }

  async create(input) {
    const data = await this.readStore();
    const now = nowIso();
    const order = nextProfileOrder(data.profiles);
    const profile = {
      id: `custom-${randomUUID()}`,
      name: normalizePromptName(input?.name),
      instruction: normalizePromptInstruction(input?.instruction),
      source: 'user',
      order,
      createdAt: now,
      updatedAt: now,
    };

    data.profiles.push(profile);
    await this.writeStore(data);
    return this.resolve(profile.id);
  }

  async update(id, input) {
    const normalizedId = normalizePromptProfileId(id);
    if (normalizedId === PROMPT_PROFILE_RAW) {
      throw createHttpError(400, 'The raw prompt profile cannot be edited');
    }

    const name = normalizePromptName(input?.name);
    const instruction = normalizePromptInstruction(input?.instruction);
    const data = await this.readStore();
    const now = nowIso();
    const existingIndex = data.profiles.findIndex((profile) => normalizePromptProfileId(profile.id) === normalizedId);

    if (BUILTIN_PROFILE_IDS.has(normalizedId)) {
      const builtin = getBuiltinPromptProfile(normalizedId);
      if (!builtin?.editable) {
        throw createHttpError(400, `Prompt profile ${normalizedId} cannot be edited`);
      }

      const previous = existingIndex >= 0 ? data.profiles[existingIndex] : {};
      const profile = {
        id: normalizedId,
        name,
        instruction,
        source: 'builtin_override',
        order: Number.isFinite(Number(previous.order)) ? Number(previous.order) : builtin.order,
        createdAt: previous.createdAt || now,
        updatedAt: now,
      };
      if (existingIndex >= 0) {
        data.profiles[existingIndex] = profile;
      } else {
        data.profiles.push(profile);
      }
      data.hiddenBuiltinIds = data.hiddenBuiltinIds.filter((hiddenId) => hiddenId !== normalizedId);
      await this.writeStore(data);
      return this.resolve(normalizedId);
    }

    if (existingIndex < 0) {
      throw createHttpError(404, `Unknown prompt profile: ${normalizedId}`);
    }

    const previous = data.profiles[existingIndex];
    data.profiles[existingIndex] = {
      ...previous,
      id: normalizedId,
      name,
      instruction,
      source: 'user',
      updatedAt: now,
    };
    await this.writeStore(data);
    return this.resolve(normalizedId);
  }

  async delete(id) {
    const normalizedId = normalizePromptProfileId(id);
    if (normalizedId === PROMPT_PROFILE_RAW) {
      throw createHttpError(400, 'The raw prompt profile cannot be deleted');
    }

    const data = await this.readStore();
    const existingIndex = data.profiles.findIndex((profile) => normalizePromptProfileId(profile.id) === normalizedId);

    if (BUILTIN_PROFILE_IDS.has(normalizedId)) {
      const builtin = getBuiltinPromptProfile(normalizedId);
      if (!builtin?.deletable) {
        throw createHttpError(400, `Prompt profile ${normalizedId} cannot be deleted`);
      }

      data.profiles = data.profiles.filter((profile) => normalizePromptProfileId(profile.id) !== normalizedId);
      if (!data.hiddenBuiltinIds.includes(normalizedId)) {
        data.hiddenBuiltinIds.push(normalizedId);
      }
      await this.writeStore(data);
      return { deleted: true, id: normalizedId };
    }

    if (existingIndex < 0) {
      throw createHttpError(404, `Unknown prompt profile: ${normalizedId}`);
    }

    data.profiles.splice(existingIndex, 1);
    await this.writeStore(data);
    return { deleted: true, id: normalizedId };
  }

  async reset(id) {
    const normalizedId = normalizePromptProfileId(id);
    const builtin = getBuiltinPromptProfile(normalizedId);
    if (!builtin || !builtin.resettable) {
      throw createHttpError(400, `Prompt profile ${normalizedId} cannot be reset`);
    }

    const data = await this.readStore();
    data.profiles = data.profiles.filter((profile) => normalizePromptProfileId(profile.id) !== normalizedId);
    data.hiddenBuiltinIds = data.hiddenBuiltinIds.filter((hiddenId) => hiddenId !== normalizedId);
    await this.writeStore(data);
    return this.resolve(normalizedId);
  }

  async readStore() {
    const raw = await readJsonFile(this.filePath);
    if (!raw) {
      return emptyStore();
    }

    return normalizeStore(raw);
  }

  async writeStore(data) {
    await writeJsonFile(this.filePath, normalizeStore(data));
  }

  mergeProfiles(data) {
    const overrides = new Map();
    const userProfiles = [];
    const hidden = new Set(data.hiddenBuiltinIds);

    for (const profile of data.profiles) {
      const normalizedId = normalizePromptProfileId(profile.id);
      if (BUILTIN_PROFILE_IDS.has(normalizedId)) {
        overrides.set(normalizedId, profile);
      } else {
        userProfiles.push(profile);
      }
    }

    const profiles = [];
    for (const builtin of BUILTIN_PROFILES) {
      if (hidden.has(builtin.id)) {
        continue;
      }

      const override = overrides.get(builtin.id);
      profiles.push(clonePromptProfile({
        ...builtin,
        ...override,
        id: builtin.id,
        source: override ? 'builtin_override' : 'builtin',
        builtin: true,
        editable: builtin.editable,
        deletable: builtin.deletable,
        resettable: builtin.resettable,
        order: builtin.order,
      }));
    }

    for (const profile of userProfiles) {
      profiles.push(clonePromptProfile({
        ...profile,
        source: 'user',
        builtin: false,
        editable: true,
        deletable: true,
        resettable: false,
      }));
    }

    return profiles.sort(compareProfiles);
  }
}

function emptyStore() {
  return {
    version: STORE_VERSION,
    profiles: [],
    hiddenBuiltinIds: [],
  };
}

function normalizeStore(value) {
  const profiles = Array.isArray(value?.profiles) ? value.profiles : [];
  const hiddenBuiltinIds = Array.isArray(value?.hiddenBuiltinIds)
    ? value.hiddenBuiltinIds.map(normalizePromptProfileId).filter((id) => BUILTIN_PROFILE_IDS.has(id))
    : [];

  return {
    version: STORE_VERSION,
    profiles: profiles.map(normalizeStoredProfile).filter(Boolean),
    hiddenBuiltinIds: [...new Set(hiddenBuiltinIds)],
  };
}

function normalizeStoredProfile(profile) {
  const id = normalizePromptProfileId(profile?.id);
  if (!id) {
    return null;
  }

  try {
    return {
      id,
      name: normalizePromptName(profile?.name),
      instruction: normalizePromptInstruction(profile?.instruction),
      source: profile?.source === 'builtin_override' && BUILTIN_PROFILE_IDS.has(id) ? 'builtin_override' : 'user',
      order: Number.isFinite(Number(profile?.order)) ? Number(profile.order) : 100,
      createdAt: String(profile?.createdAt || ''),
      updatedAt: String(profile?.updatedAt || ''),
    };
  } catch {
    return null;
  }
}

function normalizePromptName(value) {
  const name = String(value || '').trim();
  if (!name) {
    throw createHttpError(400, 'Prompt name is required');
  }

  if (name.length > MAX_NAME_LENGTH) {
    throw createHttpError(400, `Prompt name must be ${MAX_NAME_LENGTH} characters or fewer`);
  }

  return name;
}

function normalizePromptInstruction(value) {
  const instruction = String(value || '').trim();
  if (!instruction) {
    throw createHttpError(400, 'Prompt instruction is required');
  }

  if (instruction.length > MAX_INSTRUCTION_LENGTH) {
    throw createHttpError(400, `Prompt instruction must be ${MAX_INSTRUCTION_LENGTH} characters or fewer`);
  }

  return instruction;
}

function nextProfileOrder(profiles) {
  const maxOrder = profiles.reduce((max, profile) => {
    const order = Number(profile?.order);
    return Number.isFinite(order) ? Math.max(max, order) : max;
  }, 20);
  return maxOrder + 10;
}

function compareProfiles(a, b) {
  const orderDelta = Number(a.order || 0) - Number(b.order || 0);
  if (orderDelta !== 0) {
    return orderDelta;
  }

  return String(a.name || '').localeCompare(String(b.name || ''));
}

function clonePromptProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    instruction: profile.instruction,
    source: profile.source,
    builtin: Boolean(profile.builtin),
    editable: profile.editable !== false,
    deletable: Boolean(profile.deletable),
    resettable: Boolean(profile.resettable),
    order: Number.isFinite(Number(profile.order)) ? Number(profile.order) : 100,
    createdAt: profile.createdAt || '',
    updatedAt: profile.updatedAt || '',
  };
}
