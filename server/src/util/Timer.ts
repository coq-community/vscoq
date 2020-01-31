export function timeout<T>(
  operation: Promise<T>,
  timeMs: number,
  ...timeoutData: any[]
): Promise<{} | T> {
  var timeout: NodeJS.Timer = null;
  return Promise.race([
    new Promise(
      (resolve, reject) =>
        (timeout = setTimeout(reject, timeMs, ...timeoutData))
    ),
    operation.then(v => {
      clearTimeout(timeout);
      return v;
    })
  ]);
}
