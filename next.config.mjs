import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.dirname(fileURLToPath(import.meta.url));

/*
 * Code protection for the production build.
 *
 * Anything a browser runs can be downloaded, so this cannot make the code
 * secret. It makes it very hard to read or reuse:
 *  - no source maps are published (productionBrowserSourceMaps: false)
 *  - console.* calls are stripped
 *  - our own client code (engine/ and components/) is run through
 *    javascript-obfuscator: renamed identifiers, encoded string table
 *  - Next's minifier then compresses the whole bundle
 *
 * Settings that slow the 60fps render loop (control-flow flattening, dead code
 * injection) or break minified output (self-defending) are left off.
 */
const OBFUSCATOR_OPTIONS = {
  compact: true,
  simplify: true,
  target: 'browser',
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 1,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayIndexShift: true,
  stringArrayWrappersCount: 1,
  stringArrayWrappersType: 'variable',
  splitStrings: false,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  numbersToExpressions: false,
  transformObjectKeys: true,
  selfDefending: false,
  debugProtection: false,
  disableConsoleOutput: false,
  sourceMap: false,
};

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  compiler: { removeConsole: true },
  // `next dev` uses Turbopack (no obfuscation needed in development)
  turbopack: {},
  // `next build --webpack` (see package.json) applies the obfuscator to client code
  webpack(config, { dev, isServer }) {
    if (!dev && !isServer) {
      config.module.rules.push({
        test: /\.(ts|tsx|js|jsx)$/,
        include: [path.join(root, 'engine'), path.join(root, 'components')],
        enforce: 'post',
        use: { loader: require.resolve('webpack-obfuscator/dist/loader'), options: OBFUSCATOR_OPTIONS },
      });
    }
    return config;
  },
};

export default nextConfig;
