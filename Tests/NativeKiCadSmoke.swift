import AppKit
import WebKit

// Isolated WebView: generated fixtures are written only below the supplied test directory.
final class KiCadSmoke: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    var web: WKWebView!, window: NSWindow!
    var exported = false
    var output: URL { URL(fileURLWithPath: CommandLine.arguments[2]) }
    func applicationDidFinishLaunching(_ note: Notification) {
        let config = WKWebViewConfiguration(); config.websiteDataStore = .nonPersistent(); config.userContentController.add(self, name: "workshop")
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1380, height: 900), configuration: config); web.navigationDelegate = self
        window = NSWindow(contentRect: web.frame, styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false); window.contentView = web; window.title = "KiCad 独立导出测试"; window.orderFront(nil)
        let root = URL(fileURLWithPath: CommandLine.arguments[1]); web.loadFileURL(root.appendingPathComponent("index.html"), allowingReadAccessTo: root)
        DispatchQueue.main.asyncAfter(deadline: .now() + 60) { print("FAIL: KiCad smoke timeout"); exit(1) }
    }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        if body["action"] as? String == "assistantWorkflow", let data = try? JSONSerialization.data(withJSONObject: body), let json = String(data: data, encoding: .utf8) { web.evaluateJavaScript("(window.__kicadRequests ||= []).push(\(json))", completionHandler: nil) }
        if body["action"] as? String == "smokeKiCadExport" {
            do {
                guard let name = body["name"] as? String, let entries = body["files"] as? [[String: String]] else { throw FirmwareExport.problem("Missing KiCad export") }
                let files = entries.map { FirmwareExport.File(path: $0["path"]!, content: $0["content"]!) }
                let directory = try FirmwareExport.write(parent: output, name: name, files: files)
                exported = true
                print("EXPORTED: \(directory.path) (\(files.count) files)")
            } catch { print("FAIL: \(error)"); exit(1) }
        }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let root = URL(fileURLWithPath: CommandLine.arguments[1]).deletingLastPathComponent()
        do {
            let script = try String(contentsOf: root.appendingPathComponent("Tests/native-kicad-smoke.js"), encoding: .utf8)
            let sample = try String(contentsOf: root.appendingPathComponent("示例/42键-TPS65.kle.json"), encoding: .utf8)
            web.callAsyncJavaScript(script, arguments: ["sample": sample], in: nil, in: .page) { result in
                do {
                    print("PASS: \(try result.get())")
                    guard self.exported else { print("FAIL: no KiCad fixture was saved"); exit(1) }
                    self.capture("kicad-preview") {
                        self.window.setContentSize(NSSize(width: 1100, height: 720))
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                            self.web.evaluateJavaScript("window.__kicadVisibility()") { value, error in
                                guard value as? Bool == true, error == nil else { print("FAIL: minimum dialog overflow"); exit(1) }
                                self.capture("kicad-minimum") { print("PASS: KiCad 1380 / 1100 UI"); exit(0) }
                            }
                        }
                    }
                } catch { print("FAIL: \(error)"); exit(1) }
            }
        } catch { print("FAIL: \(error)"); exit(1) }
    }
    func capture(_ name: String, then: @escaping () -> Void) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            self.web.takeSnapshot(with: nil) { image, error in
                guard let tiff = image?.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) else { print("FAIL: snapshot \(String(describing: error))"); exit(1) }
                do { try png.write(to: self.output.appendingPathComponent(name + ".png")); then() } catch { print("FAIL: \(error)"); exit(1) }
            }
        }
    }
}
@main enum KiCadSmokeMain { static func main() { let app = NSApplication.shared; let smoke = KiCadSmoke(); app.delegate = smoke; app.setActivationPolicy(.accessory); app.run() } }
