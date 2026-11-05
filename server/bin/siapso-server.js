#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Runs the TypeScript entry point through tsx: Node's own type stripping
// cannot load the engine, whose sources import each other with .js specifiers.
import { register } from 'tsx/esm/api';

register();
const { main } = await import('../src/main.ts');
process.exitCode = await main(process.argv.slice(2));
