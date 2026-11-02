; Aoid installer script (Inno Setup 7)
;
; Why Inno Setup 7 instead of 6:
;   Inno 6 has no dark wizard support at all. Inno 7 added
;   WizardBackColor / WizardBackColorDynamicDark and the "stellar"
;   custom wizard style, which lets the whole installer follow a
;   dark palette matching the app.
;
; Note: Inno preprocessor directives reject non-ASCII identifiers,
; so all identifiers and comments here are English.

#define AppName "Aoid"
#define AppVersion "1.0.0"
#define AppPublisher "l-xyzz"
#define AppURL "https://github.com/l-xyzz/Aoid"
#define SrcDir "C:\Users\16517\AppData\Local\AoidBuild\release\win-unpacked"
#define LicenseFile "C:\Users\16517\AppData\Local\AoidBuild\LICENSE"

[Setup]
AppId={{8F3C2A1B-7D4E-4A9F-B6C8-1E5D3F7A2B4C}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}/issues
AppUpdatesURL={#AppURL}/releases
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
LicenseFile={#LicenseFile}
OutputDir=C:\Users\16517\AppData\Local\AoidBuild\release
OutputBaseFilename=Aoid-{#AppVersion}-Setup
Compression=lzma2/max
SolidCompression=yes

; ---- Dark wizard ----
; Force the built-in dark style for the whole wizard, controls included,
; so the licence RichEdit no longer renders light-blue on a dark page.
; hidebevels removes separator lines that look odd on a dark palette.
; "dynamic" follows the Windows theme: light wizard on a light system,
; dark wizard on a dark system. No custom background colours, so the
; stock Inno 7 palette is used in both modes.
WizardStyle=modern dynamic
; Match the app palette: #0B0D10 background, #F5A524 accent

PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
UninstallDisplayName={#AppName} {#AppVersion}
UninstallDisplayIcon={app}\Aoid.exe
CreateUninstallRegKey=yes
CloseApplications=force
RestartApplications=no
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
DisableProgramGroupPage=yes
AllowNoIcons=yes
; Keep the UI language as the system language, never fall back to English
ShowLanguageDialog=auto

[Languages]
; LanguageID makes Inno match these against the OS language reliably;
; without it the wizard may default to English on a zh-CN system.
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

; 旧版残留清理
; 之前的 NSIS 版会留下 "Uninstall Aoid.exe"，与 Inno 的 unins000.exe 不是同一个，
; 两个并存会让控制面板出现两条卸载记录。安装时顺手删掉旧的那份。
[InstallDelete]
Type: files; Name: "{app}\Uninstall Aoid.exe"

[Files]
Source: "{#SrcDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\Aoid.exe"
Name: "{group}\{cm:UninstallProgram,{#AppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\Aoid.exe"; Tasks: desktopicon

[Code]
{ ------------------------------------------------------------------ }
{ Kill Aoid before uninstall.                                        }
{                                                                    }
{ CloseApplications=force only covers the install phase; uninstall   }
{ never closes the app by itself, so busy files cannot be removed    }
{ and a pile of leftovers stays behind.                              }
{                                                                    }
{ Note: Pascal identifiers must be ASCII here.                       }
{ ------------------------------------------------------------------ }
procedure KillApp(const ImageName: String);
var
  R: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /T /IM "' + ImageName + '"',
       '', SW_HIDE, ewWaitUntilTerminated, R);
end;

{ Recursively remove a directory tree, ignoring errors. }
procedure RemoveTree(const Dir: String);
var
  FindRec: TFindRec;
begin
  if not DirExists(Dir) then Exit;
  if FindFirst(AddBackslash(Dir) + '*', FindRec) then
  begin
    try
      repeat
        if (FindRec.Name <> '.') and (FindRec.Name <> '..') then
        begin
          if FindRec.Attributes and FILE_ATTRIBUTE_DIRECTORY <> 0 then
            RemoveTree(AddBackslash(Dir) + FindRec.Name)
          else
            DeleteFile(AddBackslash(Dir) + FindRec.Name);
        end;
      until not FindNext(FindRec);
    finally
      FindClose(FindRec);
    end;
  end;
  RemoveDir(Dir);
end;

{ Gracefully shut down the adb server that Aoid started.

  Using "adb kill-server" rather than taskkill: it stops the server cleanly
  so the on-disk adb.exe handle is released, and it never touches an adb
  server owned by another tool. If Aoid's bundled adb is gone already we
  simply skip this step. }
procedure StopOurAdbServer();
var
  R: Integer;
  AdbPath: String;
begin
  AdbPath := ExpandConstant('{localappdata}\Aoid\PhoneDeck\platform-tools\adb.exe');
  if not FileExists(AdbPath) then
    AdbPath := ExpandConstant('{app}\resources\platform-tools\adb.exe');
  if FileExists(AdbPath) then
  begin
    Exec(AdbPath, 'kill-server', '', SW_HIDE, ewWaitUntilTerminated, R);
  end;
end;
function CleanUserData(): Boolean;
begin
  RemoveTree(ExpandConstant('{localappdata}\Aoid'));
  RemoveTree(ExpandConstant('{userappdata}\Aoid'));
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
  begin
    { Aoid.exe is the Electron shell and it spawns adb.exe, which keeps a
      handle on the adb.exe under %LOCALAPPDATA%\Aoid. Kill Aoid first, wait
      for it to release, then let adb exit on its own -- killing adb.exe
      globally would also kill adb servers owned by other tools (and those
      need admin rights, which this installer does not request). }
    KillApp('Aoid.exe');
    Sleep(2000);
    KillApp('Aoid.exe');
    Sleep(1000);

    { Stop only the adb server that belongs to us, via graceful shutdown.
      This leaves other applications' adb servers untouched. }
    StopOurAdbServer();
    Sleep(800);
  end;
  { usPostUninstall runs after Inno has removed its own files, so anything
    left behind here is ours to clear: the dev-mirror copy under
    %LOCALAPPDATA%\Aoid (adb/scrcpy-runtime, ~16 MB) and the settings folder. }
  if CurUninstallStep = usPostUninstall then
  begin
    CleanUserData();
  end;
end;
[UninstallDelete]
; Inno only removes files it installed itself. Everything below is
; generated at runtime, so it has to be listed explicitly.
Type: filesandordirs; Name: "{app}"
Type: filesandordirs; Name: "{userappdata}\Aoid"
; %LOCALAPPDATA%\Aoid holds the dev-mirror copy (adb + scrcpy-runtime, ~16 MB).
; Delete the nested PhoneDeck dir too: an older launch.mjs left its files there
; and a plain parent delete can leave them behind while handles settle.
Type: filesandordirs; Name: "{localappdata}\Aoid\PhoneDeck"
Type: filesandordirs; Name: "{localappdata}\Aoid"
Type: filesandordirs; Name: "{group}"

[Run]
Filename: "{app}\Aoid.exe"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent