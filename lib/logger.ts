export function getErrorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

export function getSafeErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return "Unknown error";
  return error.message
    .replace(/\b(?:postgres(?:ql)?|mysql|redis):\/\/[^\s"'<>]+/gi, "[redacted connection URL]")
    .replace(/\b(password|secret|token|api[_-]?key)\b\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bsb_secret_[A-Za-z0-9_-]+\b/gi, "[redacted service key]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted JWT]")
    .slice(0, 300);
}

export function logError(event: string, error: unknown, eventId = crypto.randomUUID()) {
  const code = getErrorCode(error);
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    eventId,
    errorName: error instanceof Error ? error.name : "UnknownError",
    message: getSafeErrorMessage(error),
    code
  }));
  return eventId;
}
