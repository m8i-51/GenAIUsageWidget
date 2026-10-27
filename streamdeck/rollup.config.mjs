import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import commonjs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';

const require = createRequire(import.meta.url);
const sdPlugin = 'com.github.m8i-51.genaiusage.sdPlugin';
const bin = path.join(sdPlugin, 'bin');

// sql.js locates its .wasm next to itself, and Antigravity shells out to a
// Python helper next to its module, so both ship as files beside the bundle.
function copyRuntimeFiles() {
  return {
    name: 'copy-runtime-files',
    writeBundle() {
      const sqlDir = path.dirname(path.dirname(require.resolve('sql.js/dist/sql-wasm.js', { paths: ['..'] })));
      const sqlOut = path.join(bin, 'node_modules', 'sql.js');
      fs.mkdirSync(path.join(sqlOut, 'dist'), { recursive: true });
      fs.copyFileSync(path.join(sqlDir, 'package.json'), path.join(sqlOut, 'package.json'));
      for (const file of ['sql-wasm.js', 'sql-wasm.wasm']) {
        fs.copyFileSync(path.join(sqlDir, 'dist', file), path.join(sqlOut, 'dist', file));
      }
      fs.copyFileSync(path.join('..', 'src', 'providers', 'win-cred-read.py'), path.join(bin, 'win-cred-read.py'));
      fs.writeFileSync(path.join(bin, 'package.json'), '{ "type": "module" }\n');
    },
  };
}

export default {
  input: 'src/plugin.js',
  output: {
    file: path.join(bin, 'plugin.js'),
    format: 'es',
    // The shared provider modules are CommonJS and use __dirname.
    banner: [
      "import { fileURLToPath as __fileURLToPath } from 'node:url';",
      "import { dirname as __pathDirname } from 'node:path';",
      'const __filename = __fileURLToPath(import.meta.url);',
      'const __dirname = __pathDirname(__filename);',
    ].join('\n'),
  },
  external: ['sql.js'],
  plugins: [
    nodeResolve({ preferBuiltins: true, exportConditions: ['node'] }),
    // usage-cache only touches Electron when no data dir is set; the plugin always sets one.
    commonjs({ ignore: ['electron'] }),
    copyRuntimeFiles(),
  ],
};
