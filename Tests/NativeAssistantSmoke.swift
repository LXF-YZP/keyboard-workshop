import AppKit
import WebKit

// 非持久化 WebView，截获所有桥接动作；不会接触用户工程、钥匙串或 GitHub。
final class AssistantSmoke: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    var web: WKWebView!, window: NSWindow!
    var messages = [[String: Any]]()
    var output: URL { URL(fileURLWithPath: CommandLine.arguments[2]) }
    func applicationDidFinishLaunching(_ note: Notification) {
        let config = WKWebViewConfiguration(); config.websiteDataStore = .nonPersistent(); config.userContentController.add(self, name: "workshop")
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1380, height: 900), configuration: config); web.navigationDelegate = self
        window = NSWindow(contentRect: web.frame, styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false); window.title = "独立工坊助手测试"; window.contentView = web; window.orderFront(nil)
        let root = URL(fileURLWithPath: CommandLine.arguments[1]); web.loadFileURL(root.appendingPathComponent("index.html"), allowingReadAccessTo: root)
        DispatchQueue.main.asyncAfter(deadline: .now() + 240) {
            let tail = self.messages.suffix(8).map { [$0["action"], $0["kind"], $0["operation"], $0["name"]].compactMap { $0 as? String }.joined(separator: ":") }
            print("FAIL: timeout after \(self.messages.count) intercepted messages; \(tail)"); exit(1)
        }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) { if let body = message.body as? [String: Any] { messages.append(body)
        if body["action"] as? String == "smokeStage" { print("CHECK: \(body["name"] as? String ?? "")") }
        if body["action"] as? String == "assistantRequest", let data = try? JSONSerialization.data(withJSONObject: body), let json = String(data: data, encoding: .utf8) { web.evaluateJavaScript("(window.__requests ||= []).push(\(json))", completionHandler: nil) }
        if ["assistantWorkflow", "assistantGitHub"].contains(body["action"] as? String ?? ""), let data = try? JSONSerialization.data(withJSONObject: body), let json = String(data: data, encoding: .utf8) { web.evaluateJavaScript("(window.__workflowRequests ||= []).push(\(json))", completionHandler: nil) }
        } }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let root = URL(fileURLWithPath: CommandLine.arguments[1]).deletingLastPathComponent()
        let script = try! String(contentsOf: root.appendingPathComponent("Tests/native-assistant-smoke.js"), encoding: .utf8)
        web.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
            do {
                let result = try result.get()
                guard !self.messages.contains(where: { ["githubPublish", "save", "saveFolder", "openImage", "recognize"].contains($0["action"] as? String ?? "") }) else { throw FirmwareExport.problem("assistant crossed capability boundary") }
                let requests = self.messages.filter { $0["action"] as? String == "assistantRequest" }
                for request in requests { _ = try AssistantAPI.validate(request) }
                print("PASS: \(result); \(requests.count) real bridge requests validated; no real writes/API/keychain")
                self.capture("assistant-proposal") {
                    self.window.setContentSize(NSSize(width: 1100, height: 720))
                    // A background WKWebView may suspend animation frames.
                    // Wait on the native run loop for resize before checking.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                        self.run("return window.__checkAssistantVisibility()") { value in
                            guard value as? Bool == true else { print("FAIL: drawer overflow"); exit(1) }
                            self.capture("assistant-minimum") { print("PASS: 1380/1100 assistant UI and candidate visibility"); exit(0) }
                        }
                    }
                }
            } catch { print("FAIL: \(error)"); exit(1) }
        }
    }
    func run(_ script: String, then: @escaping (Any) -> Void) { web.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in do { then(try result.get() as Any) } catch { print("FAIL: \(error)"); exit(1) } } }
    func capture(_ name: String, then: @escaping () -> Void) {
        // Force WebKit to finish pending canvas drawing before snapshotting.
        // A background accelerated canvas can otherwise show an older frame.
        run("return canvas.toDataURL('image/png').length > 0") { _ in
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            self.web.takeSnapshot(with: nil) { image, error in
                guard let tiff = image?.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) else { print("FAIL: snapshot \(String(describing: error))"); exit(1) }
                do { try png.write(to: self.output.appendingPathComponent(name + ".png")); then() } catch { print("FAIL: \(error)"); exit(1) }
            }
          }
        }
    }
}
@main enum AssistantSmokeMain { static func main() { let app = NSApplication.shared; let smoke = AssistantSmoke(); app.delegate = smoke; app.setActivationPolicy(.accessory); app.run() } }
