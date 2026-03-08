import { app, BrowserWindow, shell, Tray, Menu, nativeImage } from 'electron';
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let tray;
let serverProcess;
const store = {
  isQuiting: false
};

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on('ready', async () => {
    const serverPath = path.resolve(__dirname, '..', 'server.js');
    serverProcess = fork(serverPath);

    await new Promise((resolve) => {
      setTimeout(resolve, 2000);
    });

    mainWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 1024,
      minHeight: 700,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });

    mainWindow.loadURL('http://localhost:3005');

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    mainWindow.on('close', (event) => {
      if (!store.isQuiting) {
        event.preventDefault();
        mainWindow.hide();
      }
    });

    const trayIconPath = path.resolve(__dirname, '..', 'public', 'icons', 'icon-512.png');
    const trayIcon = nativeImage.createFromPath(trayIconPath);
    tray = new Tray(trayIcon);

    const trayMenu = Menu.buildFromTemplate([
      {
        label: 'Open C&R CRM',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          store.isQuiting = true;
          app.quit();
        }
      }
    ]);

    tray.setToolTip('C&R CRM');
    tray.setContextMenu(trayMenu);
    tray.on('double-click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  });

  app.on('before-quit', () => {
    store.isQuiting = true;
  });

  app.on('window-all-closed', (event) => {
    event.preventDefault();
  });

  app.on('quit', () => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill();
    }
  });
}
