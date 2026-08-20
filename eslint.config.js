// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * The framework hedge (see plan, "How much this hedges against changing framework later").
 * `core`, `views` and `gcal` must stay framework-free so that swapping Solid out is a
 * rewrite of form components rather than an untangling of reactivity. This rule IS the
 * hedge -- if it gets disabled, the hedge is gone.
 */
const frameworkFree = {
  files: ['packages/core/**/*.ts', 'packages/views/**/*.ts', 'packages/gcal/**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        {
          group: ['solid-js', 'solid-js/*', '@solidjs/*'],
          message:
            'Framework-free package. Geometry returns plain data (path strings, numbers) -- ' +
            'never JSX or elements. Solid belongs in packages/ui and apps/web only.',
        },
      ],
    }],
  },
}

export default tseslint.config(
  { ignores: ['**/dist/**', '**/dev-dist/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Underscore prefix is the conventional "deliberately discarded" marker, and is
      // how object rest is used to drop a field.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  frameworkFree,
)
