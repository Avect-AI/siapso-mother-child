// SPDX-License-Identifier: MIT
import Ajv2020 from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type { Problem, SchemaName } from './types.js';

type Validators = Record<SchemaName, ValidateFunction>;

const cache = new WeakMap<object, Validators>();

/** Compiles the schemas once per schema set. */
function validatorsFor(schemas: Record<SchemaName, object>): Validators {
  const cached = cache.get(schemas);
  if (cached) return cached;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const entries = (Object.keys(schemas) as SchemaName[]).map(
    (name) => [name, ajv.compile(schemas[name])] as const,
  );
  const validators = Object.fromEntries(entries) as Validators;
  cache.set(schemas, validators);
  return validators;
}

/** `/when/pregnancy-windows/1` becomes `when.pregnancy-windows[1]`. */
function pathOf(pointer: string): string {
  let result = '';
  for (const raw of pointer.split('/').slice(1)) {
    const segment = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    result += /^\d+$/.test(segment) ? `[${segment}]` : `${result === '' ? '' : '.'}${segment}`;
  }
  return result;
}

function joinPath(prefix: string, rest: string): string {
  if (prefix === '') return rest;
  if (rest === '') return prefix;
  return rest.startsWith('[') ? `${prefix}${rest}` : `${prefix}.${rest}`;
}

const KEBAB_CASE = '^[a-z0-9]+(-[a-z0-9]+)*$';

function describeError(error: ErrorObject): { path: string; message: string } {
  const at = pathOf(error.instancePath);
  const params = error.params as Record<string, unknown>;
  switch (error.keyword) {
    case 'additionalProperties': {
      const key = String(params.additionalProperty);
      return { path: joinPath(at, key), message: `unknown key "${key}"` };
    }
    case 'required': {
      const key = String(params.missingProperty);
      return { path: joinPath(at, key), message: `missing required key "${key}"` };
    }
    case 'enum': {
      const allowed = (params.allowedValues as unknown[]).map(String).join(', ');
      // YAML reads an unquoted 0 as a number, not as the evidence level '0'.
      const hint =
        allowed.includes('A') && allowed.includes('0') ? " (write evidence 0 quoted: '0')" : '';
      return { path: at, message: `must be one of the allowed values: ${allowed}${hint}` };
    }
    case 'pattern':
      if (params.pattern === KEBAB_CASE) {
        return { path: at, message: 'must be kebab-case (lowercase letters, digits and hyphens)' };
      }
      if (params.pattern === '\\S') return { path: at, message: 'must not be blank' };
      return { path: at, message: error.message ?? 'does not match the pattern' };
    default:
      return { path: at, message: error.message ?? 'is not valid' };
  }
}

/**
 * Checks `data` against a schema. `file` and `at` (the position of the entry
 * in a list file, or empty) locate the problems.
 */
export function schemaProblems(
  schemas: Record<SchemaName, object>,
  name: SchemaName,
  data: unknown,
  file: string,
  at = '',
): Problem[] {
  const validate = validatorsFor(schemas)[name];
  if (validate(data)) return [];
  return (validate.errors ?? []).map((error) => {
    const { path, message } = describeError(error);
    return { file, path: joinPath(at, path), message };
  });
}
