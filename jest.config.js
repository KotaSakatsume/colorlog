/**
 * ドメインロジックのユニットテスト用 Jest 設定。
 *
 * アプリ本体の Metro/Babel パイプラインには触れず、jest 実行時だけ
 * babel-preset-expo で TypeScript をトランスパイルする。
 * `@/` パスエイリアスは tsconfig と揃えて src/ に解決する。
 */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.[jt]sx?$': ['babel-jest', { presets: ['babel-preset-expo'] }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
};
