export async function withUploadedFileRollback<T>(
  key: string,
  operation: () => Promise<T>,
  remove: (key: string) => Promise<void>,
  onRemoveError?: (error: unknown) => void
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    try {
      await remove(key);
    } catch (cleanupError) {
      onRemoveError?.(cleanupError);
    }
    throw error;
  }
}
