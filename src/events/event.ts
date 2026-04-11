import type { MemoryEvent } from "../core/types.js";

export function isFailureEvent(event: MemoryEvent): boolean {
  return event.type === "tool_failed";
}
