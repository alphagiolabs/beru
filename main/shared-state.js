import { app } from "electron";

let _mainWindow = null;
export const getMainWindow = () => _mainWindow;
export const setMainWindow = (win) => {
  _mainWindow = win;
};

let _appIsQuitting = false;
export const getAppIsQuitting = () => _appIsQuitting;
export const setAppIsQuitting = (quitting) => {
  _appIsQuitting = Boolean(quitting);
};

export const isDev = !app.isPackaged;
