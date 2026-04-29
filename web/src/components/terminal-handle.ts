import type { RefObject } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal as XTerm } from '@xterm/xterm';
import type { TerminalHandle } from './Terminal';

export type TerminalInstanceLike = Pick<
  XTerm,
  'write' | 'clear' | 'focus' | 'cols' | 'rows'
> & {
  reset?: () => void;
};

export function createTerminalHandle(
  xtermRef: RefObject<TerminalInstanceLike | null>,
  fitRef: RefObject<FitAddon | null>
): TerminalHandle {
  return {
    write(data: string | Uint8Array) {
      xtermRef.current?.write(data);
    },
    clear() {
      const terminal = xtermRef.current;
      if (!terminal) return;
      // reset() clears the active viewport and parser state; clear() alone can
      // leave prior screen content visible, which is not the desired stop behavior.
      terminal.reset?.();
      if (!terminal.reset) terminal.clear();
    },
    focus() {
      xtermRef.current?.focus();
    },
    fit() {
      fitRef.current?.fit();
    },
    get cols() {
      return xtermRef.current?.cols ?? 120;
    },
    get rows() {
      return xtermRef.current?.rows ?? 40;
    }
  };
}
