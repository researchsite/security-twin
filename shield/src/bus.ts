import { EventEmitter } from "events";
import type { ShieldEvent } from "./types";

// Declaration-merging gives typed overloads without requiring Node 22+ generics.
export declare interface ShieldBus {
  emit(event: "event", data: ShieldEvent): boolean;
  on(event: "event", listener: (data: ShieldEvent) => void): this;
  once(event: "event", listener: (data: ShieldEvent) => void): this;
  off(event: "event", listener: (data: ShieldEvent) => void): this;
}

export class ShieldBus extends EventEmitter {}

// Singleton — import this from any in-process subscriber (orchestrator, tests, etc.)
export const shieldBus = new ShieldBus();
