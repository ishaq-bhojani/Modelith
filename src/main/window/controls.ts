import { app, dialog, ipcMain, Menu, shell } from 'electron'
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { CHANNELS } from '../../shared/ipc.js'

/**
 * Window-chrome handlers for the frameless title bar (design "Windows 11 —
 * frameless titlebar"). The renderer draws the minimise / maximise / close
 * controls and the ⋯ app menu; these handlers perform the privileged window
 * operations behind them. All operate on the currently-live window supplied by
 * `getWindow`, mirroring how the chat handlers are wired.
 */
export function registerWindowHandlers(getWindow: () => BrowserWindow | undefined): void {
  ipcMain.handle(CHANNELS.windowMinimize, () => getWindow()?.minimize())

  ipcMain.handle(CHANNELS.windowMaximizeToggle, () => {
    const win = getWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.handle(CHANNELS.windowClose, () => getWindow()?.close())

  ipcMain.handle(CHANNELS.windowIsMaximized, () => getWindow()?.isMaximized() ?? false)

  ipcMain.handle(CHANNELS.windowOpenChatsFolder, () => {
    // The sessions live under userData/sessions (see SessionStore construction
    // in handlers.ts). Opening it lets a user inspect the plain JSONL the app
    // promises to store — reinforcing the "your data, on your machine" pitch.
    void shell.openPath(join(app.getPath('userData'), 'sessions'))
  })

  ipcMain.handle(CHANNELS.windowAbout, () => {
    const win = getWindow()
    const detail = `Version ${app.getVersion()}\n\nA provider-agnostic, agent-first desktop workspace.\nKeys stay in the OS keychain; conversations stay on this machine.`
    if (win) void dialog.showMessageBox(win, { type: 'info', title: 'Modelith', message: 'Modelith', detail, buttons: ['OK'] })
    else void dialog.showMessageBox({ type: 'info', title: 'Modelith', message: 'Modelith', detail, buttons: ['OK'] })
  })

  ipcMain.handle(CHANNELS.appQuit, () => app.quit())
}

/**
 * Installs an application menu whose only job now is to keep keyboard
 * accelerators firing — the design removed the visible OS menu strip and folds
 * the same actions into the renderer's ⋯ menu, but "accelerators still fire".
 *
 * On a frameless Windows/Linux window the menu bar is not shown; on macOS the
 * first submenu becomes the standard app menu. Each accelerator forwards to the
 * renderer through the same channel the ⋯ menu uses, so there is one code path
 * per action regardless of how it was triggered.
 */
export function installAppMenu(getWindow: () => BrowserWindow | undefined): void {
  const isMac = process.platform === 'darwin'
  const send = (channel: string) => () => getWindow()?.webContents.send(channel)

  const fileItems: MenuItemConstructorOptions[] = [
    { label: 'New chat', accelerator: 'CmdOrCtrl+N', click: send(CHANNELS.menuNewChat) },
    { type: 'separator' },
    { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: send(CHANNELS.menuSettings) },
    { label: 'Open chats folder…', click: () => void shell.openPath(join(app.getPath('userData'), 'sessions')) },
    { type: 'separator' },
    isMac ? { role: 'close' } : { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
  ]

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{ label: app.name, submenu: [{ role: 'about' as const }, { type: 'separator' as const }, { role: 'quit' as const }] }]
      : []),
    { label: 'File', submenu: fileItems },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        // No accelerators here: ⌘K and ⌘F are owned by the renderer's own key
        // handlers (CommandPalette, Sidebar). Binding them on the menu too would
        // double-fire — the menu path and the keydown both running for one press,
        // which toggled the palette open then immediately shut. The menu items
        // stay clickable and route through the same channels.
        { label: 'Command palette', click: send(CHANNELS.menuCommandPalette) },
        { label: 'Search chats', click: send(CHANNELS.menuSearch) },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(process.env['ELECTRON_RENDERER_URL'] ? [{ role: 'toggleDevTools' as const }] : []),
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
