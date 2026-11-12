import { describe, expect, it, jest } from '@jest/globals';
import { onConnectionRestored, onForeground } from '../connectivity';

describe('foreground sync wakeup', () => {
  it('wakes once connectivity is restored, not for disconnected or unknown states', () => {
    let listener: ((state: { isConnected?: boolean | null }) => void) | undefined;
    const callback = jest.fn();
    const subscribe = (next: (state: { isConnected?: boolean | null }) => void) => { listener = next; return { remove: jest.fn() }; };
    onConnectionRestored(callback, subscribe);
    listener?.({ isConnected: null });
    listener?.({ isConnected: false });
    expect(callback).not.toHaveBeenCalled();
    listener?.({ isConnected: true });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('wakes only on background-to-active transition and unsubscribes', () => {
    let listener: ((state: string) => void) | undefined;
    const remove = jest.fn();
    const callback = jest.fn();
    const subscribe = (_event: any, next: (state: any) => void) => { listener = next; return { remove }; };
    const unsubscribe = onForeground(callback, subscribe as never, 'active');
    listener?.('background');
    expect(callback).not.toHaveBeenCalled();
    listener?.('active');
    expect(callback).toHaveBeenCalledTimes(1);
    listener?.('active');
    expect(callback).toHaveBeenCalledTimes(1);
    unsubscribe.remove();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
