export async function withHiddenWindowAnimationFrames<T>(
  windowRef: Window,
  operation: () => Promise<T>
) {
  const requestAnimationFrame = windowRef.requestAnimationFrame;
  windowRef.requestAnimationFrame = (callback) =>
    windowRef.setTimeout(
      () => callback(windowRef.performance.now()),
      0
    );
  try {
    return await operation();
  } finally {
    windowRef.requestAnimationFrame = requestAnimationFrame;
  }
}
