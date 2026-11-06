; SmartImage installer hooks for `mygo build` (windows.installerInclude).
; Adds image-file context menu entries and installs the Visual C++ runtime
; the matting worker needs. Everything stays in HKCU / $INSTDIR: the
; installer is per-user and the app updates itself without the installer.

!include "LogicLib.nsh"

; The verbs are registered on the perceived image type and on every supported
; extension. Explorer keeps only verbs that each selected file's class offers,
; so the extension classes are what make a mixed selection (a PNG next to a
; WebP) show the entries.
!macro ctxVerb CLASS VERB LABEL ARGS
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${CLASS}\shell\${VERB}" "" "${LABEL}"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${CLASS}\shell\${VERB}" "Icon" "$INSTDIR\smartimage.exe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${CLASS}\shell\${VERB}\command" "" '"$INSTDIR\smartimage.exe" ${ARGS} "%1"'
!macroend

!macro ctxClass CLASS
  !insertmacro ctxVerb "${CLASS}" SmartImageOpen "用 SmartImage 打开" ""
  !insertmacro ctxVerb "${CLASS}" SmartImageWebP "转成 WebP (SmartImage)" "--quick webp"
!macroend

!macro ctxClassRemove CLASS
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\${CLASS}\shell\SmartImageOpen"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\${CLASS}\shell\SmartImageWebP"
!macroend

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

  !insertmacro ctxClass image
  !insertmacro ctxClass .png
  !insertmacro ctxClass .jpg
  !insertmacro ctxClass .jpeg
  !insertmacro ctxClass .jfif
  !insertmacro ctxClass .webp
  !insertmacro ctxClass .avif
  !insertmacro ctxClass .gif
  !insertmacro ctxClass .bmp
  !insertmacro ctxClass .tif
  !insertmacro ctxClass .tiff
!macroend

!macro customUnInstall
  !insertmacro ctxClassRemove image
  !insertmacro ctxClassRemove .png
  !insertmacro ctxClassRemove .jpg
  !insertmacro ctxClassRemove .jpeg
  !insertmacro ctxClassRemove .jfif
  !insertmacro ctxClassRemove .webp
  !insertmacro ctxClassRemove .avif
  !insertmacro ctxClassRemove .gif
  !insertmacro ctxClassRemove .bmp
  !insertmacro ctxClassRemove .tif
  !insertmacro ctxClassRemove .tiff
!macroend
