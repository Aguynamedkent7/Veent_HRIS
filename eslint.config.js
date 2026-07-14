import js from '@eslint/js'
import ts from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import svelte from 'eslint-plugin-svelte'
import svelteParser from 'svelte-eslint-parser'
import prettier from 'eslint-config-prettier'

/** @type {import('eslint').Linter.Config[]} */
export default [
	js.configs.recommended,
	{
		files: ['**/*.ts'],
		languageOptions: { parser: tsParser },
		plugins: { '@typescript-eslint': ts },
		rules: { ...ts.configs.recommended.rules }
	},
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parser: svelteParser,
			parserOptions: { parser: tsParser }
		},
		plugins: { svelte },
		rules: { ...svelte.configs.recommended.rules }
	},
	prettier,
	{
		ignores: ['build/', '.svelte-kit/', 'node_modules/', 'dist/']
	}
]
