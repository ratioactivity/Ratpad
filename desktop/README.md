# Ratpad Desktop Wrapper

This directory contains an Electron-based desktop shell that loads the existing Ratpad UI.

## Development

```bash
cd desktop
npm install
npm run dev
```

The app will launch on the ScreenPad Plus display when connected. It maximizes the window and hides the application menu by default.

## Packaging

To generate distributables using `electron-builder`:

```bash
npm run dist
```

Portable and NSIS installers for Windows will be produced in the `dist/` directory. The build configuration bundles the Ratpad assets that live in the repository root.
