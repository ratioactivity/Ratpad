const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const SCREENPAD_DIMENSIONS = { width: 3840, height: 1100 };

let mainWindow;

function logValidation() {
  console.log('✅ script validated');
}

function resolveRendererPath() {
  const candidatePaths = [
    path.join(__dirname, '..', 'index.html'),
    path.join(app.getAppPath(), 'index.html'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'index.html'),
    path.join(process.resourcesPath, 'app.asar', 'index.html'),
    path.join(process.resourcesPath, 'app', 'index.html')
  ];

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('Unable to locate Ratpad renderer assets.');
}

function findTargetDisplay(displays) {
  const screenPad = displays.find((display) => {
    return (
      display.size?.width === SCREENPAD_DIMENSIONS.width &&
      display.size?.height === SCREENPAD_DIMENSIONS.height
    );
  });

  if (screenPad) {
    return screenPad;
  }

  const primaryId = screen.getPrimaryDisplay()?.id;
  const secondary = displays.find((display) => display.id !== primaryId);
  return secondary || displays[0];
}

function createMainWindow() {
  const displays = screen.getAllDisplays();
  const targetDisplay = findTargetDisplay(displays);
  const { bounds, workArea } = targetDisplay;

  mainWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: workArea?.width || bounds.width,
    height: workArea?.height || bounds.height,
    show: false,
    autoHideMenuBar: true,
    frame: true,
    backgroundColor: '#111827',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const indexPath = resolveRendererPath();
  mainWindow.loadFile(indexPath);

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  logValidation();
}

app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
