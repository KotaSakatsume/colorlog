/**
 * セキュリティルール（Firestore/Storage）の rules-unit-testing 専用 Jest 設定。
 *
 * デフォルトの jest.config.js とは分離する。これらのテストは Firebase エミュレータ
 * （firestore/storage）への接続が必須で、エミュレータ非起動環境では必ず接続エラーで
 * 落ちるため、`npm run test:rules`（firebase emulators:exec 経由）からのみ実行する。
 *
 * デフォルト jest（npm test）は jest.config.js の testPathIgnorePatterns で
 * tests/rules を除外している。
 */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.[jt]sx?$': ['babel-jest', { presets: ['babel-preset-expo'] }],
  },
  // src を import しないため moduleNameMapper（@/）は不要。
  testMatch: ['<rootDir>/tests/rules/**/*.test.ts'],
};
