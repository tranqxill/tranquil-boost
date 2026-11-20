'use strict';
// Small JSON file store. Holds the original values for every tweak we
// applied, so Undo still works after the app or the PC restarts.
const fs = require('fs');
const path = require('path');

class Store {
  constructor(file) {
    this.file = file;
    this.data = { version: 1, backups: {}, startup: {}, settings: { restorePointBeforeApply: true } };
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw && typeof raw === 'object') {
        this.data = { ...this.data, ...raw, settings: { ...this.data.settings, ...(raw.settings || {}) } };
      }
    } catch {
      // first run or unreadable file: start fresh
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  getBackup(id) { return this.data.backups[id] || null; }
  setBackup(id, backup) { this.data.backups[id] = backup; this.save(); }
  clearBackup(id) { delete this.data.backups[id]; this.save(); }
  backupIds() { return Object.keys(this.data.backups); }

  get settings() { return this.data.settings; }
  setSetting(key, value) { this.data.settings[key] = value; this.save(); }
}

module.exports = { Store };
