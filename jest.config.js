// Deliberately not the React Native preset: these tests exercise the JS wrapper layer in isolation
// — what it forwards to the TurboModule — so a full RN runtime is cost without benefit. `react-native`
// and the two codegen deep imports are mapped to stubs; everything else is the real source.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts?(x)'],
  moduleNameMapper: {
    '^react-native$': '<rootDir>/src/__tests__/stubs/react-native.ts',
  },
};
