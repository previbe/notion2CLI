export const PERMISSION_MODE_DEFAULT = 'default';
export const PERMISSION_MODE_AUTO_REVIEW = 'auto-review';
export const PERMISSION_MODE_FULL_ACCESS = 'full-access';

export const PERMISSION_MODES = [
  PERMISSION_MODE_DEFAULT,
  PERMISSION_MODE_AUTO_REVIEW,
  PERMISSION_MODE_FULL_ACCESS,
];

export function normalizePermissionMode(value) {
  const candidate = String(value || '').trim().toLowerCase();
  if (!candidate || candidate === 'safe') {
    return PERMISSION_MODE_DEFAULT;
  }

  if (PERMISSION_MODES.includes(candidate)) {
    return candidate;
  }

  if (candidate === 'auto' || candidate === 'auto-review' || candidate === 'autoreview') {
    return PERMISSION_MODE_AUTO_REVIEW;
  }

  if (
    candidate === 'full'
    || candidate === 'full-access'
    || candidate === 'danger'
    || candidate === 'danger-full-access'
    || candidate === 'bypass'
    || candidate === 'bypasspermissions'
  ) {
    return PERMISSION_MODE_FULL_ACCESS;
  }

  throw new Error(`Invalid permission mode: ${value}. Valid values: ${PERMISSION_MODES.join(', ')}`);
}

export function getPermissionModeLabel(permissionMode) {
  switch (normalizePermissionMode(permissionMode)) {
    case PERMISSION_MODE_AUTO_REVIEW:
      return 'Auto review';
    case PERMISSION_MODE_FULL_ACCESS:
      return 'Full access';
    case PERMISSION_MODE_DEFAULT:
    default:
      return 'Default';
  }
}

export function getPermissionModeDetail(runtimeId, permissionMode) {
  const mode = normalizePermissionMode(permissionMode);
  const runtime = String(runtimeId || '').trim().toLowerCase();

  if (runtime === 'codex') {
    switch (mode) {
      case PERMISSION_MODE_AUTO_REVIEW:
        return 'Codex uses workspace-write sandboxing and routes approval prompts to auto review.';
      case PERMISSION_MODE_FULL_ACCESS:
        return 'Codex runs with danger-full-access and never asks for approval.';
      case PERMISSION_MODE_DEFAULT:
      default:
        return 'Codex uses workspace-write sandboxing and asks for approval on request.';
    }
  }

  if (runtime === 'claude') {
    switch (mode) {
      case PERMISSION_MODE_AUTO_REVIEW:
        return 'Claude Code starts with --permission-mode auto.';
      case PERMISSION_MODE_FULL_ACCESS:
        return 'Claude Code starts with --dangerously-skip-permissions.';
      case PERMISSION_MODE_DEFAULT:
      default:
        return 'Claude Code starts with its default permission settings.';
    }
  }

  return 'Default runtime permission settings are active.';
}

export function buildPermissionStatus(runtimeId, permissionMode) {
  const mode = normalizePermissionMode(permissionMode);
  return {
    permissionMode: mode,
    permissionLabel: getPermissionModeLabel(mode),
    permissionDetail: getPermissionModeDetail(runtimeId, mode),
  };
}

export function buildCodexLaunchCommand(permissionMode) {
  const mode = normalizePermissionMode(permissionMode);
  if (mode === PERMISSION_MODE_DEFAULT) {
    return 'notion2cli daemon start --runtime codex';
  }

  return `notion2cli daemon start --runtime codex --permission-mode ${mode}`;
}

export function buildClaudeLaunchCommand(permissionMode) {
  const mode = normalizePermissionMode(permissionMode);
  if (mode === PERMISSION_MODE_DEFAULT) {
    return 'notion2cli claude launch';
  }

  return `notion2cli claude launch --permission-mode ${mode}`;
}

// Codex app-server uses legacy string sandbox modes on thread start/resume,
// while turn overrides use the newer SandboxPolicy object shape.
export function buildCodexThreadPermissionParams(permissionMode) {
  switch (normalizePermissionMode(permissionMode)) {
    case PERMISSION_MODE_AUTO_REVIEW:
      return {
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
        sandbox: 'workspace-write',
      };
    case PERMISSION_MODE_FULL_ACCESS:
      return {
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
      };
    case PERMISSION_MODE_DEFAULT:
    default:
      return {
        approvalPolicy: 'on-request',
        sandbox: 'workspace-write',
      };
  }
}

export function buildCodexAuxiliaryThreadPermissionParams(permissionMode) {
  switch (normalizePermissionMode(permissionMode)) {
    case PERMISSION_MODE_AUTO_REVIEW:
      return {
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
        sandbox: 'read-only',
      };
    case PERMISSION_MODE_FULL_ACCESS:
      return {
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
      };
    case PERMISSION_MODE_DEFAULT:
    default:
      return {
        approvalPolicy: 'on-request',
        sandbox: 'read-only',
      };
  }
}

// Keep this object shape in sync with Codex app-server TurnStartParams.
export function buildCodexTurnPermissionParams(permissionMode) {
  switch (normalizePermissionMode(permissionMode)) {
    case PERMISSION_MODE_AUTO_REVIEW:
      return {
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
      };
    case PERMISSION_MODE_FULL_ACCESS:
      return {
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'dangerFullAccess' },
      };
    case PERMISSION_MODE_DEFAULT:
    default:
      return {
        approvalPolicy: 'on-request',
      };
  }
}

export function buildClaudePermissionArgs(permissionMode) {
  switch (normalizePermissionMode(permissionMode)) {
    case PERMISSION_MODE_AUTO_REVIEW:
      return ['--permission-mode', 'auto'];
    case PERMISSION_MODE_FULL_ACCESS:
      return ['--dangerously-skip-permissions'];
    case PERMISSION_MODE_DEFAULT:
    default:
      return [];
  }
}

export function inferClaudePermissionModeFromArgs(args, fallback = PERMISSION_MODE_DEFAULT) {
  const values = Array.isArray(args) ? args : [];
  for (let index = 0; index < values.length; index += 1) {
    const arg = String(values[index] || '').trim();
    if (arg === '--dangerously-skip-permissions') {
      return PERMISSION_MODE_FULL_ACCESS;
    }

    if (arg === '--permission-mode') {
      const next = String(values[index + 1] || '').trim();
      if (next === 'auto') {
        return PERMISSION_MODE_AUTO_REVIEW;
      }
      if (next === 'bypassPermissions') {
        return PERMISSION_MODE_FULL_ACCESS;
      }
    }

    if (arg.startsWith('--permission-mode=')) {
      const mode = arg.slice('--permission-mode='.length);
      if (mode === 'auto') {
        return PERMISSION_MODE_AUTO_REVIEW;
      }
      if (mode === 'bypassPermissions') {
        return PERMISSION_MODE_FULL_ACCESS;
      }
    }
  }

  return normalizePermissionMode(fallback);
}

export function hasClaudePermissionArgs(args) {
  return (Array.isArray(args) ? args : []).some((arg) => {
    const value = String(arg || '').trim();
    return value === '--dangerously-skip-permissions'
      || value === '--allow-dangerously-skip-permissions'
      || value === '--permission-mode'
      || value.startsWith('--permission-mode=');
  });
}
