import fs from 'fs';
import path from 'path';

export function resolveReferenceAudioPath(input: {
  filenameOrPath: string;
  configuredDir?: string;
}): { fullPath: string; searchedDirs: string[] } {
  const { filenameOrPath, configuredDir } = input;

  if (path.isAbsolute(filenameOrPath)) {
    if (fs.existsSync(filenameOrPath)) {
      return { fullPath: filenameOrPath, searchedDirs: [] };
    }
    throw new Error(`Reference audio path does not exist: ${filenameOrPath}`);
  }

  const dirs = [
    configuredDir?.trim() || '',
    process.env.OMNIVOICE_REFERENCE_AUDIO_DIR?.trim() || '',
    path.join(process.cwd(), 'omnivoice-local', 'references'),
  ].filter((d, idx, arr) => d.length > 0 && arr.indexOf(d) === idx);

  for (const dir of dirs) {
    const full = path.resolve(dir, filenameOrPath);
    if (fs.existsSync(full)) {
      return { fullPath: full, searchedDirs: dirs };
    }
  }

  throw new Error(
    `Reference audio not found for '${filenameOrPath}'. Checked: ${dirs.join(', ') || '(no directories configured)'}`,
  );
}

