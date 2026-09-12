export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public retryable = false,
  ) {
    super(message);
  }
}
export function safeError(error: unknown): string {
  return error instanceof AppError
    ? error.message
    : "The operation could not complete. Check the connection and try again.";
}
export const now = () => new Date().toISOString();
export const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
