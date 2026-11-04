export function displayPriority(
  computed: string,
  override: string | null | undefined,
) {
  return (override || computed || "medium").toUpperCase();
}

export function signedOrDemoUrl(path: string, signed?: string | null) {
  if (path.startsWith("demo/") || path.startsWith("/demo/")) {
    return path.startsWith("/") ? path : `/${path}`;
  }
  return signed || "";
}
