; SmartImage installer hooks for `mygo build` (windows.installerInclude).
; Adds image-file context menu entries and installs the Visual C++ runtime
; the matting worker needs. Everything stays in HKCU / $INSTDIR: the
; installer is per-user and the app updates itself without the installer.

!include "LogicLib.nsh"

!macro updateContextMenu ACTION
  ClearErrors
  ExecWait '"$INSTDIR\SmartImage.exe" ${ACTION}' $0
  ${If} ${Errors}
    DetailPrint "Could not run SmartImage to update the image context menu."
  ${ElseIf} $0 != 0
    DetailPrint "SmartImage could not update the image context menu (exit code $0)."
  ${EndIf}
!macroend

Function un.RemoveLegacyContextMenu
  StrCpy $0 0
  ${Do}
    EnumRegKey $1 HKCU "Software\Classes\SystemFileAssociations" $0
    ${If} $1 == ""
      ${ExitDo}
    ${EndIf}
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\$1\shell\SmartImageOpen"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\$1\shell\SmartImageWebP"
    IntOp $0 $0 + 1
  ${Loop}
FunctionEnd

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

  !insertmacro updateContextMenu "--register-context-menu"
!macroend

!macro customUnInstall
  ClearErrors
  ExecWait '"$INSTDIR\SmartImage.exe" --unregister-context-menu' $0
  ${If} ${Errors}
  ${OrIf} $0 != 0
    Call un.RemoveLegacyContextMenu
  ${EndIf}
!macroend
