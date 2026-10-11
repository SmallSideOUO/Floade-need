Set mapShell = CreateObject("WScript.Shell")
Set mapFS = CreateObject("Scripting.FileSystemObject")
mapScript = mapFS.BuildPath(mapFS.GetParentFolderName(WScript.ScriptFullName), "Open Map.ps1")
mapShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & mapScript & """", 0, False
