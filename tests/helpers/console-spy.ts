import { rstest } from 'rstack/test';

const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
};

export function silenceConsole() {
  console.log = rstest.fn();
  console.warn = rstest.fn();
  console.error = rstest.fn();
}

export function restoreConsole() {
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
}
