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
  if (!candidate) {
    return PERMISSION_MODE_DEFAULT;
  }

  if (PERMISSION_MODES.includes(candidate)) {
    return candidate;
  }

  console.warn(`Unknown notion2cli permission mode "${candidate}". Falling back to default.`);
  return PERMISSION_MODE_DEFAULT;
}

export function buildRuntimeLaunchCommand(runtimeId, permissionMode) {
  // MUST stay in sync with server/core/permission-mode.mjs launch command builders.
  const runtime = String(runtimeId || '').trim().toLowerCase();
  const mode = normalizePermissionMode(permissionMode);

  if (runtime === 'claude') {
    return mode === PERMISSION_MODE_DEFAULT
      ? 'notion2cli claude launch'
      : `notion2cli claude launch --permission-mode ${mode}`;
  }

  return mode === PERMISSION_MODE_DEFAULT
    ? 'notion2cli daemon start --runtime codex'
    : `notion2cli daemon start --runtime codex --permission-mode ${mode}`;
}

export function getPermissionModeHint(permissionMode) {
  switch (normalizePermissionMode(permissionMode)) {
    case PERMISSION_MODE_AUTO_REVIEW:
      return 'Reduces prompts while keeping a review layer for risky actions.';
    case PERMISSION_MODE_FULL_ACCESS:
      return 'Disables sandbox and approval prompts. Use only in trusted workspaces.';
    case PERMISSION_MODE_DEFAULT:
    default:
      return 'Recommended. Uses the runtime default safety checks.';
  }
}
