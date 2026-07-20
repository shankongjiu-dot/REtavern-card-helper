import { useEffect, useRef } from 'react';

/**
 * 防抖版 useEffect：依赖变化后延迟 delay ms 才执行回调。
 * 适用于频繁触发但无需每次立即执行的场景（如输入时自动重新生成派生内容）。
 *
 * @param effect - 要执行的副作用函数
 * @param deps - 依赖数组（与 useEffect 相同语义）
 * @param delay - 防抖延迟（毫秒），默认 300ms
 */
export function useDebouncedEffect(
  effect: () => void,
  deps: unknown[],
  delay = 300,
): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const effectRef = useRef(effect);
  effectRef.current = effect;

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      effectRef.current();
    }, delay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
