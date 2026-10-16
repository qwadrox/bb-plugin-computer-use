/** The message of anything thrown, for logs and tool results. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
