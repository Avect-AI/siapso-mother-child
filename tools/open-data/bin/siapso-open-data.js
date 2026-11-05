#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Runs the TypeScript command line through tsx (the sources import the engine).
import { register } from 'tsx/esm/api';

register();
const { main } = await import('../src/cli.ts');
process.exitCode = await main(process.argv.slice(2));
