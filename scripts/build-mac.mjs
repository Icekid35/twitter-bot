import {cpSync, mkdirSync, writeFileSync, rmSync, mkdtempSync, readFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
if(process.platform !== 'darwin') throw new Error('Build the Mac app on macOS with Xcode command-line tools installed.');
const root=process.cwd(), app=path.join(root,'release','Signaldesk.app');
const temp=mkdtempSync(path.join(os.tmpdir(),'signaldesk-build-'));
const run=(command,args)=>execFileSync(command,args,{stdio:'inherit'});
const xml=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
try {
  run('npm',['run','build']);
  rmSync(app,{recursive:true,force:true});
  const contents=path.join(app,'Contents'), resources=path.join(contents,'Resources'), runtime=path.join(resources,'runtime');
  mkdirSync(path.join(contents,'MacOS'),{recursive:true}); mkdirSync(runtime,{recursive:true});
  run('xcrun',['swiftc','-swift-version','5','-O','-framework','AppKit','-framework','WebKit','macos/Signaldesk.swift','-o',path.join(contents,'MacOS','Signaldesk')]);
  for(const name of ['server','shared','dist','node_modules','package.json']) cpSync(path.join(root,name),path.join(runtime,name),{recursive:true,verbatimSymlinks:true});
  cpSync(process.execPath,path.join(resources,'node'));
  writeFileSync(path.join(resources,'Launcher.plist'),`<?xml version="1.0"?><plist version="1.0"><dict><key>SourceProject</key><string>${xml(root)}</string></dict></plist>`);
  writeFileSync(path.join(contents,'Info.plist'),`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>CFBundleName</key><string>Signaldesk</string><key>CFBundleDisplayName</key><string>Signaldesk</string>
<key>CFBundleIdentifier</key><string>org.signaldesk.desktop</string><key>CFBundleVersion</key><string>1</string><key>CFBundleShortVersionString</key><string>1.0.0</string>
<key>CFBundleExecutable</key><string>Signaldesk</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleIconFile</key><string>Signaldesk</string>
<key>NSHighResolutionCapable</key><true/><key>NSSupportsAutomaticTermination</key><false/><key>LSMultipleInstancesProhibited</key><true/>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
<key>NSHumanReadableCopyright</key><string>Signaldesk · Local automation workspace</string>
</dict></plist>`);
  const png=path.join(temp,'icon.png'),iconset=path.join(temp,'Signaldesk.iconset');mkdirSync(iconset);
  run('xcrun',['swift','macos/Icon.swift',png]);
  for(const size of [16,32,128,256,512]) for(const scale of [1,2]) run('sips',['-z',String(size*scale),String(size*scale),png,'--out',path.join(iconset,`icon_${size}x${size}${scale===2?'@2x':''}.png`)]);
  try {
    run('iconutil',['-c','icns',iconset,'-o',path.join(resources,'Signaldesk.icns')]);
  } catch (err) {
    console.warn('Warning: iconutil failed, continuing build without custom icns:', err.message);
  }
  run('codesign',['--force','--deep','--sign','-',app]);
  run('codesign',['--verify','--deep','--strict',app]);
  console.log(`\nMac app built: ${app}\nNo workspace data or credentials are embedded in the app.`);
} finally {rmSync(temp,{recursive:true,force:true});}
