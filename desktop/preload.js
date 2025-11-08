const { contextBridge } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
  console.log('✅ script validated');
});

contextBridge.exposeInMainWorld('ratpadDesktop', {
  getEnvironment() {
    return {
      platform: process.platform,
      isPackaged: Boolean(process?.mainModule?.filename?.includes('app.asar'))
    };
  }
});
