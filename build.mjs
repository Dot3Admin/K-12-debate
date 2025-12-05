import * as esbuild from 'esbuild';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read tsconfig to get path mappings
const tsconfig = JSON.parse(readFileSync('./tsconfig.json', 'utf-8'));
const paths = tsconfig.compilerOptions?.paths || {};

// Create a plugin to resolve TypeScript path aliases
const tsconfigPathsPlugin = {
  name: 'tsconfig-paths',
  setup(build) {
    // Handle @shared/* imports
    build.onResolve({ filter: /^@shared\// }, args => {
      const importPath = args.path.replace(/^@shared\//, '');
      return {
        path: resolve(__dirname, 'shared', importPath + '.ts'),
      };
    });
    
    // Handle @/* imports (client-side, shouldn't be in server but just in case)
    build.onResolve({ filter: /^@\// }, args => {
      const importPath = args.path.replace(/^@\//, '');
      return {
        path: resolve(__dirname, 'client/src', importPath + '.ts'),
      };
    });
  },
};

// Build the server bundle with automatic externals  
await esbuild.build({
  entryPoints: ['server/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/index.js',
  packages: 'external',
  plugins: [tsconfigPathsPlugin],
  logLevel: 'info',
  keepNames: true,
  sourcemap: false,
});

console.log('✅ Server build complete');
