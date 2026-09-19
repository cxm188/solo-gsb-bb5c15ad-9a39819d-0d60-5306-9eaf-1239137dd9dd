import { useCallback, useState } from 'react';

const HISTORY_LIMIT = 200;

interface HistoryModel<T> {
  past: T[];
  present: T;
  future: T[];
}

/**
 * 仅用于边界调整（左/右边、整条移动）的撤销/重做栈。
 * 导入、清空等整体替换通过 reset 处理，并重置历史。
 */
export function useHistory<T>(initial: T) {
  const [state, setState] = useState<HistoryModel<T>>({
    past: [],
    present: initial,
    future: [],
  });

  const commit = useCallback((next: T | ((prev: T) => T)) => {
    setState((m) => {
      const resolved =
        typeof next === 'function' ? (next as (p: T) => T)(m.present) : next;
      const past = [...m.past, m.present];
      if (past.length > HISTORY_LIMIT) past.shift();
      return { past, present: resolved, future: [] };
    });
  }, []);

  /** 不进历史栈的整体替换（导入/清空/载入示例） */
  const reset = useCallback((next: T) => {
    setState({ past: [], present: next, future: [] });
  }, []);

  const undo = useCallback(() => {
    setState((m) => {
      const last = m.past[m.past.length - 1];
      if (last === undefined) return m;
      return {
        past: m.past.slice(0, -1),
        present: last,
        future: [m.present, ...m.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    setState((m) => {
      const next = m.future[0];
      if (next === undefined) return m;
      return {
        past: [...m.past, m.present],
        present: next,
        future: m.future.slice(1),
      };
    });
  }, []);

  return {
    present: state.present,
    commit,
    reset,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
