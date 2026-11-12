import { AppState } from 'react-native';

type NetworkState = { isConnected?: boolean | null };
type NetworkSubscriber = (listener: (state: NetworkState) => void) => { remove(): void };
declare const require: (moduleName: string) => { addNetworkStateListener: NetworkSubscriber };
const subscribeNetwork: NetworkSubscriber = (listener) => require('expo-network').addNetworkStateListener(listener);

/** Wake durable sync when the device transitions back to a connected network. */
export function onConnectionRestored(callback: () => void, subscribe: NetworkSubscriber = subscribeNetwork) {
  let wasConnected = false;
  return subscribe((state) => {
    const connected = state.isConnected === true;
    if (connected && !wasConnected) callback();
    wasConnected = connected;
  });
}

/** Subscribe to foreground transitions so durable pending work resumes on app return. */
export function onForeground(callback: () => void, subscribe = AppState.addEventListener.bind(AppState), initialState: string | null | undefined = AppState.currentState) {
  let previous = initialState;
  return subscribe('change', (next) => {
    const wasBackgrounded = previous !== 'active';
    previous = next;
    if (next === 'active' && wasBackgrounded) callback();
  });
}
