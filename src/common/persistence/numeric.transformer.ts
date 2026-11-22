import type { ValueTransformer } from 'typeorm';

/** PostgreSQL `numeric` arrives as a string; expose it as a JS number. */
export const numericTransformer: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};
