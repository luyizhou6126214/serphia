/** Prevent a closed terminal pipe from crashing the desktop main process. */
export function handleClosedStdioPipes(
  streams: readonly NodeJS.WritableStream[] = [process.stdout, process.stderr],
): void {
  for (const stream of streams) {
    stream.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") throw error;
    });
  }
}
