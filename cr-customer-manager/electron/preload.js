import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  version: process.versions.electron
});
