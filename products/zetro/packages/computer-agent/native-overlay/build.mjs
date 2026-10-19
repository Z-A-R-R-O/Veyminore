import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') throw new Error('The desktop overlay requires Windows');
const cwd = dirname(fileURLToPath(import.meta.url));
const compiler = join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
execFileSync(compiler, [
  '/nologo', '/target:exe', '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll',
  '/r:System.Web.Extensions.dll', '/out:ZetroAccessOverlay.exe', 'ZetroAccessOverlay.cs', 'LayeredSurface.cs', 'OverlayRenderer.cs', 'CursorLease.cs', 'OrbRenderer.cs'
], { cwd, stdio: 'inherit', windowsHide: true, shell: false });
