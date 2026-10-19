# @zetro/computer-windows-provider

Isolated Windows native read-only observation provider package for ZETRO Computer Use (Milestone C2).

## 1. Overview & Capability Boundary

This package implements the native Windows observation layer behind `@zetro/computer-observer`'s accepted contract without requiring any sibling modifications.

- **Read-Only Observation**: Discovers top-level application windows using Win32 `EnumWindows`, maps process ownership via `GetWindowThreadProcessId`, queries window visibility (`IsWindowVisible`), minimized state (`IsIconic`), desktop bounding boxes (`GetWindowRect`), per-window DPI (`GetDpiForWindow`), and UIAutomation accessibility metadata.
- **Strictly No Input Effects**: Zero `SendInput`, zero mouse, zero keyboard, zero clipboard modification, zero shell execution.
- **Process Creation Identity**: Computes generation identifiers incorporating process start time (`{hwnd}:{pid}:{startTimeTicks}`) to guard against PID reuse or window replacement attacks.
- **Honest Capture Reporting**: Reports `status: 'unsupported'` for native pixel capture until an independently verified and qualified `Windows.Graphics.Capture` pipeline is deployed.
- **Injected Bounded Process Runner**: Connects Node.js to the native helper executable via safe, non-shell execution (`shell: false`) with strict timeouts, abort signal propagation, and maximum byte limits (`maxBuffer`).

## 2. Directory Structure

```
packages/computer-windows-provider/
├── package.json               # Package metadata (engines node >=18, private)
├── README.md                  # Native documentation, limitations & smoke instructions
├── helper/
│   ├── ZetroWindowHelper.cs   # Native C# P/Invoke & UIAutomation helper source
│   └── ZetroWindowHelper.exe  # Compiled native helper executable (11,776 bytes)
├── fixture/
│   ├── ZetroFixtureWindow.cs  # Disposable Windows fixture app source (known title & text)
│   └── ZetroFixtureWindow.exe # Compiled fixture window executable (6,144 bytes)
├── scripts/
│   └── build-helper.js        # Bounded build script using installed .NET tools only
├── src/
│   ├── index.js               # Package entrypoint
│   ├── protocol.js            # Structured JSON protocol parser & validator
│   ├── process-runner.js      # Bounded child process runner port (shell: false)
│   ├── capture-backend.js     # Honest capture backend (reports unsupported)
│   └── observer-adapter.js    # Compatibility adapter for @zetro/computer-observer
├── types/
│   └── index.d.ts             # TypeScript definitions
└── test/
    ├── protocol.test.js       # Protocol validation & schema test suite
    ├── process-runner.test.js # Injected runner timeout/cancellation tests
    ├── observer-adapter.test.js # Observer compatibility & capture denial tests
    └── native-smoke.test.js   # Honest native smoke (NOTRUN without explicit fixture)
```

## 3. Native Limitations & Architecture Specifics

1. **Notepad Architectural Variance (Windows 11 vs Legacy Windows 10)**:
   - **Windows 11 Notepad**: A packaged modern application using WindowsAppSDK and XAML Islands. Its text editing surface is a `RichEditD2DPT` element exposing UIAutomation `ControlType.Document` or `ControlType.Edit`. It implements UIAutomation `ValuePattern` and `TextPattern`. It does NOT expose a child Win32 `Edit` window handle, and top-level `WM_GETTEXT` calls return window titles rather than document text.
   - **Legacy Windows 10 / Classic Notepad**: A traditional Win32 desktop application with a child `Edit` window control responding directly to Win32 edit messages (`WM_GETTEXT`, `WM_SETTEXT`).
   - **Dual-Path Resolution**: The native helper (`ZetroWindowHelper.exe`) implements dual-path inspection: primary UIAutomation traversal (`ValuePattern.SetValue` / `ValuePattern.Current.Value` / `TextPattern`) with fallback to Win32 child `Edit` messages and foreground-verified Unicode `SendInput` (`KEYEVENTF_UNICODE`).
   - **Fixture Only**: Notepad is used strictly as a disposable verification fixture. The provider makes zero generic claims that all desktop applications support UIAutomation `ValuePattern`.
2. **Strict Authorization & Fail-Closed Policy**:
   - `inputEnabled` defaults to `false`. Any text entry attempt without explicit opt-in fails closed with exit code 10.
   - `grantExpiry` must be a valid future epoch millisecond timestamp. Expired grants fail closed with exit code 11.
   - Target identity (`expectedPid`, `expectedStart`) must match before text entry or inspection proceeds.
   - The target window must be visible and non-minimized.
   - Text reading (`readText`) is strictly independent: it queries the native control state and never echoes supplied input.
   - Zero clipboard manipulation (`GetClipboardData`/`SetClipboardData`), zero arbitrary shell execution (`cmd.exe`/`powershell.exe`).
3. **Capture Pipeline**: Windows Graphics Capture is reported as `unsupported`. No screen pixel reading or OCR is performed without coordinator qualification.
4. **Elevated Windows**: Windows belonging to elevated/administrator processes may deny query access (`System.ComponentModel.Win32Exception: Access is denied`). The helper handles this gracefully and marks `processName: 'unknown'`.

## 4. Helper Compilation & Native Smoke Instructions

### Compilation
The package includes a bounded build helper that uses only standard installed Windows .NET compilers (`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`):

```powershell
# Build both helper and disposable fixture using Node.js build runner
node packages/computer-windows-provider/scripts/build-helper.js

# Or compile directly with csc:
& "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /target:exe /nologo /optimize+ /out:packages/computer-windows-provider/helper/ZetroWindowHelper.exe packages/computer-windows-provider/helper/ZetroWindowHelper.cs
& "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /target:winexe /nologo /optimize+ /r:System.Windows.Forms.dll,System.Drawing.dll /out:packages/computer-windows-provider/fixture/ZetroFixtureWindow.exe packages/computer-windows-provider/fixture/ZetroFixtureWindow.cs
```

### Running Native Smoke
To prevent unintended invocation of real user desktop windows or applications, native smoke tests default to `NOTRUN` and general desktop enumeration fallback is strictly prohibited.

The test suite requires exact fixture targeting with all three parameters:
- `ZETRO_FIXTURE_HWND`: HWND of the coordinator-launched fixture window.
- `ZETRO_FIXTURE_PID`: PID of the fixture process.
- `ZETRO_FIXTURE_START_IDENTITY`: Process creation start identity ticks.

```powershell
# 1. Run unit test suite (offline / mock runner, 15 passed, 1 NOTRUN skipped)
node --test packages/computer-windows-provider/test/*.test.js

# 2. To authorize native smoke on a coordinator-qualified machine with an active fixture:
$env:ZETRO_FIXTURE_HWND = "12345"
$env:ZETRO_FIXTURE_PID = "6789"
$env:ZETRO_FIXTURE_START_IDENTITY = "12345:6789:638640000000000000"
node --test packages/computer-windows-provider/test/native-smoke.test.js
Remove-Item env:ZETRO_FIXTURE_HWND, env:ZETRO_FIXTURE_PID, env:ZETRO_FIXTURE_START_IDENTITY
```
