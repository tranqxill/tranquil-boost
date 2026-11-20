# Tranquil Boost

A free Windows PC optimizer for gaming, made by Tranquil Interactive Co.

- **Optimize**: power plan, Game Mode, game recording, GPU scheduling, CPU priority for games, mouse acceleration, and more
- **Network & ping**: ping/jitter test, DNS speed test and switcher, network throttling and Nagle tweaks
- **Cleanup**: temp files, old Windows Update downloads, crash dumps, shader caches, Recycle Bin
- **Startup apps**: turn apps on or off at startup (same switch Task Manager uses)
- **Live stats**: CPU, GPU and RAM usage with graphs
- **Backups & undo**: every change saves your old setting first, so you can undo one or all of them

## Safety

- Before changing anything, the app saves the exact old value. Undo puts that value back, or deletes the setting if it wasn't there before.
- It tries to make a Windows restore point before the first change each session.
- Nothing is deleted from startup apps. They're only switched off.
- The app never loads anything from the internet. The window can only ask for named actions, and it can't run its own commands.
- Every push is tested on a fresh Windows machine in GitHub Actions. Each tweak is applied, checked, undone, and compared against the original values (`scripts/selftest.js`).

## Download

Get the latest installer from the Releases page. Windows will ask for admin rights because most tweaks change system settings.

The installer isn't code-signed yet, so Windows SmartScreen may show "Windows protected your PC". Click **More info** and then **Run anyway**.

## Building

```
npm install
npm start        # run it (from an admin terminal)
npm run dist     # build the installer into dist/
```

Pushing to `main` builds the installer in GitHub Actions (see the Actions tab). Pushing a tag like `v0.1.0` also publishes a release.
