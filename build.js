import esbuild from 'esbuild';
import { readdirSync, copyFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Function to copy directory recursively
function copyDir(src, dest) {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  const entries = readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

// Build configuration
const buildOptions = {
  entryPoints: ['app.js'],
  bundle: true,
  minify: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outfile: 'dist/app.js',
  external: [
    // Keep these as external dependencies (not bundled)
    'mysql2',
    'mysql2/promise',
    'bcrypt',
    'jsonwebtoken',
    'razorpay',
    'multer',
    'express',
    'cors',
    'cookie-parser',
    'dotenv',
    'sanitize-html'
  ],
  banner: {
    js: '#!/usr/bin/env node'
  },
  logLevel: 'info',
};

async function build() {
  console.log('🚀 Starting build process...\n');

  // Clean dist directory
  if (existsSync('dist')) {
    rmSync('dist', { recursive: true, force: true });
  }
  mkdirSync('dist', { recursive: true });

  // Build with esbuild
  try {
    await esbuild.build(buildOptions);
    console.log('✅ Code bundled and minified successfully!\n');
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }

  // Copy necessary directories and files
  console.log('📁 Copying static files...');

  // Copy uploads directory if it exists
  if (existsSync('uploads')) {
    copyDir('uploads', 'dist/uploads');
    console.log('  ✓ Copied uploads directory');
  }

  // Copy config files if needed (excluding node_modules)
  const filesToCopy = [];
  if (existsSync('config.js')) {
    filesToCopy.push('config.js');
  }

  filesToCopy.forEach(file => {
    const destPath = join('dist', file);
    const destDir = dirname(destPath);
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }
    copyFileSync(file, destPath);
    console.log(`  ✓ Copied ${file}`);
  });

  console.log('\n✨ Build completed successfully!');
  console.log('📦 Output: dist/app.js');
  console.log('🚀 Run with: npm run start:prod\n');
}

build().catch(error => {
  console.error('❌ Build script error:', error);
  process.exit(1);
});

