; SmartImage installer hooks for `mygo build` (windows.installerInclude).
; Adds image-file context menu entries and installs the Visual C++ runtime
; the matting worker needs. Everything stays in HKCU / $INSTDIR: the
; installer is per-user and the app updates itself without the installer.

!include "LogicLib.nsh"

!macro customInstall
  ; The matting worker is built with MSVC and imports the 2015-2022 runtime.
  SetRegView 64
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  SetRegView lastused
  ${If} $0 != 1
    ${If} ${FileExists} "$INSTDIR\vc_redist.x64.exe"
      DetailPrint "Installing the Microsoft Visual C++ runtime..."
      ExecWait '"$INSTDIR\vc_redist.x64.exe" /install /quiet /norestart' $1
      ; 0 = installed, 3010 = installed and a restart is pending,
      ; 1638 = a newer runtime is already present.
      ${If} $1 != 0
      ${AndIf} $1 != 3010
      ${AndIf} $1 != 1638
        DetailPrint "The Visual C++ runtime installer returned $1."
      ${EndIf}
    ${EndIf}
  ${EndIf}
  Delete "$INSTDIR\vc_redist.x64.exe"

  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\image\shell\SmartImageOpen" "" "用 SmartImage 打开"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\image\shell\SmartImageOpen" "Icon" "$INSTDIR\smartimage.exe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\image\shell\SmartImageOpen\command" "" '"$INSTDIR\smartimage.exe" "%1"'

  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\image\shell\SmartImageWebP" "" "转成 WebP (SmartImage)"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\image\shell\SmartImageWebP" "Icon" "$INSTDIR\smartimage.exe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\image\shell\SmartImageWebP\command" "" '"$INSTDIR\smartimage.exe" --quick webp "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\image\shell\SmartImageOpen"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\image\shell\SmartImageWebP"
!macroend
