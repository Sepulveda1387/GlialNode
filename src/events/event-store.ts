import type { MemoryEvent } from "../core/types.js";

export interface EventStore {
  append(event: MemoryEvent): Promise<void>;
}
