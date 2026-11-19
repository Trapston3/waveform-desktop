import fs from 'node:fs';
import path from 'node:path';

export const APP_USER_MODEL_ID = 'com.waveform.desktop';

export function resolveAppIconPath(
  baseDir: string,
  appPath?: string,
  resourcesPath?: string,
  platform: string = process.platform
): string | undefined {
  const candidateDirs: string[] = [
    path.resolve(baseDir, '..'),
    appPath,
    resourcesPath,
    process.cwd()
  ].filter((d): d is string => typeof d === 'string' && d.trim().length > 0);

  const relativePaths =
    platform === 'win32'
      ? [
          path.join('build', 'icon.ico'),
          path.join('build', 'icon.png'),
          path.join('src', 'assets', 'icons', 'Logo.png'),
          path.join('dist', 'assets', 'icons', 'Logo.png')
        ]
      : [
          path.join('build', 'icon.png'),
          path.join('src', 'assets', 'icons', 'Logo.png'),
          path.join('build', 'icon.ico')
        ];

  for (const dir of candidateDirs) {
    for (const rel of relativePaths) {
      const candidate = path.resolve(dir, rel);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

export function resolveTrayIconPath(
  baseDir: string,
  appPath?: string,
  resourcesPath?: string
): string | undefined {
  const candidateDirs: string[] = [
    path.resolve(baseDir, '..'),
    appPath,
    resourcesPath,
    process.cwd()
  ].filter((d): d is string => typeof d === 'string' && d.trim().length > 0);

  const relativePaths = [
    path.join('build', 'icon.png'),
    path.join('src', 'assets', 'icons', 'Logo.png'),
    path.join('build', 'icon.ico')
  ];

  for (const dir of candidateDirs) {
    for (const rel of relativePaths) {
      const candidate = path.resolve(dir, rel);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

export function createTrayIcon(
  nativeImage: any,
  baseDir: string,
  appPath?: string,
  resourcesPath?: string
): any | null {
  const iconPath = resolveTrayIconPath(baseDir, appPath, resourcesPath);
  if (!iconPath) {
    return null;
  }

  try {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon || (typeof icon.isEmpty === 'function' && icon.isEmpty())) {
      return null;
    }

    if (typeof icon.resize === 'function') {
      return icon.resize({ width: 16, height: 16 });
    }

    return icon;
  } catch {
    return null;
  }
}
