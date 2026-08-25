import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inputPath = path.join(packageRoot, 'master', 'builderhelm-master-dark.png');
const backgroundDark = { r: 12, g: 18, b: 24 };
const backgroundLight = { r: 247, g: 248, b: 252 };
const monoDark = { r: 17, g: 24, b: 32 };
const monoLight = { r: 247, g: 248, b: 252 };

function ensureDir(relativePath) {
  fs.mkdirSync(path.join(packageRoot, relativePath), { recursive: true });
}

function smoothstep(low, high, value) {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

function rgbaImage(buffer, width, height) {
  return sharp(buffer, { raw: { width, height, channels: 4 } });
}

async function writePng(image, relativePath) {
  const outputPath = path.join(packageRoot, relativePath);
  ensureDir(path.dirname(relativePath));
  await image.png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(outputPath);
}

async function resizePng(input, size, relativePath, options = {}) {
  const image = sharp(input).resize(size, size, {
    fit: options.fit ?? 'fill',
    kernel: sharp.kernel.lanczos3,
    ...(options.background === undefined ? {} : { background: options.background }),
  });
  await writePng(image, relativePath);
}

async function canvasAsset(input, width, height, markHeight, relativePath) {
  const mark = await sharp(input)
    .resize({ height: markHeight, fit: 'inside', kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
  const metadata = await sharp(mark).metadata();
  const left = Math.round((width - metadata.width) / 2);
  const top = Math.round((height - metadata.height) / 2);
  await writePng(
    sharp({
      create: {
        width,
        height,
        channels: 3,
        background: backgroundDark,
      },
    }).composite([{ input: mark, left, top }]),
    relativePath,
  );
}

function makeSolidVariant(alphaBuffer, width, height, color) {
  const output = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const outputOffset = pixel * 4;
    output[outputOffset] = color.r;
    output[outputOffset + 1] = color.g;
    output[outputOffset + 2] = color.b;
    output[outputOffset + 3] = alphaBuffer[pixel];
  }
  return output;
}

function createExtractedVariants(source, width, height) {
  const color = Buffer.alloc(width * height * 4);
  const lightBackground = Buffer.alloc(width * height * 4);
  const alpha = Buffer.alloc(width * height);

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const sourceOffset = pixel * 3;
    const outputOffset = pixel * 4;
    const r = source[sourceOffset];
    const g = source[sourceOffset + 1];
    const b = source[sourceOffset + 2];
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const violetDistance = b - Math.max(r, g);
    const whiteAlpha = smoothstep(36, 155, luminance);
    const violetAlpha = smoothstep(24, 110, violetDistance) * smoothstep(45, 120, b);
    const alphaFloat = Math.max(whiteAlpha, violetAlpha);
    const alphaByte = Math.round(alphaFloat * 255);
    alpha[pixel] = alphaByte;

    if (alphaByte === 0) {
      color.fill(0, outputOffset, outputOffset + 4);
      lightBackground[outputOffset] = backgroundLight.r;
      lightBackground[outputOffset + 1] = backgroundLight.g;
      lightBackground[outputOffset + 2] = backgroundLight.b;
      lightBackground[outputOffset + 3] = 255;
      continue;
    }

    const isViolet = violetAlpha > whiteAlpha;
    const safeAlpha = Math.max(alphaFloat, 0.08);
    const foreground = isViolet
      ? [
          Math.max(64, Math.min(108, Math.round(r / safeAlpha))),
          Math.max(52, Math.min(98, Math.round(g / safeAlpha))),
          Math.max(
            220,
            Math.min(
              255,
              Math.round((b - backgroundDark.b * (1 - safeAlpha)) / safeAlpha),
            ),
          ),
        ]
      : [
          Math.max(
            225,
            Math.min(
              255,
              Math.round((r - backgroundDark.r * (1 - safeAlpha)) / safeAlpha),
            ),
          ),
          Math.max(
            227,
            Math.min(
              255,
              Math.round((g - backgroundDark.g * (1 - safeAlpha)) / safeAlpha),
            ),
          ),
          Math.max(
            235,
            Math.min(
              255,
              Math.round((b - backgroundDark.b * (1 - safeAlpha)) / safeAlpha),
            ),
          ),
        ];

    color[outputOffset] = foreground[0];
    color[outputOffset + 1] = foreground[1];
    color[outputOffset + 2] = foreground[2];
    color[outputOffset + 3] = alphaByte;

    const lightForeground = isViolet ? foreground : [monoDark.r, monoDark.g, monoDark.b];
    const blend = alphaFloat;
    lightBackground[outputOffset] = Math.round(
      lightForeground[0] * blend + backgroundLight.r * (1 - blend),
    );
    lightBackground[outputOffset + 1] = Math.round(
      lightForeground[1] * blend + backgroundLight.g * (1 - blend),
    );
    lightBackground[outputOffset + 2] = Math.round(
      lightForeground[2] * blend + backgroundLight.b * (1 - blend),
    );
    lightBackground[outputOffset + 3] = 255;
  }

  return { color, lightBackground, alpha };
}

async function buildManifest() {
  const ignored = new Set(['manifest.json', 'CHECKSUMS.sha256']);
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (!ignored.has(entry.name)) {
        files.push(absolute);
      }
    }
  };
  walk(packageRoot);

  const assets = [];
  for (const absolute of files.sort()) {
    const relative = path.relative(packageRoot, absolute);
    const bytes = fs.readFileSync(absolute);
    const entry = {
      path: relative,
      bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
    if (/\.(png|webp|avif)$/i.test(relative)) {
      const metadata = await sharp(bytes).metadata();
      entry.width = metadata.width;
      entry.height = metadata.height;
      entry.format = metadata.format;
      entry.hasAlpha = metadata.hasAlpha;
    }
    assets.push(entry);
  }

  fs.writeFileSync(
    path.join(packageRoot, 'manifest.json'),
    `${JSON.stringify(
      {
        name: 'BuilderHelm symbol asset pack',
        version: 1,
        generatedAt: new Date().toISOString(),
        source: 'builderhelm-selected-original.png',
        assets,
      },
      null,
      2,
    )}\n`,
  );
}

