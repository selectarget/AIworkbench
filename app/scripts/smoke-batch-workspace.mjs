import { app, BrowserWindow, WebContentsView, session } from 'electron';

app.commandLine.appendSwitch('disable-gpu');

const fail = (error) => {
  console.error(`batch workspace smoke failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  app.exit(1);
};

app.whenReady().then(async () => {
  const main = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const batch = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const views = [
    new WebContentsView({ webPreferences: { session: session.fromPartition('persist:smoke-batch-a'), contextIsolation: true, nodeIntegration: false, sandbox: true } }),
    new WebContentsView({ webPreferences: { session: session.fromPartition('persist:smoke-batch-b'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
  ];
  try {
    for (const view of views) {
      main.contentView.addChildView(view);
      await view.webContents.loadURL('data:text/html,<title>batch smoke</title><main>ok</main>');
    }
    views.forEach((view, index) => {
      main.contentView.removeChildView(view);
      batch.contentView.addChildView(view);
      view.setBounds({ x: index * 596, y: 0, width: 588, height: 760 });
    });
    for (const view of views) {
      const bounds = view.getBounds();
      if (bounds.width < 500 || bounds.height < 500) throw new Error(`unexpected batch bounds: ${JSON.stringify(bounds)}`);
    }
    for (const view of views) {
      batch.contentView.removeChildView(view);
      main.contentView.addChildView(view);
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
    console.log('batch workspace smoke ok: real WebContentsView views moved to grid and restored');
    batch.destroy();
    main.destroy();
    app.exit(0);
  } catch (error) {
    try { batch.destroy(); } catch {}
    try { main.destroy(); } catch {}
    fail(error);
  }
}).catch(fail);
