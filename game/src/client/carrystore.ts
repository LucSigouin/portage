/**
 * Where a guest keeps its own pack and meters between crews: one slot per typed
 * name in this browser's storage (`portage.crew.carry.<name>`). Per name, since
 * several tabs of one browser may join under different names.
 *
 * It only ever keeps what the host sent: the guest's own player as the host
 * last confirmed it, never the guest's own guess. No storage, or storage that
 * throws: nothing is kept and nothing is said, and the game plays as it would.
 */
import { readCarry } from '../net/carry.ts';
import type { Carry, CarryKeeper } from '../net/carry.ts';

/** The storage this needs. A browser's `localStorage` is one. */
export interface CarryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** At most one write in this many seconds while playing. Leaving writes at once. */
export const CARRY_WRITE_SECONDS = 5;

export const carrySlot = (name: string): string => `portage.crew.carry.${name}`;

export class CarryStore implements CarryKeeper {
  private readonly slot: string;
  /** What is in the slot, as this store last wrote or read it. */
  private written: string | null = null;
  /** The newest carry the host confirmed, not yet written. */
  private pending: string | null = null;
  /** The clock of the last write. Starts far back so the first change is written at once. */
  private writtenAt = Number.NEGATIVE_INFINITY;

  private readonly storage: CarryStorage | null;

  constructor(name: string, storage: CarryStorage | null) {
    this.slot = carrySlot(name);
    this.storage = storage;
  }

  /** The kept carry, checked as strictly as the host checks it. Null when there is none or it does not read. */
  read(): Carry | null {
    try {
      const text = this.storage?.getItem(this.slot) ?? null;
      if (text === null) return null;
      this.written = text;
      return readCarry(JSON.parse(text));
    } catch {
      return null;
    }
  }

  /** The host confirmed this carry at `clock` seconds. Written when it changed, at most every `CARRY_WRITE_SECONDS`. */
  note(carry: Carry, clock: number): void {
    if (!this.storage) return;
    this.pending = JSON.stringify(carry);
    if (clock - this.writtenAt >= CARRY_WRITE_SECONDS && this.write()) this.writtenAt = clock;
  }

  /** Leaving: write what is waiting now. */
  flush(): void {
    this.write();
  }

  /** Write the waiting carry if it differs from the slot. True when the slot was written. */
  private write(): boolean {
    const text = this.pending;
    if (text === null || text === this.written || !this.storage) return false;
    try {
      this.storage.setItem(this.slot, text);
      this.written = text;
      this.pending = null;
      return true;
    } catch {
      return false;
    }
  }
}
