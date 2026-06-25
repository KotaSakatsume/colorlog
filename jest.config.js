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
  // @humation/* は ESM（"type":"module"）パッケージなので、node_modules でも
  // babel-jest で CJS にトランスパイルする必要がある。これが無いと
  // `SyntaxError: Unexpected token 'export'` で avatar 系テストが落ちる。
  transformIgnorePatterns: ['node_modules/(?!(?:@humation)/)'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // @humation/* の package.json#exports は `import` 条件のみで、jest 既定の CJS
    // 条件では解決できず "Cannot find module" になる。exports を介さず dist エントリへ
    // 直接マップする（transformIgnorePatterns の whitelist で babel 変換される）。
    '^@humation/core$': '<rootDir>/node_modules/@humation/core/dist/index.js',
    '^@humation/assets-humation-1$':
      '<rootDir>/node_modules/@humation/assets-humation-1/dist/index.js',
  },
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  // セキュリティルールのテスト（tests/rules/**）はエミュレータ接続必須のため、
  // デフォルト jest からは確実に除外する（jest.rules.config.js + npm run test:rules で実行）。
  testPathIgnorePatterns: ['/node_modules/', '/tests/rules/'],
};
