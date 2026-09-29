import { define } from 'rstack';

define.lib({
  lib: [
    {
      bundle: true,
      dts: false,
      format: 'cjs',
      output: {
        cleanDistPath: true,
        externals: ['@rsdoctor/client'],
        legalComments: 'none',
        minify: {
          css: false,
          js: true,
          jsOptions: {
            extractComments: false,
            test: /\.[cm]?jsx?(\?.*)?$/,
            minimizerOptions: {
              compress: {
                defaults: true,
                dead_code: true,
                passes: 2,
                toplevel: true,
                unused: true,
              },
              format: {
                comments: false,
                preserve_annotations: true,
              },
              mangle: true,
              minify: true,
            },
          },
        },
      },
      tools: {
        rspack: {
          resolve: {
            // These optional ws peer deps are not used in Node Actions runners.
            alias: {
              bufferutil: false,
              'utf-8-validate': false,
            },
          },
          optimization: {
            splitChunks: {
              chunks: 'async',
              cacheGroups: {
                aiVendor: {
                  // Split the AI SDK into its own chunk to keep the main bundle small.
                  test: /[\\/]node_modules[\\/](?:\.pnpm[\\/])?(?:@ai-sdk[+\\/]|ai@|ai[\\/])/,
                  name: 'ai-vendor',
                  chunks: 'async',
                  enforce: true,
                  priority: 20,
                },
              },
            },
          },
        },
      },
    },
  ],
});

define.test({
  extends: {},
  testEnvironment: 'node',
  include: ['tests/**/*.test.ts'],
  setupFiles: ['./tests/setup.ts'],
  coverage: {
    include: ['src/**/*.ts'],
    exclude: ['src/**/*.d.ts', 'tests/**'],
    thresholds: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
});

define.lint(({ js, ts }) => [
  { ignores: ['dist/**'] },
  js.configs.recommended,
  ts.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'prefer-const': 'off',
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
    },
  },
]);

define.fmt({
  singleQuote: true,
  sortPackageJson: true,
  ignorePatterns: ['dist/**', '.github/**'],
});
