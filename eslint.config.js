import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'dev/**', 'release/**', 'node_modules/**', 'logs.txt', 'ref/**'],
  },
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.node,
      },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['~*'],
        },
      ],
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['**/*.{spec,test}.{ts,tsx,js,jsx}', 'e2e/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.vitest,
        ...globals.node,
      },
    },
  }
);
