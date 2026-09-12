import AppKit
import WebKit
import Foundation

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var process: Process?
    var lifetimePipe: Pipe?
    var logHandle: FileHandle?
    var poll: Timer?
    var stopping = false
    var ready = false
    var startedAt = Date()
    var baseURL: URL!
    var dataURL: URL!
    let files = FileManager.default

    func applicationDidFinishLaunching(_ notification: Notification) {
        let other = NSRunningApplication.runningApplications(withBundleIdentifier: Bundle.main.bundleIdentifier ?? "org.signaldesk.desktop").first { $0.processIdentifier != getpid() }
        if let other { other.activate(options: [.activateAllWindows]); NSApp.terminate(nil); return }
        let menu = NSMenu()
        let appItem = NSMenuItem(); menu.addItem(appItem)
        let appMenu = NSMenu(); appItem.submenu = appMenu
        appMenu.addItem(withTitle: "About Signaldesk", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Signaldesk", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let edit = NSMenuItem(); menu.addItem(edit); edit.submenu = NSMenu(title: "Edit")
        for (title, action, key) in [("Undo", "undo:", "z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            edit.submenu?.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        let view = NSMenuItem(); menu.addItem(view); view.submenu = NSMenu(title: "View")
        let reload = view.submenu!.addItem(withTitle: "Reload", action: #selector(reloadPage), keyEquivalent: "r"); reload.target = self
        NSApp.mainMenu = menu
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Signaldesk"; window.minSize = NSSize(width: 760, height: 540)
        window.isReleasedWhenClosed = false; window.delegate = self; window.center()
        webView = WKWebView(frame: window.contentView!.bounds)
        webView.autoresizingMask = [.width, .height]; webView.navigationDelegate = self; webView.uiDelegate = self
        window.contentView = webView; window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        showStatus("Starting Signaldesk", detail: "Preparing your workspace…")
        do { try startServer() } catch { fail(error.localizedDescription) }
    }

    func showStatus(_ title: String, detail: String) {
        webView.loadHTMLString("<html><body style='font:16px -apple-system;text-align:center;padding-top:22vh;color:#263650;background:#f7f9fc'><h1>\(title)</h1><p>\(detail)</p></body></html>", baseURL: nil)
    }
    func startServer() throws {
        let env = ProcessInfo.processInfo.environment
        let resources = Bundle.main.resourceURL!
        let config = NSDictionary(contentsOf: resources.appendingPathComponent("Launcher.plist"))!
        let support = files.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Signaldesk", isDirectory: true)
        dataURL = env["SIGNALDESK_DATA_DIR"].map { URL(fileURLWithPath: $0, isDirectory: true) } ?? support.appendingPathComponent("data", isDirectory: true)
        let configURL = dataURL.deletingLastPathComponent().appendingPathComponent("config.env")
        try files.createDirectory(at: dataURL.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        if !files.fileExists(atPath: dataURL.path), env["SIGNALDESK_DATA_DIR"] == nil {
            let source = URL(fileURLWithPath: config["SourceProject"] as! String)
            let sourceData = source.appendingPathComponent("data")
            if ownsLiveLock(sourceData) {
                killExistingProcess(in: sourceData)
            }
            if files.fileExists(atPath: sourceData.appendingPathComponent("state.json").path) {
                // Publish migration only after every required file was copied successfully.
                let staging = support.appendingPathComponent("migration-\(UUID().uuidString)")
                try files.createDirectory(at: staging, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
                defer { try? files.removeItem(at: staging) }
                for name in ["state.json", "state.json.bak", ".key", "x-session.json"] {
                    let from = sourceData.appendingPathComponent(name)
                    if files.fileExists(atPath: from.path) { try files.copyItem(at: from, to: staging.appendingPathComponent(name)) }
                }
                if files.fileExists(atPath: source.appendingPathComponent(".env").path), !files.fileExists(atPath: configURL.path) {
                    try files.copyItem(at: source.appendingPathComponent(".env"), to: configURL)
                    try files.setAttributes([.posixPermissions: 0o600], ofItemAtPath: configURL.path)
                }
                if files.fileExists(atPath: dataURL.path) { try files.removeItem(at: dataURL) }
                try files.moveItem(at: staging, to: dataURL)
            }
        }
        if ownsLiveLock(dataURL) {
            killExistingProcess(in: dataURL)
        }
        try files.createDirectory(at: dataURL, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let port = env["SIGNALDESK_PORT"] ?? "4318"
        guard let number = Int(port), (1024...65535).contains(number) else { throw startupError("The app port is invalid.") }
        baseURL = URL(string: "http://127.0.0.1:\(port)")!
        let logURL = dataURL.deletingLastPathComponent().appendingPathComponent("desktop.log")
        if files.fileExists(atPath: logURL.path) { try? files.removeItem(at: logURL) }
        files.createFile(atPath: logURL.path, contents: nil, attributes: [.posixPermissions: 0o600])
        logHandle = try FileHandle(forWritingTo: logURL)
        let child = Process()
        child.executableURL = resources.appendingPathComponent("node")
        child.currentDirectoryURL = resources.appendingPathComponent("runtime")
        child.arguments = ["--import", "tsx", "server/index.ts"]
        var childEnv = env
        childEnv["DATA_DIR"] = dataURL.path; childEnv["PORT"] = port
        childEnv["DOTENV_CONFIG_PATH"] = configURL.path
        childEnv["NODE_ENV"] = "production"
        childEnv["SIGNALDESK_DESKTOP"] = "1"
        childEnv["PATH"] = "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        child.environment = childEnv; child.standardOutput = logHandle; child.standardError = logHandle
        child.terminationHandler = { [weak self] _ in DispatchQueue.main.async { self?.serverEnded() } }
        lifetimePipe = Pipe(); child.standardInput = lifetimePipe!
        process = child
        try child.run()
        startedAt = Date()
        poll = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in self?.checkReady() }
    }
    func killExistingProcess(in directory: URL) {
        let lockURL = directory.appendingPathComponent("process.lock")
        guard let raw = try? String(contentsOf: lockURL, encoding: .utf8),
              let pid = Int32(raw.trimmingCharacters(in: .whitespacesAndNewlines)),
              pid > 1 else { return }
        if kill(pid, 0) == 0 {
            kill(pid, SIGTERM)
            for _ in 0..<20 {
                if kill(pid, 0) != 0 { break }
                Thread.sleep(forTimeInterval: 0.1)
            }
            if kill(pid, 0) == 0 {
                kill(pid, SIGKILL)
                Thread.sleep(forTimeInterval: 0.1)
            }
        }
        try? files.removeItem(at: lockURL)
    }
    func ownsLiveLock(_ directory: URL) -> Bool {
        guard let raw = try? String(contentsOf: directory.appendingPathComponent("process.lock"), encoding: .utf8), let pid = Int32(raw.trimmingCharacters(in: .whitespacesAndNewlines)), pid > 1 else { return false }
        return kill(pid, 0) == 0 || errno == EPERM
    }
    func startupError(_ text: String) -> NSError { NSError(domain: "Signaldesk", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }
    func checkReady() {
        guard !stopping, !ready, let child = process, child.isRunning else { return }
        if Date().timeIntervalSince(startedAt) > 40 { poll?.invalidate(); fail("The server took too long to start. See desktop.log in the Signaldesk Application Support folder."); return }
        // Do not attach to an unrelated listener that happens to occupy our port.
        guard let lock = try? String(contentsOf: dataURL.appendingPathComponent("process.lock"), encoding: .utf8), lock == String(child.processIdentifier) else { return }
        var req = URLRequest(url: baseURL.appendingPathComponent("api/health")); req.timeoutInterval = 1
        URLSession.shared.dataTask(with: req) { [weak self] data, response, _ in
            guard (response as? HTTPURLResponse)?.statusCode == 200, let data,
                  let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any], body["ok"] as? Bool == true, body["pid"] as? Int32 == child.processIdentifier else { return }
            DispatchQueue.main.async {
                guard let self, !self.stopping, !self.ready, self.process?.isRunning == true else { return }
                self.ready = true; self.poll?.invalidate(); self.webView.load(URLRequest(url: self.baseURL))
            }
        }.resume()
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Build verification uses an isolated workspace and closes through the same
        // red-window-button path as the installed app. It never touches live data.
        guard ready, webView.url?.host == "127.0.0.1", let output = ProcessInfo.processInfo.environment["SIGNALDESK_SMOKE_DIR"] else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
            guard let self, !self.stopping else { return }
            self.webView.takeSnapshot(with: nil) { image, _ in
                if let image, let tiff = image.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
                    try? png.write(to: URL(fileURLWithPath: output).appendingPathComponent("desktop.png"))
                }
                self.window.performClose(nil)
            }
        }
    }
    func fail(_ message: String) {
        poll?.invalidate()
        let alert = NSAlert(); alert.messageText = "Signaldesk couldn’t start"; alert.informativeText = message
        alert.addButton(withTitle: "Quit"); alert.runModal(); NSApp.terminate(nil)
    }
    func serverEnded() {
        poll?.invalidate(); try? logHandle?.close()
        if stopping { NSApp.reply(toApplicationShouldTerminate: true) }
        else { fail("The server stopped. Another app may be using port \(baseURL?.port ?? 4318). See desktop.log in the Signaldesk Application Support folder for details.") }
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let child = process, child.isRunning else { return .terminateNow }
        if stopping { return .terminateCancel }
        stopping = true; poll?.invalidate()
        showStatus("Closing Signaldesk", detail: "Stopping automation and saving your workspace…")
        child.terminate()
        // A stalled network request must not leave a hidden server running forever.
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
            guard let self, let child = self.process, child.isRunning else { return }
            kill(child.processIdentifier, SIGKILL)
        }
        return .terminateLater
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool { NSApp.terminate(nil); return false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { window?.makeKeyAndOrderFront(nil); return true }
    @objc func reloadPage() { if ready { webView.reload() } }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "about" { decisionHandler(.allow); return }
        if navigationAction.shouldPerformDownload || url.scheme == "blob" { decisionHandler(.download); return }
        if url.host == "127.0.0.1", url.port == baseURL?.port { decisionHandler(.allow); return }
        if ["https", "http"].contains(url.scheme ?? ""), navigationAction.navigationType == .linkActivated { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel(); panel.allowsMultipleSelection = parameters.allowsMultipleSelection; panel.canChooseDirectories = false
        panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) }
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel(); panel.nameFieldStringValue = suggestedFilename
        panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.url : nil) }
    }
}
let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
