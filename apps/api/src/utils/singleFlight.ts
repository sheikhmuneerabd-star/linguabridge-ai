interface Flight<T> {
  promise: Promise<T>;
  controller: AbortController;
  waiters: number;
}

const flights = new Map<string, Flight<unknown>>();

export async function singleFlight<T>(
  key: string,
  run: (signal: AbortSignal) => Promise<T>,
  callerSignal?: AbortSignal
): Promise<{ value: T; shared: boolean }> {
  let flight = flights.get(key) as Flight<T> | undefined;
  const shared = flight !== undefined;

  if (!flight) {
    const controller = new AbortController();
    const promise = run(controller.signal).finally(() => flights.delete(key));
    flight = { promise, controller, waiters: 0 };
    flights.set(key, flight);
  }

  const f = flight;
  f.waiters++;

  let left = false;
  const leave = () => {
    if (left) return;
    left = true;
    f.waiters--;
    if (f.waiters <= 0) f.controller.abort();
  };

  if (callerSignal?.aborted) leave();
  else callerSignal?.addEventListener("abort", leave, { once: true });

  try {
    return { value: await f.promise, shared };
  } finally {
    left = true;
    callerSignal?.removeEventListener("abort", leave);
  }
}