const path = require('path');
const { getConfig } = require('react-native-builder-bob/babel-config');
const pkg = require('../package.json');

const root = path.resolve(__dirname, '..');

module.exports = getConfig(
  {
    presets: ['module:@react-native/babel-preset'],
    plugins: [
      // The licence token reaches JS as a build-time constant, not a runtime lookup: this plugin
      // inlines `.env` values at the `import … from '@env'` site, so there is no native module to
      // link and the same mechanism works on both platforms.
      //
      // `allowUndefined: true` is deliberate. A missing token must NOT fail the build — debuggable
      // installs are waived by both SDKs, so `npm run android` has to keep working for anyone who
      // cloned this repo without a licence. The failure surfaces where it is actionable instead:
      // ready() resolves `licenseMissing` on a release build.
      [
        'module:react-native-dotenv',
        {
          moduleName: '@env',
          path: '.env',
          allowUndefined: true,
        },
      ],
    ],
  },
  { root, pkg }
);
