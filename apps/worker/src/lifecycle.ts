/** Upload must finish before teardown. Cleanup also runs on partial capture and
 * uncertain uploads; the durable run is never automatically replayed. */
export async function captureLifecycle<Media, Artifact>(operations: {
  capture: () => Promise<Media>;
  upload: (media: Media) => Promise<Artifact>;
  cleanup: () => Promise<void>;
}): Promise<Artifact> {
  try {
    return await operations.upload(await operations.capture());
  } finally {
    await operations.cleanup();
  }
}
