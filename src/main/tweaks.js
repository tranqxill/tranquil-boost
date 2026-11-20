'use strict';
// Every tweak the app can apply. Registry tweaks save the old values first
// so Undo puts back exactly what was there (or deletes the value if it
// didn't exist before).
//
// effect: 'now' | 'signout' | 'restart'

const MM = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile';
const CDM = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager';

const reg = (path, name, data, type = 'DWord') => ({ path, name, data, type });

// Service tweaks set the service's start type (2 automatic, 3 manual,
// 4 disabled). Services that don't exist on a PC are skipped.
function svc(id, title, desc, recommended, list) {
  return {
    id,
    cat: 'services',
    title,
    desc,
    recommended,
    effect: 'restart',
    requireKey: true,
    values: list.map(([name, start]) => reg(`HKLM:\\SYSTEM\\CurrentControlSet\\Services\\${name}`, 'Start', start)),
  };
}

const TWEAKS = [
  // ---------------- FPS & latency ----------------
  {
    id: 'power-plan',
    cat: 'fps',
    title: 'High performance power plan',
    desc: 'Switches to Ultimate Performance (or High Performance if your PC doesn\'t have it) so your CPU stops dropping its clock speed mid-game. Uses more power, so maybe skip it on a laptop running on battery.',
    recommended: true,
    effect: 'now',
    kind: 'script',
    // Returns the GUID of the plan that's active right now.
    capture: `
      $line = (powercfg /getactivescheme) | Out-String
      if ($line -match '([0-9a-fA-F-]{36})') { @{ guid = $Matches[1] } } else { throw 'Could not read the active power plan.' }
    `,
    apply: `
      $ultimate = 'e9a42b02-d5df-448d-aa00-03f14749eb61'
      $high = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'
      $list = (powercfg /list) | Out-String
      $target = $null
      foreach ($l in ($list -split "\\r?\\n")) {
        if ($l -match '([0-9a-fA-F-]{36})\\s+\\((Ultimate Performance|Tranquil Boost)\\)') { $target = $Matches[1]; break }
      }
      if (-not $target) {
        $out = (cmd.exe /c "powercfg -duplicatescheme $ultimate 2>nul") | Out-String
        if ($out -match '([0-9a-fA-F-]{36})') {
          $target = $Matches[1]
          powercfg /changename $target 'Tranquil Boost' 'Ultimate Performance plan added by Tranquil Boost' | Out-Null
        }
      }
      if (-not $target -and $list -match $high) { $target = $high }
      if (-not $target) { throw 'This PC does not offer a high performance power plan (common on newer laptops).' }
      powercfg /setactive $target | Out-Null
      if ($LASTEXITCODE -ne 0) { throw 'Windows would not switch power plans.' }
    `,
    restore: `
      powercfg /setactive $b.guid | Out-Null
      if ($LASTEXITCODE -ne 0) { powercfg /setactive 381b4222-f694-41f0-9685-ff5bb260df2e | Out-Null }
    `,
    check: `
      $line = (powercfg /getactivescheme) | Out-String
      [bool]($line -match '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c|\\((Ultimate Performance|Tranquil Boost|High performance)\\)')
    `,
  },
  {
    id: 'game-mode',
    cat: 'fps',
    title: 'Windows Game Mode',
    desc: 'Makes sure Windows Game Mode is on. It gives the game you\'re playing priority and holds off Windows Update restarts while you play.',
    recommended: true,
    effect: 'now',
    values: [
      reg('HKCU:\\Software\\Microsoft\\GameBar', 'AllowAutoGameMode', 1),
      reg('HKCU:\\Software\\Microsoft\\GameBar', 'AutoGameModeEnabled', 1),
    ],
  },
  {
    id: 'game-dvr',
    cat: 'fps',
    title: 'Turn off background game recording',
    desc: 'Stops Xbox Game Bar from recording gameplay in the background, which costs FPS. Game Bar itself still opens with Win+G.',
    recommended: true,
    effect: 'signout',
    values: [
      reg('HKCU:\\System\\GameConfigStore', 'GameDVR_Enabled', 0),
      reg('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR', 'AppCaptureEnabled', 0),
    ],
  },
  {
    id: 'hags',
    cat: 'fps',
    title: 'Hardware-accelerated GPU scheduling',
    desc: 'Lets your graphics card manage its own memory instead of Windows. Can lower latency on newer GPUs (GTX 10 series / RX 5000 and up). Needs a restart.',
    recommended: false,
    effect: 'restart',
    values: [reg('HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers', 'HwSchMode', 2)],
  },
  {
    id: 'game-priority',
    cat: 'fps',
    title: 'Give games more CPU priority',
    desc: 'Tells Windows to save less CPU time for background tasks and to put games first when they ask for it.',
    recommended: true,
    effect: 'restart',
    values: [
      reg(MM, 'SystemResponsiveness', 10),
      reg(`${MM}\\Tasks\\Games`, 'GPU Priority', 8),
      reg(`${MM}\\Tasks\\Games`, 'Priority', 6),
      reg(`${MM}\\Tasks\\Games`, 'Scheduling Category', 'High', 'String'),
      reg(`${MM}\\Tasks\\Games`, 'SFIO Priority', 'High', 'String'),
    ],
  },
  {
    id: 'mouse-accel',
    cat: 'fps',
    title: 'Turn off mouse acceleration',
    desc: 'Same as unticking "Enhance pointer precision". Your aim moves the same distance no matter how fast you flick. Takes effect after you sign out.',
    recommended: true,
    effect: 'signout',
    values: [
      reg('HKCU:\\Control Panel\\Mouse', 'MouseSpeed', '0', 'String'),
      reg('HKCU:\\Control Panel\\Mouse', 'MouseThreshold1', '0', 'String'),
      reg('HKCU:\\Control Panel\\Mouse', 'MouseThreshold2', '0', 'String'),
    ],
  },
  {
    id: 'power-throttling',
    cat: 'fps',
    title: 'Turn off power throttling',
    desc: 'Stops Windows from slowing down apps it thinks are in the background. Good for desktops. On a laptop it can cut battery life.',
    recommended: false,
    effect: 'restart',
    values: [reg('HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power\\PowerThrottling', 'PowerThrottlingOff', 1)],
  },
  {
    id: 'fso',
    cat: 'fps',
    title: 'Turn off fullscreen optimizations',
    desc: 'Makes fullscreen games run in true exclusive fullscreen. Helps some older games, does nothing for others. Try it and see.',
    recommended: false,
    effect: 'signout',
    values: [
      reg('HKCU:\\System\\GameConfigStore', 'GameDVR_FSEBehaviorMode', 2),
      reg('HKCU:\\System\\GameConfigStore', 'GameDVR_HonorUserFSEBehaviorMode', 1),
      reg('HKCU:\\System\\GameConfigStore', 'GameDVR_FSEBehavior', 2),
    ],
  },
  {
    id: 'transparency',
    cat: 'fps',
    title: 'Turn off transparency effects',
    desc: 'Removes the see-through blur on the taskbar and Start menu. Small win on older or low-end PCs.',
    recommended: false,
    effect: 'now',
    values: [reg('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', 'EnableTransparency', 0)],
  },
  {
    id: 'background-apps',
    cat: 'fps',
    title: 'Stop Store apps running in the background',
    desc: 'Microsoft Store apps won\'t keep running after you close them. Apps like Discord or Steam aren\'t affected.',
    recommended: false,
    effect: 'now',
    values: [reg('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAccessApplications', 'GlobalUserDisabled', 1)],
  },

  // ---------------- Network ----------------
  {
    id: 'network-throttling',
    cat: 'network',
    title: 'Turn off network throttling',
    desc: 'Windows limits network traffic while media is playing. This removes that limit so music or videos in the background don\'t mess with your ping.',
    recommended: true,
    effect: 'restart',
    values: [reg(MM, 'NetworkThrottlingIndex', 0xffffffff)],
  },
  {
    id: 'nagle',
    cat: 'network',
    title: 'Turn off Nagle\'s algorithm',
    desc: 'Windows sometimes holds small packets back to send them in groups. This sends them straight away, which can help ping in some online games.',
    recommended: true,
    effect: 'restart',
    kind: 'script',
    capture: `
      $base = 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces'
      $out = @()
      foreach ($k in Get-ChildItem $base) {
        $p = Get-ItemProperty $k.PSPath
        $ip = "$($p.DhcpIPAddress)$($p.IPAddress)"
        if (-not $ip -or $ip -eq '0.0.0.0') { continue }
        $out += @{
          path = $k.PSPath
          ack  = if ($null -ne $p.TcpAckFrequency) { [int]$p.TcpAckFrequency } else { $null }
          nodelay = if ($null -ne $p.TCPNoDelay) { [int]$p.TCPNoDelay } else { $null }
        }
      }
      @{ items = $out }
    `,
    apply: `
      if (-not $b.items -or @($b.items).Count -eq 0) { throw 'No connected network adapters found.' }
      foreach ($i in @($b.items)) {
        New-ItemProperty -Path $i.path -Name TcpAckFrequency -PropertyType DWord -Value 1 -Force | Out-Null
        New-ItemProperty -Path $i.path -Name TCPNoDelay -PropertyType DWord -Value 1 -Force | Out-Null
      }
    `,
    restore: `
      foreach ($i in @($b.items)) {
        if (-not (Test-Path $i.path)) { continue }
        if ($null -eq $i.ack) { Remove-ItemProperty -Path $i.path -Name TcpAckFrequency -ErrorAction SilentlyContinue }
        else { New-ItemProperty -Path $i.path -Name TcpAckFrequency -PropertyType DWord -Value $i.ack -Force | Out-Null }
        if ($null -eq $i.nodelay) { Remove-ItemProperty -Path $i.path -Name TCPNoDelay -ErrorAction SilentlyContinue }
        else { New-ItemProperty -Path $i.path -Name TCPNoDelay -PropertyType DWord -Value $i.nodelay -Force | Out-Null }
      }
    `,
    check: `
      $base = 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces'
      $any = $false; $all = $true
      foreach ($k in Get-ChildItem $base) {
        $p = Get-ItemProperty $k.PSPath
        $ip = "$($p.DhcpIPAddress)$($p.IPAddress)"
        if (-not $ip -or $ip -eq '0.0.0.0') { continue }
        $any = $true
        if ($p.TcpAckFrequency -ne 1 -or $p.TCPNoDelay -ne 1) { $all = $false }
      }
      [bool]($any -and $all)
    `,
  },

  // ---------------- Privacy ----------------
  {
    id: 'ad-id',
    cat: 'privacy',
    title: 'Turn off advertising ID',
    desc: 'Stops apps from using your Windows advertising ID to show you targeted ads.',
    recommended: true,
    effect: 'now',
    values: [reg('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo', 'Enabled', 0)],
  },
  {
    id: 'start-ads',
    cat: 'privacy',
    title: 'Remove suggestions and ads in Windows',
    desc: 'Gets rid of "suggested" apps in Start, tips in Settings, and stops Windows from quietly installing promoted apps.',
    recommended: true,
    effect: 'signout',
    values: [
      reg(CDM, 'SystemPaneSuggestionsEnabled', 0),
      reg(CDM, 'SilentInstalledAppsEnabled', 0),
      reg(CDM, 'SubscribedContent-338388Enabled', 0),
      reg(CDM, 'SubscribedContent-338389Enabled', 0),
      reg(CDM, 'SubscribedContent-353694Enabled', 0),
      reg(CDM, 'SubscribedContent-353696Enabled', 0),
    ],
  },
  {
    id: 'tailored',
    cat: 'privacy',
    title: 'Turn off tailored experiences',
    desc: 'Microsoft won\'t use your diagnostic data to pick tips and offers for you.',
    recommended: true,
    effect: 'now',
    values: [reg('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Privacy', 'TailoredExperiencesWithDiagnosticDataEnabled', 0)],
  },
  {
    id: 'bing-search',
    cat: 'privacy',
    title: 'Keep web results out of Start search',
    desc: 'Searching in the Start menu only looks at your PC instead of also sending what you type to Bing. Search feels quicker too.',
    recommended: false,
    effect: 'signout',
    values: [
      reg('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Search', 'BingSearchEnabled', 0),
      reg('HKCU:\\Software\\Policies\\Microsoft\\Windows\\Explorer', 'DisableSearchBoxSuggestions', 1),
    ],
  },
  {
    id: 'telemetry',
    cat: 'privacy',
    title: 'Lower diagnostic data',
    desc: 'Sends Microsoft the least diagnostic data your Windows edition allows. Windows Update still works normally.',
    recommended: false,
    effect: 'restart',
    values: [reg('HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection', 'AllowTelemetry', 0)],
  },
  {
    id: 'activity-history',
    cat: 'privacy',
    title: 'Turn off activity history',
    desc: 'Windows stops keeping a timeline of the apps and files you\'ve opened.',
    recommended: false,
    effect: 'signout',
    values: [
      reg('HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System', 'PublishUserActivities', 0),
      reg('HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\System', 'UploadUserActivities', 0),
    ],
  },

  // ---------- more FPS & latency ----------
  {
    id: 'windowed-opt',
    cat: 'fps',
    title: 'Optimizations for windowed games',
    desc: 'Lets borderless and windowed games skip a step Windows normally adds before drawing a frame. Lower input lag without needing exclusive fullscreen. Restart your game after turning it on.',
    recommended: true,
    effect: 'now',
    values: [reg('HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences', 'DirectXUserGlobalSettings', 'SwapEffectUpgradeEnable=1;', 'String')],
  },
  {
    id: 'usb-pcie-power',
    cat: 'fps',
    title: 'Turn off USB and PCIe power saving',
    desc: 'Stops Windows putting USB ports and your graphics card\'s PCIe link to sleep to save power. Fixes mice and headsets cutting out and small stutters. Changes your current power plan only.',
    recommended: true,
    effect: 'now',
    kind: 'script',
    capture: `
      $line = (powercfg /getactivescheme) | Out-String
      if ($line -notmatch '([0-9a-fA-F-]{36})') { throw 'Could not read the active power plan.' }
      $scheme = $Matches[1]
      function Get-AC($sub, $set) {
        $q = (cmd.exe /c "powercfg /q $scheme $sub $set 2>nul") | Out-String
        # Works in any language: the last two 0x values are the AC and DC settings.
        $m = [regex]::Matches($q, ':\\s*0x([0-9a-fA-F]{8})')
        if ($m.Count -ge 2) { return [Convert]::ToInt32($m[$m.Count - 2].Groups[1].Value, 16) }
        return $null
      }
      @{
        scheme = $scheme
        usb = (Get-AC '2a737441-1930-4402-8d77-b2bebba308a3' '48e6b7a6-50f5-4782-a5d4-53bb8f07e226')
        pcie = (Get-AC '501a4d13-42af-4429-9fd1-a8218c268e20' 'ee12f906-d277-404b-b6da-e5fa1a576df5')
      }
    `,
    apply: `
      if ($null -eq $b.usb -and $null -eq $b.pcie) { throw 'This PC\\'s power plan doesn\\'t have these settings.' }
      if ($null -ne $b.usb) { powercfg /setacvalueindex $b.scheme 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0 | Out-Null }
      if ($null -ne $b.pcie) { powercfg /setacvalueindex $b.scheme 501a4d13-42af-4429-9fd1-a8218c268e20 ee12f906-d277-404b-b6da-e5fa1a576df5 0 | Out-Null }
      powercfg /setactive $b.scheme | Out-Null
    `,
    restore: `
      if ($null -ne $b.usb) { powercfg /setacvalueindex $b.scheme 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 $b.usb | Out-Null }
      if ($null -ne $b.pcie) { powercfg /setacvalueindex $b.scheme 501a4d13-42af-4429-9fd1-a8218c268e20 ee12f906-d277-404b-b6da-e5fa1a576df5 $b.pcie | Out-Null }
      $line = (powercfg /getactivescheme) | Out-String
      if ($line -match $b.scheme) { powercfg /setactive $b.scheme | Out-Null }
    `,
    check: `
      $found = $false; $all = $true
      foreach ($pair in @(@('2a737441-1930-4402-8d77-b2bebba308a3','48e6b7a6-50f5-4782-a5d4-53bb8f07e226'), @('501a4d13-42af-4429-9fd1-a8218c268e20','ee12f906-d277-404b-b6da-e5fa1a576df5'))) {
        $q = (cmd.exe /c "powercfg /q SCHEME_CURRENT $($pair[0]) $($pair[1]) 2>nul") | Out-String
        $m = [regex]::Matches($q, ':\\s*0x([0-9a-fA-F]{8})')
        if ($m.Count -ge 2) { $found = $true; if ([Convert]::ToInt32($m[$m.Count - 2].Groups[1].Value, 16) -ne 0) { $all = $false } }
      }
      if (-not $found) { $null } else { [bool]$all }
    `,
  },
  {
    id: 'foreground-boost',
    cat: 'fps',
    title: 'Favor the app you\'re using',
    desc: 'Gives the window in front (your game) shorter, more frequent turns on the CPU than background apps. A popular tweak with small but real gains on busy PCs.',
    recommended: false,
    effect: 'now',
    values: [reg('HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl', 'Win32PrioritySeparation', 38)],
  },
  {
    id: 'timer-res',
    cat: 'fps',
    title: 'Keep high timer accuracy for games',
    desc: 'On Windows 11, a game that asks for precise timing can lose it when its window isn\'t in focus. This keeps it on. Helps frame pacing in some games. Does nothing on Windows 10.',
    recommended: false,
    effect: 'restart',
    values: [reg('HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\kernel', 'GlobalTimerResolutionRequests', 1)],
  },
  {
    id: 'visual-effects',
    cat: 'fps',
    title: 'Lighter Windows animations',
    desc: 'Turns off window animations, fades and shadows but keeps text smooth. Windows feels snappier and uses a little less GPU. Same as "Adjust for best performance" minus the ugly fonts.',
    recommended: false,
    effect: 'signout',
    values: [
      reg('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects', 'VisualFXSetting', 3),
      reg('HKCU:\\Control Panel\\Desktop', 'UserPreferencesMask', [0x90, 0x12, 0x03, 0x80, 0x10, 0x00, 0x00, 0x00], 'Binary'),
      reg('HKCU:\\Control Panel\\Desktop', 'FontSmoothing', '2', 'String'),
      reg('HKCU:\\Control Panel\\Desktop\\WindowMetrics', 'MinAnimate', '0', 'String'),
      reg('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', 'TaskbarAnimations', 0),
    ],
  },

  // ---------- more network ----------
  {
    id: 'delivery-opt',
    cat: 'network',
    title: 'Stop sharing updates with other PCs',
    desc: 'By default Windows can upload update files to strangers\' PCs over the internet. This keeps your upload bandwidth for your games and calls. Updates still download normally.',
    recommended: true,
    effect: 'now',
    values: [reg('HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DeliveryOptimization', 'DODownloadMode', 0)],
  },

  // ---------- quality of life ----------
  {
    id: 'sticky-keys',
    cat: 'qol',
    title: 'Stop Sticky Keys popups',
    desc: 'No more Sticky Keys box popping up and tabbing you out of a game when you hit Shift five times. You can still turn Sticky Keys on in Settings if you use it.',
    recommended: true,
    effect: 'signout',
    values: [
      reg('HKCU:\\Control Panel\\Accessibility\\StickyKeys', 'Flags', '506', 'String'),
      reg('HKCU:\\Control Panel\\Accessibility\\ToggleKeys', 'Flags', '58', 'String'),
      reg('HKCU:\\Control Panel\\Accessibility\\Keyboard Response', 'Flags', '122', 'String'),
    ],
  },
  {
    id: 'menu-delay',
    cat: 'qol',
    title: 'Snappier menus',
    desc: 'Menus that open on hover show up right away instead of after a short wait.',
    recommended: false,
    effect: 'signout',
    values: [reg('HKCU:\\Control Panel\\Desktop', 'MenuShowDelay', '0', 'String')],
  },
  {
    id: 'fast-startup',
    cat: 'qol',
    title: 'Turn off Fast Startup',
    desc: 'Shutting down gives you a truly fresh start instead of a half-hibernated one. Fixes a lot of "it only works after a restart" problems. Booting can take a few seconds longer.',
    recommended: false,
    effect: 'restart',
    values: [reg('HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power', 'HiberbootEnabled', 0)],
  },
  {
    id: 'shutdown-speed',
    cat: 'qol',
    title: 'Faster shutdown',
    desc: 'Windows waits 2 seconds instead of 5 for stuck background services before shutting down.',
    recommended: false,
    effect: 'restart',
    values: [reg('HKLM:\\SYSTEM\\CurrentControlSet\\Control', 'WaitToKillServiceTimeout', '2000', 'String')],
  },

  // ---------- more privacy ----------
  {
    id: 'feedback',
    cat: 'privacy',
    title: 'Stop feedback requests',
    desc: 'Windows stops popping up asking you to rate it or give feedback.',
    recommended: true,
    effect: 'now',
    values: [reg('HKCU:\\Software\\Microsoft\\Siuf\\Rules', 'NumberOfSIUFInPeriod', 0)],
  },
  {
    id: 'lockscreen-ads',
    cat: 'privacy',
    title: 'Remove lock screen tips and ads',
    desc: 'Gets rid of the "fun facts" and promos on the lock screen.',
    recommended: true,
    effect: 'signout',
    values: [
      reg(CDM, 'RotatingLockScreenOverlayEnabled', 0),
      reg(CDM, 'SubscribedContent-338387Enabled', 0),
    ],
  },
  {
    id: 'app-tracking',
    cat: 'privacy',
    title: 'Stop tracking which apps you open',
    desc: 'Windows stops keeping a list of the apps you launch to sort Start and search results.',
    recommended: false,
    effect: 'signout',
    values: [reg('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', 'Start_TrackProgs', 0)],
  },
  {
    id: 'recall',
    cat: 'privacy',
    title: 'Turn off Recall snapshots',
    desc: 'Stops Windows Recall from saving snapshots of your screen. Only matters on Copilot+ PCs that have Recall.',
    recommended: false,
    effect: 'restart',
    values: [reg('HKCU:\\Software\\Policies\\Microsoft\\Windows\\WindowsAI', 'DisableAIDataAnalysis', 1)],
  },

  // ---------- services ----------
  svc('svc-telemetry', 'Turn off the telemetry service', 'Stops "Connected User Experiences and Telemetry", the service that sends usage data to Microsoft. Nothing you use depends on it.', true, [['DiagTrack', 4]]),
  svc('svc-unused', 'Turn off services almost nobody uses', 'Fax, the store demo mode, and the offline maps updater. They sit in the background for nothing on a gaming PC.', true, [['Fax', 4], ['RetailDemo', 4], ['MapsBroker', 3]]),
  svc('svc-wer', 'Turn off error reporting', 'Windows stops collecting and sending crash reports. Crashes still get logged on your PC.', false, [['WerSvc', 4]]),
  svc('svc-print', 'I don\'t have a printer', 'Turns off the print service. Printing and "Print to PDF" stop working until you undo this.', false, [['Spooler', 4]]),
  svc('svc-xbox', 'I don\'t use the Xbox app or Game Pass', 'Turns off Xbox sign-in and cloud save services. Don\'t use this if you play Game Pass or Microsoft Store games. Xbox controllers keep working.', false, [['XblAuthManager', 4], ['XblGameSave', 4], ['XboxNetApiSvc', 4]]),
  svc('svc-sysmain', 'Turn off SysMain (SSD only)', 'SysMain preloads apps into memory. On an SSD that barely helps and it can cause disk spikes. Leave it on if Windows is on a hard drive.', false, [['SysMain', 4]]),
  svc('svc-search', 'Turn off search indexing', 'Stops Windows constantly scanning your files for search. Frees up disk and CPU, but searching files in Start and Explorer gets slower.', false, [['WSearch', 4]]),
];

const byId = new Map(TWEAKS.map((t) => [t.id, t]));

module.exports = { TWEAKS, byId };
