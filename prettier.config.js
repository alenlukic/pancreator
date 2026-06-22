/** @type {import('prettier').Config} */
const config = {
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,

  semi: false,
  singleQuote: true,
  quoteProps: 'as-needed',
  jsxSingleQuote: false,

  trailingComma: 'all',
  bracketSpacing: false,
  bracketSameLine: false,
  arrowParens: 'always',

  endOfLine: 'lf',
  proseWrap: 'preserve',
}

export default config
