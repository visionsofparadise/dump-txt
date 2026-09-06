# dump.txt

A minimal Windows scratchpad with pages, autosave, and undo across pages.

## Install

Download **dump-txt-Setup-0.1.0.exe** from [GitHub Releases](https://github.com/visionsofparadise/dump-txt/releases/latest) for Windows x64. Open the installer, click **Install**, then finish with the launch checkbox selected to open dump.txt.

The installer is unsigned, so Windows may show a publisher warning.

## Use

dump.txt starts with a scratch file and automatically saves changes to the current file. Use **Open** to switch files or **Save As** to choose a name and location. The title shows the current filename. Pages share one text file, separated by form-feed lines.

Use the top and bottom bars to move between pages or insert a page with **+**. Scrolling beyond a page's edge moves to the adjacent page; scrolling over either bar switches pages. Normal navigation remembers your scroll position.

| Control              | Action                                   |
| -------------------- | ---------------------------------------- |
| Ctrl+O               | Open a file                              |
| Ctrl+Shift+S         | Save As                                  |
| Alt+Up / Alt+Down    | Previous / next page                     |
| Alt+Home / Alt+End   | First / last page                        |
| Ctrl+D               | Add the next occurrence to the selection |
| Ctrl+F               | Find and replace                         |
| Ctrl+Z / Ctrl+Y      | Undo / redo                              |
| Ctrl+wheel over text | Change text size                         |
| Ctrl+W               | Save and close                           |

Select text longer than one character to preview other matching occurrences. Ctrl+D immediately adds the next match; with only a caret, its first press selects the word. Match case and All pages settings control occurrence selection. The app menu contains font, text size, and light/dark appearance settings.

## Develop

Use Windows x64, Node.js 24, and npm 12.

Git preserves LF line endings on Windows so fresh checkouts match the formatting checks.

```sh
npm install -g npm@12
git clone https://github.com/visionsofparadise/dump-txt.git
cd dump-txt
npm ci
node node_modules/electron/install.js
npm start
```

Run checks and build the installer:

```sh
npm run check
npm run unit
npm run integration
npm run make
npm run electron-test
```

The installer is written to `out/make/nsis/dump-txt-Setup-0.1.0.exe`. Electron tests use an isolated scratch profile. CI runs these checks and builds on Windows; a successful main-branch run publishes versions that have no existing release.

## License

[MIT](LICENSE) © 2026 Matt Cavender.
