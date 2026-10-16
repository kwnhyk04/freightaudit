import { mkdirSync, writeFileSync } from 'node:fs';
import openapiTS, { astToString } from 'openapi-typescript';
import ts from 'typescript';

// File fields (uploads and the stored PDF) become Blob, so the typed client sends and receives files.
const ast = await openapiTS(new URL('../openapi.yaml', import.meta.url), {
  transform: (schema) =>
    'contentMediaType' in schema && typeof schema.contentMediaType === 'string'
      ? ts.factory.createTypeReferenceNode('Blob')
      : undefined,
});

const out = new URL('../src/generated/', import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(
  new URL('openapi.ts', out),
  '// Generated from openapi.yaml by scripts/codegen-openapi.ts. Do not edit.\n' + astToString(ast),
);
