import { mkdirSync, writeFileSync } from 'node:fs';
import openapiTS, { astToString } from 'openapi-typescript';
import ts from 'typescript';

// PDF upload fields become Blob, so the typed client accepts files.
const ast = await openapiTS(new URL('../openapi.yaml', import.meta.url), {
  transform: (schema) =>
    'contentMediaType' in schema && schema.contentMediaType === 'application/pdf'
      ? ts.factory.createTypeReferenceNode('Blob')
      : undefined,
});

const out = new URL('../src/generated/', import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(
  new URL('openapi.ts', out),
  '// Generated from openapi.yaml by scripts/codegen-openapi.ts. Do not edit.\n' + astToString(ast),
);
