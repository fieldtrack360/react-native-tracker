import { AppRegistry } from 'react-native';
import { registerHeadlessTask } from '@fieldtrack360/react-native-tracker';
import App from './src/App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);

// Android headless delivery. THIS FILE is the only place it can go: a headless boot evaluates the
// bundle root and nothing else, so a registration inside a screen or a provider never runs.
//
// `params` is the same TrackerEvent onTrackerEvent() delivers. The task ends — and the native wake
// lock is released — when this promise settles, so every piece of work has to be awaited.
registerHeadlessTask(async ({ name, params }) => {
  console.log('[TrackerHeadless]', name, JSON.stringify(params));
});

if (typeof document !== 'undefined') {
  AppRegistry.runApplication(appName, {
    rootTag: document.getElementById('root'),
  });
}
