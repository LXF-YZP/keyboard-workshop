import AppKit
import WebKit

// Non-persistent WebView and intercepted bridge keep real projects untouched.
final class PlateCADSmoke: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    var web: WKWebView!, window: NSWindow!
    var output: URL { URL(fileURLWithPath: CommandLine.arguments[2]) }
    func applicationDidFinishLaunching(_ note: Notification) {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.add(self, name: "workshop")
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1380, height: 900), configuration: config)
        web.navigationDelegate = self
        window = NSWindow(contentRect: web.frame, styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.contentView = web; window.title = "CAD 独立界面测试"; window.orderFront(nil)
        let root = URL(fileURLWithPath: CommandLine.arguments[1])
        web.loadFileURL(root.appendingPathComponent("index.html"), allowingReadAccessTo: root)
        DispatchQueue.main.asyncAfter(deadline: .now() + 60) { print("FAIL: CAD smoke timeout"); exit(1) }
    }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], ["openDXF", "save"].contains(body["action"] as? String ?? ""),
              let data = try? JSONSerialization.data(withJSONObject: body), let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("(window.__cadRequests ||= []).push(\(json))", completionHandler: nil)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let root = URL(fileURLWithPath: CommandLine.arguments[1]).deletingLastPathComponent()
        do {
            let script = try String(contentsOf: root.appendingPathComponent("Tests/native-plate-cad-smoke.js"), encoding: .utf8)
            let sample = try String(contentsOf: root.appendingPathComponent("示例/42键-TPS65.kle.json"), encoding: .utf8)
            web.callAsyncJavaScript(script, arguments: ["sample": sample], in: nil, in: .page) { result in
                do {
                    print("PASS: \(try result.get())")
                    self.capture("plate-cad-1380") {
                        self.window.setContentSize(NSSize(width: 1100, height: 720))
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                            self.web.evaluateJavaScript("fit(); window.__cadVisibility()") { value, error in
                                guard value as? Bool == true, error == nil else { print("FAIL: CAD minimum width overflow"); exit(1) }
                                self.capture("plate-cad-1100") { print("PASS: CAD 1380 / 1100 UI"); exit(0) }
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
                guard let tiff = image?.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) else { print("FAIL: CAD snapshot"); exit(1) }
                do { try png.write(to: self.output.appendingPathComponent(name + ".png")); then() } catch { print("FAIL: \(error)"); exit(1) }
            }
        }
    }
}
@main enum PlateCADSmokeMain { static func main() { let app = NSApplication.shared; let smoke = PlateCADSmoke(); app.delegate = smoke; app.setActivationPolicy(.accessory); app.run() } }
