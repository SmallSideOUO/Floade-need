$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class FloadeWindowPin {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll", EntryPoint="GetWindowLongW")] public static extern int GetWindowLong(IntPtr hWnd, int index);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int width, int height, uint flags);
}
'@

$pinned = @{}
# A property guards against Windows recycling a closed window's HWND.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FloadePinProperty {
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool SetProp(IntPtr hWnd, string name, IntPtr value);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr GetProp(IntPtr hWnd, string name);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr RemoveProp(IntPtr hWnd, string name);
}
'@
$property = 'Floade.WindowPin.' + [Guid]::NewGuid().ToString('N')
try {
    [Console]::WriteLine('{"ready":true}')
    while ($null -ne ($line = [Console]::ReadLine())) {
        $request = $null
        try {
            $request = $line | ConvertFrom-Json
            $handle = [FloadeWindowPin]::GetForegroundWindow()
            $className = New-Object System.Text.StringBuilder 256
            [void][FloadeWindowPin]::GetClassName($handle, $className, 256)
            if ($handle -eq [IntPtr]::Zero -or $handle -eq [FloadeWindowPin]::GetShellWindow() -or $handle -eq [FloadeWindowPin]::GetDesktopWindow() -or $className.ToString() -in @('Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Progman', 'WorkerW')) { throw 'NO_WINDOW' }
            $topmost = ([FloadeWindowPin]::GetWindowLong($handle, -20) -band 8) -ne 0
            $key = $handle.ToInt64().ToString()
            if (-not $topmost) {
                if (-not [FloadePinProperty]::SetProp($handle, $property, [IntPtr]1)) { throw 'ACCESS_DENIED' }
                $pinned[$key] = $handle
            }
            $after = if ($topmost) { [IntPtr](-2) } else { [IntPtr](-1) }
            # SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE: preserve position, size and focus.
            if (-not [FloadeWindowPin]::SetWindowPos($handle, $after, 0, 0, 0, 0, 0x13)) {
                if (-not $topmost) { [void][FloadePinProperty]::RemoveProp($handle, $property); $pinned.Remove($key) }
                throw 'ACCESS_DENIED'
            }
            if ($topmost) { [void][FloadePinProperty]::RemoveProp($handle, $property); $pinned.Remove($key) }
            $actual = ([FloadeWindowPin]::GetWindowLong($handle, -20) -band 8) -ne 0
            if ($actual -eq $topmost) { throw 'PIN_FAILED' }
            $title = New-Object System.Text.StringBuilder 512
            [void][FloadeWindowPin]::GetWindowText($handle, $title, 512)
            [Console]::WriteLine((@{ id = $request.id; success = $true; pinned = $actual; title = $title.ToString() } | ConvertTo-Json -Compress))
        } catch {
            [Console]::WriteLine((@{ id = $request.id; success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress))
        }
    }
} finally {
    foreach ($handle in $pinned.Values) {
        if ([FloadeWindowPin]::IsWindow($handle) -and [FloadePinProperty]::GetProp($handle, $property) -eq [IntPtr]1) {
            [void][FloadeWindowPin]::SetWindowPos($handle, [IntPtr](-2), 0, 0, 0, 0, 0x13)
            [void][FloadePinProperty]::RemoveProp($handle, $property)
        }
    }
}
