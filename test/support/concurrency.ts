/** A promise the test resolves explicitly, to hold a fake provider call "in flight". */
export interface Gate {
  promise: Promise<void>;
  open: () => void;
}

export function gate(): Gate {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
}

/** Polls until `condition` holds (or fails the test after `timeoutMs`). */
export async function waitUntil(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('waitUntil: condition not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
