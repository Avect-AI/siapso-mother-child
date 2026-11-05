// SPDX-License-Identifier: MIT
// A Markdown file read as text by Vite (`import text from './doc.md?raw'`).
// Declared here, and referenced by the module that uses it, so that projects
// outside app/ that compile app modules (the server's parity test) type-check.
declare module '*.md?raw' {
  const text: string;
  export default text;
}