async function main() {
  if (!fs.existsSync(inputPath)) throw new Error(`Missing master: ${inputPath}`);

  const { data, info } = await sharp(inputPath)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { color, lightBackground, alpha } = createExtractedVariants(
    data,
    info.width,
    info.height,
  );
  const colorSource = await rgbaImage(color, info.width, info.height).png().toBuffer();
  const lightSource = await rgbaImage(lightBackground, info.width, info.height)
    .png()
    .toBuffer();
  const whiteSource = await rgbaImage(
    makeSolidVariant(alpha, info.width, info.height, monoLight),
    info.width,
    info.height,
  )
    .png()
    .toBuffer();
  const blackSource = await rgbaImage(
    makeSolidVariant(alpha, info.width, info.height, monoDark),
    info.width,
    info.height,
  )
    .png()
    .toBuffer();

  await resizePng(inputPath, 4096, 'master/builderhelm-master-dark-4096.png');
  await resizePng(colorSource, 4096, 'master/builderhelm-master-transparent-4096.png');
  await resizePng(lightSource, 4096, 'master/builderhelm-master-light-4096.png');
  await resizePng(whiteSource, 4096, 'monochrome/builderhelm-mono-white-4096.png');
  await resizePng(blackSource, 4096, 'monochrome/builderhelm-mono-black-4096.png');

  for (const size of [16, 32, 48]) {
    await resizePng(inputPath, size, `favicon/favicon-${size}x${size}.png`);
  }
  await resizePng(inputPath, 180, 'web/apple-touch-icon-180.png');
  await resizePng(inputPath, 150, 'web/mstile-150.png');
  await resizePng(inputPath, 192, 'pwa/icon-192.png');
  await resizePng(inputPath, 512, 'pwa/icon-512.png');
  await resizePng(inputPath, 512, 'pwa/maskable-icon-512.png');

  for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
    await resizePng(inputPath, size, `app/macos/png/builderhelm-${size}.png`);
  }
  const macAliases = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png'],
  ];
  for (const [size, fileName] of macAliases) {
    await resizePng(inputPath, size, `app/macos/BuilderHelm.iconset/${fileName}`);
  }

  for (const size of [16, 24, 32, 48, 64, 128, 256]) {
    await resizePng(inputPath, size, `app/windows/builderhelm-${size}.png`);
    await resizePng(
      inputPath,
      size,
      `app/linux/hicolor/${size}x${size}/apps/builderhelm.png`,
    );
  }
  await resizePng(inputPath, 512, 'app/linux/hicolor/512x512/apps/builderhelm.png');

  const iosSizes = [40, 58, 60, 76, 80, 87, 120, 152, 167, 180, 1024];
  for (const size of iosSizes) {
    await resizePng(inputPath, size, `app/ios/builderhelm-${size}.png`);
  }

  const androidSizes = [
    ['mdpi', 48],
    ['hdpi', 72],
    ['xhdpi', 96],
    ['xxhdpi', 144],
    ['xxxhdpi', 192],
  ];
  for (const [density, size] of androidSizes) {
    await resizePng(inputPath, size, `app/android/mipmap-${density}/ic_launcher.png`);
  }
  await resizePng(inputPath, 512, 'app/android/play-store-512.png');
  await resizePng(colorSource, 432, 'app/android/adaptive-foreground-432.png', {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
  await writePng(
    sharp({
      create: { width: 432, height: 432, channels: 3, background: backgroundDark },
    }),
    'app/android/adaptive-background-432.png',
  );

  await resizePng(inputPath, 400, 'social/profile-400.png');
  await resizePng(inputPath, 800, 'social/profile-800.png');
  await canvasAsset(colorSource, 1200, 630, 500, 'social/open-graph-1200x630.png');
  await canvasAsset(colorSource, 1200, 600, 470, 'social/twitter-card-1200x600.png');

  await resizePng(colorSource, 512, 'web/logo-transparent-512.png');
  await resizePng(whiteSource, 512, 'web/logo-mono-white-512.png');
  await resizePng(blackSource, 512, 'web/logo-mono-black-512.png');
  await resizePng(lightSource, 512, 'web/logo-light-background-512.png');

  const transparentPreview = await sharp(colorSource)
    .resize(512, 512, { kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
  await writePng(
    sharp({
      create: { width: 512, height: 512, channels: 3, background: '#d9dde5' },
    }).composite([
      {
        input: Buffer.from(
          `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="c" width="32" height="32" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#f5f5f5"/><rect x="16" y="16" width="16" height="16" fill="#f5f5f5"/><rect x="16" width="16" height="16" fill="#d9dde5"/><rect y="16" width="16" height="16" fill="#d9dde5"/></pattern></defs><rect width="512" height="512" fill="url(#c)"/></svg>`,
        ),
        left: 0,
        top: 0,
      },
      { input: transparentPreview, left: 0, top: 0 },
    ]),
    'previews/transparent-on-checkerboard.png',
  );

  await buildManifest();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
