' Silent launcher for DSH Studio (desktop shortcut target keeps console hidden).
' ASCII-only on purpose: Windows Script Host reads .vbs as ANSI, so non-ASCII
' comments can break parsing on some locales.
Dim fso, shell, root, electron
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
' The parent of scripts\ is the repository root, so the shortcut works from Desktop.
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
electron = root & "\node_modules\electron\dist\electron.exe"
If Not fso.FileExists(electron) Then
  MsgBox "Electron is missing. Run npm install in " & root & " first.", 16, "DSH Studio"
  WScript.Quit 1
End If
shell.CurrentDirectory = root
' 1 = normal show; electron.exe is a GUI binary, so no console window appears.
' Passing 0 here would make Electron inherit SW_HIDE and the main window stays hidden.
shell.Run """" & electron & """ """ & root & "\apps\desktop""", 1, False
