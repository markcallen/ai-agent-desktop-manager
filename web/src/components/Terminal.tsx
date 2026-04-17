import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

export interface TerminalHandle {
  write(data: string | Uint8Array): void;
  clear(): void;
  focus(): void;
  fit(): void;
  readonly cols: number;
  readonly rows: number;
}

interface Props {
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  /** When true, the terminal fills the container and uses a dark bg. */
  className?: string;
}

const THEME = {
  background: '#0d1117',
  foreground: '#c9d1d9',
  cursor: '#58a6ff',
  black: '#484f58',
  brightBlack: '#6e7681',
  red: '#ff7b72',
  brightRed: '#ffa198',
  green: '#3fb950',
  brightGreen: '#56d364',
  yellow: '#d29922',
  brightYellow: '#e3b341',
  blue: '#58a6ff',
  brightBlue: '#79c0ff',
  magenta: '#bc8cff',
  brightMagenta: '#d2a8ff',
  cyan: '#39c5cf',
  brightCyan: '#56d4dd',
  white: '#b1bac4',
  brightWhite: '#f0f6fc'
};

export const Terminal = forwardRef<TerminalHandle, Props>(
  ({ onData, onResize, className = '' }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<XTerm | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const onDataRef = useRef(onData);
    const onResizeRef = useRef(onResize);
    onDataRef.current = onData;
    onResizeRef.current = onResize;

    useEffect(() => {
      let term: XTerm | null = null;
      let observer: ResizeObserver | null = null;
      let disposed = false;

      const rafId = requestAnimationFrame(() => {
        if (disposed || !containerRef.current) return;

        term = new XTerm({
          theme: THEME,
          fontFamily: '"Cascadia Code", "Fira Code", Menlo, monospace',
          fontSize: 14,
          lineHeight: 1.2,
          cursorBlink: true,
          scrollback: 5000,
          allowProposedApi: true
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(containerRef.current!);
        fitAddon.fit();

        xtermRef.current = term;
        fitRef.current = fitAddon;

        term.onData((data) => onDataRef.current?.(data));
        term.onResize(({ cols, rows }) => onResizeRef.current?.(cols, rows));

        observer = new ResizeObserver(() => {
          if (!disposed) fitAddon.fit();
        });
        observer.observe(containerRef.current!);
      });

      return () => {
        disposed = true;
        cancelAnimationFrame(rafId);
        observer?.disconnect();
        term?.dispose();
        xtermRef.current = null;
        fitRef.current = null;
      };
    }, []);

    useImperativeHandle(ref, () => ({
      write(data: string | Uint8Array) {
        xtermRef.current?.write(data);
      },
      clear() {
        xtermRef.current?.clear();
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
    }));

    return (
      <div
        ref={containerRef}
        className={`w-full h-full rounded overflow-hidden ${className}`}
        style={{ backgroundColor: '#0d1117' }}
      />
    );
  }
);

Terminal.displayName = 'Terminal';
