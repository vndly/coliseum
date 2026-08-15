import js from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import {vueTsConfigs, withVueTs} from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

// withVueTs wires up vue-eslint-parser and resolves .vue types for the
// type-aware rules, which read the projects referenced by tsconfig.json
export default withVueTs(
  js.configs.recommended,
  vueTsConfigs.recommendedTypeChecked,
  pluginVue.configs['flat/recommended'],
  {
    // This config file is the only JS source and belongs to no tsconfig project
    files: ['**/*.js'],
    extends: [vueTsConfigs.disableTypeChecked],
  },
  {
    plugins: {
      '@stylistic': stylistic,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        __APP_VERSION__: 'readonly',
      },
    },
    rules: {
      // Formatting rules
      '@stylistic/semi': [
        'error',
        'never',
      ],
      '@stylistic/quotes': [
        'error',
        'single',
        {
          avoidEscape: true,
        },
      ],
      '@stylistic/indent': [
        'error',
        2,
      ],
      '@stylistic/comma-dangle': [
        'error',
        'always-multiline',
      ],
      '@stylistic/no-trailing-spaces': 'error',
      '@stylistic/no-multiple-empty-lines': [
        'error',
        {
          max: 1,
        },
      ],
      '@stylistic/eol-last': [
        'error',
        'always',
      ],
      '@stylistic/space-before-function-paren': [
        'error',
        {
          anonymous: 'always',
          named: 'never',
          asyncArrow: 'always',
        },
      ],
      '@stylistic/space-infix-ops': 'error',
      '@stylistic/keyword-spacing': 'error',
      '@stylistic/space-before-blocks': 'error',
      '@stylistic/brace-style': [
        'error',
        '1tbs',
      ],
      '@stylistic/object-curly-spacing': [
        'error',
        'never',
      ],
      '@stylistic/array-bracket-spacing': [
        'error',
        'never',
      ],
      '@stylistic/array-bracket-newline': [
        'error',
        {
          multiline: true,
          minItems: 2,
        },
      ],
      '@stylistic/array-element-newline': [
        'error',
        {
          multiline: true,
          minItems: 2,
        },
      ],
      '@stylistic/arrow-spacing': 'error',
      '@stylistic/key-spacing': 'error',
      '@stylistic/no-multi-spaces': 'error',
      '@stylistic/object-curly-newline': [
        'error',
        {
          ImportDeclaration: 'never',
          ExportDeclaration: {
            minProperties: 1,
          },
          ObjectExpression: {
            minProperties: 1,
          },
          ObjectPattern: {
            minProperties: 1,
          },
        },
      ],
      '@stylistic/object-property-newline': 'error',

      // Require curly braces for all control flow statements
      'curly': [
        'error',
        'all',
      ],

      // Disallow shorthand property names
      'object-shorthand': [
        'error',
        'never',
      ],

      // Remove the old semi rule (replaced by @stylistic/semi)
      semi: 'off',

      // Unused parameters are named _, __, ___ (see docs/typescript.md)
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Pairs with verbatimModuleSyntax in tsconfig.app.json
      '@typescript-eslint/consistent-type-imports': 'error',

      // Disable formatting-only Vue rules
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/multi-word-component-names': 'off',
    },
  },
)
