import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join, basename, normalize } from 'node:path';

export function verifyFileExplorerFolder({ target, postObservation, expectedFolderName, expectedParentPath, baseline }) {
  const fail = reason => ({ verified: false, reason, evidence: null });
  if (!isSafeFolderName(expectedFolderName) || !expectedParentPath || !isAbsolute(expectedParentPath)) {
    return fail('An exact parent path and safe folder name are required');
  }
  const observed = postObservation?.target || postObservation?.window;
  const time = postObservation?.timestamp;
  if (!target || !observed || observed.hwnd !== target.hwnd || observed.processId !== target.processId || observed.generation !== target.generation) {
    return fail('Independent Explorer target identity is missing or changed');
  }
  if (!Number.isFinite(time) || Date.now() - time > 5000 || time > Date.now() + 100) {
    return fail('Fresh Explorer observation is required');
  }
  if (baseline?.existed !== false || !Number.isFinite(baseline.observedAt) || time < baseline.observedAt) {
    return fail('An absent-folder baseline is required to prove creation');
  }
  try {
    const parent = realpathSync(expectedParentPath);
    if (pathKey(realpathSync(postObservation.location)) !== pathKey(parent)) return fail('Explorer is outside the approved parent directory');
    const folderPath = join(parent, expectedFolderName);
    const stat = lstatSync(folderPath);
    if (!stat.isDirectory() || stat.isSymbolicLink() || pathKey(realpathSync(folderPath)) !== pathKey(folderPath)) {
      return fail('Expected directory is missing or redirected');
    }
    return {
      verified: true,
      reason: 'Independent filesystem readback and Explorer location confirm folder creation',
      evidence: { type: 'file_explorer_folder_readback', folderPath, observedAt: time, baselineAt: baseline.observedAt, identity: observed }
    };
  } catch { return fail('Expected directory could not be independently read'); }
}

export function isSafeFolderName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 120 &&
    name === name.trim() && basename(name) === name && !/[<>:"/\\|?*\x00-\x1f]/.test(name) &&
    !/[. ]$/.test(name) && name !== '.' && name !== '..' && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
}

function pathKey(path) { return normalize(path).replace(/[\\/]+$/, '').toLowerCase(); }
