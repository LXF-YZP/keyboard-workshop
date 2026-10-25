import AppKit
import WebKit

// 独立 WebView：所有原生消息在此截获，绝不连接真实 App 的自动保存处理器。
final class FirmwareSmoke: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    var web: WKWebView!
    var window: NSWindow!
    var exports = [[String: Any]]()
    var saves = [[String: Any]]()
    var autosaves = 0
    func applicationDidFinishLaunching(_ note: Notification) {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.add(self, name: "workshop")
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1380, height: 900), configuration: config)
        web.navigationDelegate = self
        window = NSWindow(contentRect: web.frame, styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.title = "键盘工坊 · 独立固件测试"
        window.contentView = web
        window.orderFront(nil)
        let root = URL(fileURLWithPath: CommandLine.arguments[1])
        web.loadFileURL(root.appendingPathComponent("index.html"), allowingReadAccessTo: root)
        DispatchQueue.main.asyncAfter(deadline: .now() + 55) { print("FAIL: timeout"); exit(1) }
    }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        if body["action"] as? String == "saveFolder" { exports.append(body) }
        if body["action"] as? String == "save" { saves.append(body) }
        if body["action"] as? String == "autosave" { autosaves += 1 }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let root = URL(fileURLWithPath: CommandLine.arguments[1]).deletingLastPathComponent()
        do {
            let script = try String(contentsOf: root.appendingPathComponent("Tests/native-firmware-smoke.js"), encoding: .utf8)
            let sample = try String(contentsOf: root.appendingPathComponent("示例/42键-TPS65.kle.json"), encoding: .utf8)
            web.callAsyncJavaScript(script, arguments: ["sample": sample], in: nil, in: .page) { result in
                switch result {
                case .success(let data):
                    do {
                        guard self.exports.count == 4, self.saves.count == 1, self.autosaves > 0 else { throw FirmwareExport.problem("missing intercepted messages") }
                        let parent = FileManager.default.temporaryDirectory.appendingPathComponent("workshop-native-firmware-" + UUID().uuidString)
                        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
                        defer { try? FileManager.default.removeItem(at: parent) }
                        for (index, body) in self.exports.enumerated() {
                            let exportParent = parent.appendingPathComponent(String(index))
                            try FileManager.default.createDirectory(at: exportParent, withIntermediateDirectories: true)
                            let entries = body["files"] as! [[String: String]]
                            if let content = entries.first(where: { $0["path"]?.hasSuffix("keyboard.json") == true })?["content"] {
                                let keyboard = try JSONSerialization.jsonObject(with: Data(content.utf8)) as! [String: Any]
                                let usb = keyboard["usb"] as! [String: String]
                                guard usb["vid"] == "0xABCD", usb["pid"] == "0x002A" else { throw FirmwareExport.problem("QMK export lost USB IDs") }
                            } else {
                                guard entries.contains(where: { $0["path"]?.hasSuffix(".conf") == true && $0["content"]?.contains("CONFIG_USB_DEVICE_VID=0xABCD\nCONFIG_USB_DEVICE_PID=0x002A\n") == true }) else { throw FirmwareExport.problem("ZMK export lost USB IDs") }
                            }
                            let files = entries.map { FirmwareExport.File(path: $0["path"]!, content: $0["content"]!) }
                            let name = body["name"] as! String
                            let first = try FirmwareExport.write(parent: exportParent, name: name, files: files)
                            let second = try FirmwareExport.write(parent: exportParent, name: name, files: files)
                            guard second.lastPathComponent == name + "-2" else { throw FirmwareExport.problem("export overwrites") }
                            for file in files {
                                guard try String(contentsOf: first.appendingPathComponent(file.path), encoding: .utf8) == file.content else { throw FirmwareExport.problem("UTF8 mismatch") }
                            }
                        }
                        print("PASS: \(data); native messages intercepted; UTF8 repositories written without overwrite")
                        guard CommandLine.arguments.count > 2 else { exit(0) }
                        let path = URL(fileURLWithPath: CommandLine.arguments[2]).deletingPathExtension().path
                        self.snapshot(path + ".png") {
                            self.web.evaluateJavaScript("document.querySelector('.firmware-pins').open=false;selected=new Set([state.keys.find(k=>!k.decal).id]);inspector();document.querySelector('.inspector').scrollTop=0") { _, _ in
                                self.snapshot(path + "-bindings.png") {
                                    self.web.evaluateJavaScript("document.getElementById('previewFirmware').click()") { _, _ in
                                        self.snapshot(path + "-preview.png") {
                                            self.web.evaluateJavaScript("document.getElementById('closeFirmwarePreview').click()") { _, _ in
                                                self.window.setContentSize(NSSize(width: 1100, height: 720))
                                                self.web.evaluateJavaScript("fit();draw();document.documentElement.scrollWidth<=window.innerWidth&&document.querySelector('.inspector').scrollWidth<=document.querySelector('.inspector').clientWidth") { value, error in
                                                    guard value as? Bool == true, error == nil else { print("FAIL: minimum window overflow"); exit(1) }
                                                    self.snapshot(path + "-minimum.png") {
                                                        // 重现用户截图：全部键未设行列，RP2040 的 R0 沿用接口 18。
                                                        self.web.evaluateJavaScript("FW.enableSplit(state.firmware,false);FW.switchController(state.firmware,'promicro_rp2040');state.firmware.rows=4;state.firmware.cols=12;state.firmware.rowPins=[18,null,null,null];state.firmware.colPins=Array(12).fill(null);for(const k of state.keys.filter(k=>!k.decal)){k.fw.row=null;k.fw.col=null;k.fw.bindings[0]={t:'none'};}document.querySelector('.firmware-pins').open=true;sync();fit();draw();document.querySelector('.inspector').scrollTop=0") { _, error in
                                                            guard error == nil else { print("FAIL: unassigned state"); exit(1) }
                                                            self.snapshot(path + "-unassigned.png") {
                                                                self.web.evaluateJavaScript("document.querySelector('.firmware-pins').scrollIntoView({block:'start'});document.querySelector('.inspector').scrollWidth<=document.querySelector('.inspector').clientWidth") { value, error in
                                                                    guard value as? Bool == true, error == nil else { print("FAIL: pin selector overflow"); exit(1) }
                                                                    self.snapshot(path + "-pins.png") { exit(0) }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } catch { print("FAIL: \(error)"); exit(1) }
                case .failure(let error): print("FAIL: \(error)"); exit(1)
                }
            }
        } catch { print("FAIL: \(error)"); exit(1) }
    }
    func snapshot(_ path: String, then: @escaping () -> Void) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            self.web.takeSnapshot(with: nil) { image, error in
                guard let tiff = image?.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) else { print("FAIL: snapshot \(String(describing: error))"); exit(1) }
                do { try png.write(to: URL(fileURLWithPath: path)); then() } catch { print("FAIL: \(error)"); exit(1) }
            }
        }
    }
}
@main
struct FirmwareSmokeMain {
    static func main() {
        let app = NSApplication.shared
        let smoke = FirmwareSmoke()
        app.delegate = smoke
        app.setActivationPolicy(.accessory)
        app.run()
    }
}
