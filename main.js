const { app, BrowserWindow } = require('electron')
const path = require('path')

function createWindow () {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.jpg'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  // development vs production check
  const isDev = !app.isPackaged;
  
  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, 'dist', 'index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
