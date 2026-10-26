!define MORPHDOC_DISPLAY_NAME "墨呈"
!define MORPHDOC_EXECUTABLE "MorphDoc.exe"
!define MORPHDOC_LEGACY_DISPLAY_NAME "Markdown PDF 导出器"
!define MORPHDOC_LEGACY_EXECUTABLE "md-to-pdf.exe"
!define MORPHDOC_LEGACY_INSTALL_REGISTRY_KEY "Software\${APP_GUID}"

; 保持 APP_GUID 与卸载身份不变，但不再沿用旧产品名对应的安装目录。
; electron-builder 会从 INSTALL_REGISTRY_KEY 读取历史 InstallLocation；使用
; 独立键可让 v0.6.0 默认进入 MorphDoc 目录，同时仍由相同卸载身份识别旧版。
!define INSTALL_REGISTRY_KEY "Software\${APP_GUID}.MorphDoc"

!macro customInstall
  DeleteRegKey SHCTX "${MORPHDOC_LEGACY_INSTALL_REGISTRY_KEY}"
  WriteRegStr SHCTX \
    "Software\Classes\MarkdownPdfExporter.Markdown" \
    "" \
    "Markdown 文档"
  WriteRegStr SHCTX \
    "Software\Classes\MarkdownPdfExporter.Markdown\DefaultIcon" \
    "" \
    '"$INSTDIR\${MORPHDOC_EXECUTABLE}",0'
  WriteRegStr SHCTX \
    "Software\Classes\MarkdownPdfExporter.Markdown\shell\open\command" \
    "" \
    '"$INSTDIR\${MORPHDOC_EXECUTABLE}" "%1"'
  WriteRegStr SHCTX \
    "Software\Classes\.md\OpenWithProgids" \
    "MarkdownPdfExporter.Markdown" \
    ""
  WriteRegStr SHCTX \
    "Software\Classes\.markdown\OpenWithProgids" \
    "MarkdownPdfExporter.Markdown" \
    ""
  WriteRegStr SHCTX \
    "Software\Classes\Applications\${MORPHDOC_EXECUTABLE}\shell\open\command" \
    "" \
    '"$INSTDIR\${MORPHDOC_EXECUTABLE}" "%1"'
  WriteRegStr SHCTX \
    "Software\Classes\Applications\${MORPHDOC_EXECUTABLE}\SupportedTypes" \
    ".md" \
    ""
  WriteRegStr SHCTX \
    "Software\Classes\Applications\${MORPHDOC_EXECUTABLE}\SupportedTypes" \
    ".markdown" \
    ""
  DeleteRegKey SHCTX \
    "Software\Classes\Applications\${MORPHDOC_LEGACY_EXECUTABLE}"
  Delete "$SMPROGRAMS\${MORPHDOC_LEGACY_DISPLAY_NAME}\${MORPHDOC_LEGACY_DISPLAY_NAME}.lnk"
  RMDir "$SMPROGRAMS\${MORPHDOC_LEGACY_DISPLAY_NAME}"
  Delete "$DESKTOP\${MORPHDOC_LEGACY_DISPLAY_NAME}.lnk"
  CreateDirectory "$SMPROGRAMS\${MORPHDOC_DISPLAY_NAME}"
  CreateShortCut \
    "$SMPROGRAMS\${MORPHDOC_DISPLAY_NAME}\${MORPHDOC_DISPLAY_NAME}.lnk" \
    "$INSTDIR\${MORPHDOC_EXECUTABLE}" \
    "" \
    "$INSTDIR\${MORPHDOC_EXECUTABLE}"
  CreateShortCut \
    "$DESKTOP\${MORPHDOC_DISPLAY_NAME}.lnk" \
    "$INSTDIR\${MORPHDOC_EXECUTABLE}" \
    "" \
    "$INSTDIR\${MORPHDOC_EXECUTABLE}"
  StrCpy $launchLink "$INSTDIR\${MORPHDOC_EXECUTABLE}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "${MORPHDOC_LEGACY_INSTALL_REGISTRY_KEY}"
  DeleteRegValue SHCTX \
    "Software\Classes\.md\OpenWithProgids" \
    "MarkdownPdfExporter.Markdown"
  DeleteRegValue SHCTX \
    "Software\Classes\.markdown\OpenWithProgids" \
    "MarkdownPdfExporter.Markdown"
  DeleteRegKey SHCTX \
    "Software\Classes\Applications\${MORPHDOC_EXECUTABLE}"
  DeleteRegKey SHCTX \
    "Software\Classes\Applications\${MORPHDOC_LEGACY_EXECUTABLE}"
  DeleteRegKey SHCTX \
    "Software\Classes\MarkdownPdfExporter.Markdown"
  Delete "$SMPROGRAMS\${MORPHDOC_DISPLAY_NAME}\${MORPHDOC_DISPLAY_NAME}.lnk"
  RMDir "$SMPROGRAMS\${MORPHDOC_DISPLAY_NAME}"
  Delete "$DESKTOP\${MORPHDOC_DISPLAY_NAME}.lnk"
  Delete "$SMPROGRAMS\${MORPHDOC_LEGACY_DISPLAY_NAME}\${MORPHDOC_LEGACY_DISPLAY_NAME}.lnk"
  RMDir "$SMPROGRAMS\${MORPHDOC_LEGACY_DISPLAY_NAME}"
  Delete "$DESKTOP\${MORPHDOC_LEGACY_DISPLAY_NAME}.lnk"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
