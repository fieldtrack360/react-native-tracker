// The slice of `react-native` the wrapper touches at import time: the emitter it opens its streams
// over, and the registry the two TurboModule specs resolve through. Both are replaced per-test.
export class NativeEventEmitter {
  addListener() {
    return { remove() {} };
  }
}

export const TurboModuleRegistry = {
  getEnforcing: <T>(): T => ({}) as T,
};

export function codegenNativeComponent<T>(name: string): T {
  return name as unknown as T;
}

export type EmitterSubscription = { remove: () => void };
export type HostComponent<T> = T;
export type ViewProps = Record<string, unknown>;
export type NativeSyntheticEvent<T> = { nativeEvent: T };
