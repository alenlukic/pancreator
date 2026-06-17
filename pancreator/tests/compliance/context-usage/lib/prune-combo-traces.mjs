import fs from "node:fs";
import path from "node:path";

/**
 * Remove all trace artifacts for one combo before a fresh calibration session.
 * @param {string} comboDir
 */
export function clearComboTraces(comboDir) {
  if (!fs.existsSync(comboDir)) {
    return;
  }
  for (const name of fs.readdirSync(comboDir)) {
    fs.unlinkSync(path.join(comboDir, name));
  }
}
