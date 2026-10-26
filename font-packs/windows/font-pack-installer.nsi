Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64

!include "MUI2.nsh"
!include "LogicLib.nsh"

!ifndef PACK_DIRECTORY
  !error "PACK_DIRECTORY is required"
!endif
!ifndef PACK_ID
  !error "PACK_ID is required"
!endif
!ifndef PACK_VERSION
  !error "PACK_VERSION is required"
!endif
!ifndef PACK_NAME
  !error "PACK_NAME is required"
!endif
!ifndef PACK_LICENSE_FILE
  !error "PACK_LICENSE_FILE is required"
!endif
!ifndef OUTPUT_FILE
  !error "OUTPUT_FILE is required"
!endif
!ifndef FONT_PACK_ROOT
  !define FONT_PACK_ROOT "$LOCALAPPDATA\morphdoc\font-packs"
!endif
!ifndef MANAGER_ROOT
  !define MANAGER_ROOT "$LOCALAPPDATA\morphdoc\font-pack-installers"
!endif

Name "墨呈字体包 - ${PACK_NAME}"
OutFile "${OUTPUT_FILE}"
InstallDir "${MANAGER_ROOT}\${PACK_ID}"
ShowInstDetails show
ShowUninstDetails show
BrandingText "墨呈"

!ifdef ICON_FILE
  Icon "${ICON_FILE}"
  UninstallIcon "${ICON_FILE}"
  !define MUI_ICON "${ICON_FILE}"
  !define MUI_UNICON "${ICON_FILE}"
!endif

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${PACK_LICENSE_FILE}"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

VIProductVersion "1.0.0.0"
VIAddVersionKey /LANG=${LANG_SIMPCHINESE} "ProductName" "墨呈字体包"
VIAddVersionKey /LANG=${LANG_SIMPCHINESE} "FileDescription" "${PACK_NAME}"
VIAddVersionKey /LANG=${LANG_SIMPCHINESE} "FileVersion" "${PACK_VERSION}"
VIAddVersionKey /LANG=${LANG_SIMPCHINESE} "LegalCopyright" "Copyright © YIXIONG Tech.ltd"

Section "安装字体包" SEC_FONT_PACK
  SetShellVarContext current
  StrCpy $R0 "${FONT_PACK_ROOT}\.installing-${PACK_ID}"
  StrCpy $R1 "${FONT_PACK_ROOT}\${PACK_ID}"
  StrCpy $R2 "${FONT_PACK_ROOT}\.backup-${PACK_ID}"

  CreateDirectory "${FONT_PACK_ROOT}"
  RMDir /r "$R0"
  RMDir /r "$R2"
  CreateDirectory "$R0\${PACK_ID}\${PACK_VERSION}"
  SetOutPath "$R0\${PACK_ID}\${PACK_VERSION}"
  File /r "${PACK_DIRECTORY}\*.*"
  SetOutPath "$TEMP"
  IfFileExists "$R0\${PACK_ID}\${PACK_VERSION}\font-pack.json" +3 0
    RMDir /r "$R0"
    Abort "字体包暂存校验失败：缺少 font-pack.json"

  ClearErrors
  IfFileExists "$R1\*.*" 0 promote_pack
    Rename "$R1" "$R2"
    IfErrors install_failed

  promote_pack:
    ClearErrors
    Rename "$R0\${PACK_ID}" "$R1"
    IfErrors rollback_pack
    RMDir /r "$R0"
    RMDir /r "$R2"

    SetOutPath "$INSTDIR"
    WriteUninstaller "$INSTDIR\Uninstall.exe"
    FileOpen $R3 "$INSTDIR\installed-version.txt" w
    FileWrite $R3 "${PACK_VERSION}$\r$\n"
    FileClose $R3

    !ifdef REGISTER_UNINSTALL
      WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\morphdoc-font-pack-${PACK_ID}" "DisplayName" "墨呈字体包 - ${PACK_NAME}"
      WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\morphdoc-font-pack-${PACK_ID}" "DisplayVersion" "${PACK_VERSION}"
      WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\morphdoc-font-pack-${PACK_ID}" "Publisher" "YIXIONG Tech.ltd"
      WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\morphdoc-font-pack-${PACK_ID}" "InstallLocation" "$INSTDIR"
      WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\morphdoc-font-pack-${PACK_ID}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
      WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\morphdoc-font-pack-${PACK_ID}" "NoModify" 1
      WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\morphdoc-font-pack-${PACK_ID}" "NoRepair" 1
    !endif
    Goto install_done

  rollback_pack:
    RMDir /r "$R1"
    IfFileExists "$R2\*.*" 0 install_failed
      Rename "$R2" "$R1"

  install_failed:
    RMDir /r "$R0"
    Abort "字体包安装失败，原版本已保留。"

  install_done:
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  RMDir /r "${FONT_PACK_ROOT}\${PACK_ID}"
  RMDir /r "${FONT_PACK_ROOT}\.installing-${PACK_ID}"
  RMDir /r "${FONT_PACK_ROOT}\.backup-${PACK_ID}"
  !ifdef REGISTER_UNINSTALL
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\morphdoc-font-pack-${PACK_ID}"
  !endif
  Delete "$INSTDIR\installed-version.txt"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
