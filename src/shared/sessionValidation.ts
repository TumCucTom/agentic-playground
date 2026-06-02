// Pure validators for user-supplied session names. Both the main
// process (when persisting files) and the renderer (when accepting
// input) call these so the rules are identical.

export const SESSION_NAME_MAX_LENGTH = 64;
const SESSION_NAME_PATTERN = /^[a-zA-Z0-9 _-]+$/;

// Returns the trimmed, validated name. Throws on invalid input — the
// caller (typically an IPC handler) catches and surfaces the message
// to the UI. We throw rather than return a result union because the
// hot path is "name is fine, give me back the cleaned value", and
// throwing keeps the call sites short.
export function validateSessionName(raw: string): string {
  const name = raw.trim();
  if (name.length === 0) {
    throw new Error('Name cannot be empty');
  }
  if (name.length > SESSION_NAME_MAX_LENGTH) {
    throw new Error(`Name must be ${SESSION_NAME_MAX_LENGTH} characters or fewer`);
  }
  if (!SESSION_NAME_PATTERN.test(name)) {
    throw new Error('Use letters, numbers, spaces, underscores, or hyphens');
  }
  if (name.startsWith('.')) {
    throw new Error('That name is reserved');
  }
  return name;
}
