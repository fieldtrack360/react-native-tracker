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

// Headless registration surface. `registerHeadlessTask` is replaced per-test; `Platform.OS` is a
// mutable field because the wrapper reads it at CALL time, so a test can flip platforms without
// resetting the module registry.
export const Platform: { OS: string } = { OS: 'android' };

export const AppRegistry: {
  registerHeadlessTask: (
    key: string,
    provider: () => (data: unknown) => Promise<void>
  ) => void;
} = {
  registerHeadlessTask: () => {},
};
