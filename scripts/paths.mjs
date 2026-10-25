import path from 'node:path';
import { mkdirSync } from 'node:fs';

const configured = process.env.UIPATH_EXTENSION_DIR;
if (!configured && !process.env.LOCALAPPDATA) {
  throw new Error('Set UIPATH_EXTENSION_DIR to your installed UiPath 23.10.1 extension directory.');
}
export const EXTENSION_ROOT = configured || path.join(process.env.LOCALAPPDATA,
  'Google', 'Chrome', 'User Data', 'Default', 'Extensions',
  'jfcmnbofjlffnejneillkgbniiidiigd', '23.10.1_0');
mkdirSync('work', { recursive: true });
