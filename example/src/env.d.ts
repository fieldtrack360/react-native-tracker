// Types for the `@env` module react-native-dotenv synthesises from `example/.env`.
//
// Every value is `string | undefined`, not `string`: the plugin runs with `allowUndefined: true`
// so a clone with no `.env` still builds, and pretending otherwise here would hide the one case
// this module exists to make visible.
declare module '@env' {
  export const TRACKER_LICENSE: string | undefined;
}

declare module '*.png' {
  const source: number;
  export default source;
}
