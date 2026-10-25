import AppKit
import WebKit
import UniformTypeIdentifiers

let appID = "local.yuezhiping.keyboard-workshop"

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var statusItem: NSStatusItem!
    let dataDirectory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/KeyboardWorkshop")
    var autosaveURL: URL { dataDirectory.appendingPathComponent("autosave.json") }
    var layoutsURL: URL { dataDirectory.appendingPathComponent("layouts.json") }
    var lastImage: CGImage?
    var recognizing = false
    var loadingImage = false
    var pasteboard = NSPasteboard.general
    var webReady = false
    var pendingImageImport: (source: ImageAnalyzer.Source, name: String)?
    lazy var github = GitHubController(window: window, directory: dataDirectory) { [weak self] name, payload in self?.send(name, payload) }

    lazy var workflows = AssistantWorkflowController(window: window, pasteboard: { [weak self] in self?.pasteboard ?? .general }) { [weak self] name, payload in self?.send(name, payload) }

    lazy var assistant = AssistantController(window: window, directory: dataDirectory) { [weak self] name, payload in self?.send(name, payload) }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let other = NSRunningApplication.runningApplications(withBundleIdentifier: appID).first(where: { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }) {
            other.activate(options: [.activateIgnoringOtherApps]); NSApp.terminate(nil); return
        }
        try? FileManager.default.createDirectory(at: dataDirectory, withIntermediateDirectories: true)
        makeMenu()
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "workshop")
        web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1380, height: 900), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "键盘工坊 · 配列编辑器"
        window.minSize = NSSize(width: 1100, height: 720)
        window.contentView = web
        window.isReleasedWhenClosed = false
        window.center()
        makeApplicationMenu()
        let root = Bundle.main.resourceURL!.appendingPathComponent("Web")
        web.loadFileURL(root.appendingPathComponent("index.html"), allowingReadAccessTo: root)
        show()
    }

    func makeApplicationMenu() {
        let menu = NSMenu()
        let item = NSMenuItem(title: "键盘工坊", action: nil, keyEquivalent: "")
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "关于键盘工坊", action: #selector(about), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出键盘工坊", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.submenu = appMenu; menu.addItem(item)
        let edit = NSMenuItem(title: "编辑", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "编辑")
        let undoItem = editMenu.addItem(withTitle: "撤销", action: #selector(undoLayout), keyEquivalent: "z"); undoItem.target = self
        let redoItem = editMenu.addItem(withTitle: "重做", action: #selector(redoLayout), keyEquivalent: "z"); redoItem.target = self; redoItem.keyEquivalentModifierMask = [.command, .shift]
        for (title, action, key) in [("剪切", "cut:", "x"), ("复制", "copy:", "c")] {
            editMenu.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        let pasteItem = editMenu.addItem(withTitle: "粘贴", action: #selector(pasteClipboard(_:)), keyEquivalent: "v"); pasteItem.target = self
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        edit.submenu = editMenu; menu.addItem(edit); NSApp.mainMenu = menu
    }

    func makeMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = NSImage(systemSymbolName: "keyboard", accessibilityDescription: "键盘工坊")
        statusItem.button?.title = "键盘工坊"
        statusItem.button?.imagePosition = .imageLeft
        let menu = NSMenu()
        menu.addItem(withTitle: "打开键盘工坊", action: #selector(show), keyEquivalent: "")
        menu.addItem(withTitle: "导入键盘截图…", action: #selector(openImage), keyEquivalent: "")
        menu.addItem(withTitle: "粘贴截图", action: #selector(pasteImage), keyEquivalent: "")
        menu.addItem(withTitle: "打开数据目录", action: #selector(showData), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "退出键盘工坊", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        for item in menu.items { item.target = self }
        statusItem.menu = menu
    }

    @objc func show() { window?.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
    @objc func undoLayout() { web.evaluateJavaScript("window.Workshop.command('undo')", completionHandler: nil) }
    @objc func redoLayout() { web.evaluateJavaScript("window.Workshop.command('redo')", completionHandler: nil) }
    @objc func showData() { NSWorkspace.shared.open(dataDirectory) }
    @objc func about() {
        let alert = NSAlert(); alert.messageText = "键盘工坊 1.6"
        alert.informativeText = "在本机识别键盘截图，校正配列并导出 KLE 和毫米单位的 DXF。支持旋转键区、自定义开孔、项目保存和 QMK / ZMK 固件仓库导出。"
        alert.runModal()
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { show(); return true }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url, !url.isFileURL && url.scheme != "about" {
            NSWorkspace.shared.open(url); decisionHandler(.cancel)
        } else { decisionHandler(.allow) }
    }
    func send(_ name: String, _ payload: Any) {
        guard let data = try? JSONSerialization.data(withJSONObject: ["event": name, "payload": payload]), let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.nativeEvent(\(json))", completionHandler: nil)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.isFileURL == true,
              let body = message.body as? [String: Any], let action = body["action"] as? String else { return }
        switch action {
        case "assistantWorkflow": workflows.handle(body)
        case "assistantWorkflowCancel": if let id = body["requestId"] as? String { workflows.cancel(id) }
        case "assistantGitHub": github.handleAssistant(body)
        case "assistantGitHubCancel": if let id = body["requestId"] as? String { github.cancelAssistant(id) }
        case "assistantState", "assistantSettings", "assistantRequest", "assistantCancel": assistant.handle(body)
        case "githubState", "githubConnect", "githubDisconnect", "githubPublish", "githubRefresh", "githubDownload", "githubOpenRun": github.handle(body)
        case "ready":
            if let data = try? Data(contentsOf: autosaveURL),
               let object = try? JSONSerialization.jsonObject(with: data) {
                if let envelope = object as? [String: Any], let project = envelope["project"] {
                    send("restore", project)
                    if let activeLayout = envelope["activeLayoutId"] { send("layoutActive", activeLayout) }
                    if let embeddedLayouts = envelope["layouts"] { send("layouts", embeddedLayouts) }
                } else { send("restore", object) }
            }
            if let data = try? Data(contentsOf: layoutsURL),
               let layouts = try? JSONSerialization.jsonObject(with: data) { send("layouts", layouts) }
            webReady = true
            if let pending = pendingImageImport {
                pendingImageImport = nil
                importImage(pending.source, name: pending.name)
            }
        case "openImage": openImage()
        case "pasteImage": pasteImage()
        case "recognize":
            if let image = decodeImage(body["data"]) { lastImage = image }
            recognize()
        case "readLabels":
            let token = body["token"] ?? NSNull()
            if !recognizing, let image = decodeImage(body["data"]) { lastImage = image }
            guard !recognizing, let regions = body["regions"] as? [[String: Any]], regions.count <= 500, let image = lastImage,
                  (body["width"] as? NSNumber)?.intValue == image.width, (body["height"] as? NSNumber)?.intValue == image.height else {
                send("labels", ["token": token, "labels": [[String: Any]](), "warning": "键帽文字未识别：截图已变化，请重新识别。"] as [String: Any]); return
            }
            readLabels(regions, in: image, token: token)
        case "openLayout": openLayout()
        case "sample":
            if let url = Bundle.main.url(forResource: "42键-TPS65.kle", withExtension: "json"),
               let data = try? Data(contentsOf: url), let text = String(data: data, encoding: .utf8) { send("layout", ["text": text, "name": "42键 · TPS65"]) }
        case "save":
            guard let content = body["content"] as? String, let name = body["name"] as? String else { return }
            let panel = NSSavePanel(); panel.nameFieldStringValue = (name as NSString).lastPathComponent
            panel.canCreateDirectories = true
            panel.beginSheetModal(for: window) { response in
                guard response == .OK, let url = panel.url else { return }
                do { try content.write(to: url, atomically: true, encoding: .utf8); self.send("saved", ["name": url.lastPathComponent]) }
                catch { self.send("error", ["message": error.localizedDescription]) }
            }
        case "saveFolder":
            guard let name = body["name"] as? String, let entries = body["files"] as? [[String: Any]] else { send("error", ["message": "固件导出数据无效。"]); return }
            let files = entries.compactMap { entry -> FirmwareExport.File? in
                guard let path = entry["path"] as? String, let content = entry["content"] as? String else { return nil }
                return FirmwareExport.File(path: path, content: content)
            }
            do {
                guard files.count == entries.count else { throw FirmwareExport.problem("固件文件数据无效。") }
                try FirmwareExport.validate(name: name, files: files)
            } catch { send("error", ["message": error.localizedDescription]); return }
            let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false
            panel.canCreateDirectories = true; panel.allowsMultipleSelection = false
            panel.message = "选择父目录，将在其中创建固件仓库“\(name)”；已有目录不会被覆盖。"
            panel.prompt = "导出仓库"
            panel.beginSheetModal(for: window) { response in
                guard response == .OK, let parent = panel.url else { return }
                do { let root = try FirmwareExport.write(parent: parent, name: name, files: files); self.send("saved", ["name": root.path]) }
                catch { self.send("error", ["message": "固件导出失败：" + error.localizedDescription]) }
            }
        case "autosave":
            if let object = body["project"] {
                let saved: Any = ["project": object, "activeLayoutId": body["activeLayoutId"] ?? NSNull()]
                guard let data = try? JSONSerialization.data(withJSONObject: saved), data.count < 25 * 1024 * 1024 else { return }
                do { try data.write(to: autosaveURL, options: .atomic) }
                catch { send("error", ["message": "自动保存失败：" + error.localizedDescription]) }
            }
            if let layouts = body["layouts"], let data = try? JSONSerialization.data(withJSONObject: layouts), data.count < 24 * 1024 * 1024 {
                do { try data.write(to: layoutsURL, options: .atomic) }
                catch { send("notice", ["message": "配列历史保存失败：" + error.localizedDescription, "error": true] as [String: Any]) }
            }
        default: break
        }
    }
    @objc func openImage() {
        show()
        guard !recognizing && !loadingImage else { return }
        let panel = NSOpenPanel(); panel.allowedContentTypes = [.image]; panel.allowsMultipleSelection = false
        panel.beginSheetModal(for: window) { response in
            guard response == .OK, let url = panel.url else { return }
            self.importImage(.file(url), name: url.deletingPathExtension().lastPathComponent)
        }
    }
    @objc func pasteClipboard(_ sender: Any?) {
        // The native Edit menu receives ⌘V before the webpage paste event.
        // In the assistant input, image paste must create a draft, not replace the project.
        if webReady, window?.attachedSheet == nil,
           let responder = window?.firstResponder as? NSView, responder.isDescendant(of: web),
           (try? ImageAnalyzer.clipboardSource(pasteboard)) != nil {
            web.evaluateJavaScript("window.WorkshopAssistant?.pasteClipboardImage?.() === true") { [weak self] value, _ in
                guard let self else { return }
                if value as? Bool == true { return }
                if !self.pasteImageIfAvailable(reportMissing: false) { self.pasteText(sender) }
            }
            return
        }
        if window?.attachedSheet == nil && pasteImageIfAvailable(reportMissing: false) { return }
        pasteText(sender)
    }
    func pasteText(_ sender: Any?) {
        let paste = #selector(NSText.paste(_:))
        if !NSApp.sendAction(paste, to: nil, from: sender), let responder = window?.firstResponder {
            _ = NSApp.sendAction(paste, to: responder, from: sender)
        }
    }
    @objc func pasteImage() {
        show()
        _ = pasteImageIfAvailable(reportMissing: true)
    }
    @discardableResult
    func pasteImageIfAvailable(reportMissing: Bool) -> Bool {
        do {
            guard let source = try ImageAnalyzer.clipboardSource(pasteboard) else {
                if reportMissing { send("notice", ["message": "剪贴板里没有图片。请先复制截图，或按 Control + Shift + Command + 4 截取到剪贴板。", "error": true] as [String: Any]) }
                return false
            }
            let name: String
            if case .file(let url) = source { name = url.deletingPathExtension().lastPathComponent }
            else {
                let formatter = DateFormatter(); formatter.dateFormat = "yyyy-MM-dd HH-mm-ss"
                name = "粘贴截图 " + formatter.string(from: Date())
            }
            importImage(source, name: name)
            return true
        } catch {
            send("notice", ["message": error.localizedDescription, "error": true] as [String: Any])
            return true
        }
    }
    func importImage(_ source: ImageAnalyzer.Source, name: String) {
        guard !recognizing && !loadingImage else { return }
        guard webReady else { pendingImageImport = (source, name); return }
        show()
        loadingImage = true
        send("busy", ["message": "正在读取截图…"])
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let (image, png) = try ImageAnalyzer.load(source)
                DispatchQueue.main.async {
                    self.loadingImage = false
                    self.lastImage = image
                    let payload: [String: Any] = ["name": name, "data": "data:image/png;base64," + png.base64EncodedString(), "width": image.width, "height": image.height]
                    self.send("image", payload)
                    self.recognize()
                }
            } catch { DispatchQueue.main.async { self.loadingImage = false; self.send("error", ["message": error.localizedDescription]) } }
        }
    }
    func recognize() {
        guard !recognizing else { return }
        guard let image = lastImage else { send("recognition", ["rectangles": [[String: Any]](), "words": [[String: Any]]()]); return }
        recognizing = true
        send("busy", ["message": "正在本机识别键帽轮廓和文字…"])
        DispatchQueue.global(qos: .userInitiated).async {
            do { let result = try ImageAnalyzer.analyze(image); DispatchQueue.main.async { self.recognizing = false; self.send("recognition", result) } }
            catch { DispatchQueue.main.async {
                self.recognizing = false
                let payload: [String: Any] = ["rectangles": [[String: Any]](), "words": [[String: Any]](), "warning": "系统识别未完成，将使用本地图像识别：" + error.localizedDescription]
                self.send("recognition", payload)
            } }
        }
    }
    func decodeImage(_ value: Any?) -> CGImage? {
        guard let dataURL = value as? String, let comma = dataURL.firstIndex(of: ","),
              let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])),
              let bitmap = NSBitmapImageRep(data: data) else { return nil }
        return bitmap.cgImage
    }
    func readLabels(_ regions: [[String: Any]], in image: CGImage, token: Any) {
        recognizing = true
        DispatchQueue.global(qos: .userInitiated).async {
            let labels = ImageAnalyzer.readLabels(image, regions: regions) { done in
                DispatchQueue.main.async { self.send("busy", ["message": "正在识别键帽文字 \(done) / \(regions.count)…"]) }
            }
            DispatchQueue.main.async { self.recognizing = false; self.send("labels", ["token": token, "labels": labels]) }
        }
    }
    func openLayout() {
        let panel = NSOpenPanel(); panel.allowedContentTypes = [.json, .plainText]; panel.allowsMultipleSelection = false
        panel.beginSheetModal(for: window) { response in
            guard response == .OK, let url = panel.url else { return }
            do {
                let data = try Data(contentsOf: url)
                guard data.count < 25 * 1024 * 1024, let text = String(data: data, encoding: .utf8) else { throw ImageAnalyzer.problem("文件过大或不是 UTF-8 文本。") }
                self.lastImage = nil
                self.send("layout", ["text": text, "name": url.deletingPathExtension().lastPathComponent])
            } catch { self.send("error", ["message": error.localizedDescription]) }
        }
    }
}

#if !WORKSHOP_TESTING
@main
enum Main {
    static func main() throws {
        if CommandLine.arguments.count > 2, CommandLine.arguments[1] == "--analyze" {
            let (image, _) = try ImageAnalyzer.load(URL(fileURLWithPath: CommandLine.arguments[2]))
            let result = try ImageAnalyzer.analyze(image)
            let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
            print(String(data: data, encoding: .utf8)!); return
        }
        let application = NSApplication.shared
        let delegate = AppDelegate(); application.delegate = delegate
        application.setActivationPolicy(.regular); application.run()
    }
}
#endif
