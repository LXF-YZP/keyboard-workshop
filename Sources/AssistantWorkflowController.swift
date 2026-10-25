import AppKit
import UniformTypeIdentifiers

// File dialogs and on-device Vision are isolated from both the model transport
// and the live project. Results carry a request id and become webpage drafts.
final class AssistantWorkflowController {
    let window: NSWindow
    let emit: (String, Any) -> Void
    let pasteboard: () -> NSPasteboard
    var active: String?
    var panel: NSSavePanel?
    init(window: NSWindow, pasteboard: @escaping () -> NSPasteboard = { .general }, emit: @escaping (String, Any) -> Void) { self.window = window; self.pasteboard = pasteboard; self.emit = emit }
    func finish(_ id: String, _ payload: [String: Any]) {
        guard active == id else { return }
        active = nil; panel = nil
        var value = payload; value["requestId"] = id
        emit("assistantWorkflowResult", value)
    }
    func cancel(_ id: String) {
        guard active == id else { return }
        panel?.cancel(nil)
        finish(id, ["status": "cancelled", "message": "已取消本机流程。"])
    }
    func handle(_ body: [String: Any]) {
        guard let id = body["requestId"] as? String, id.count <= 120 else { return }
        guard active == nil, window.attachedSheet == nil else {
            emit("assistantWorkflowResult", ["requestId": id, "error": "已有系统窗口或本机识别正在进行，请完成后再继续。"]); return
        }
        active = id
        do {
            switch body["kind"] as? String {
            case "open":
                let dialog = NSOpenPanel(); dialog.allowedContentTypes = [.json, .plainText]; dialog.allowsMultipleSelection = false; panel = dialog
                dialog.beginSheetModal(for: window) { response in
                    guard response == .OK, let url = dialog.url else { self.finish(id, ["status": "cancelled"]); return }
                    do {
                        let data = try Data(contentsOf: url)
                        guard data.count < 25 * 1024 * 1024, let text = String(data: data, encoding: .utf8) else { throw ImageAnalyzer.problem("文件过大或不是 UTF-8 文本。") }
                        self.finish(id, ["status": "complete", "text": text, "name": url.deletingPathExtension().lastPathComponent])
                    } catch { self.finish(id, ["error": error.localizedDescription]) }
                }
            case "save":
                guard let content = body["content"] as? String, content.utf8.count < 25 * 1024 * 1024, let name = body["name"] as? String else { throw ImageAnalyzer.problem("导出内容无效或过大。") }
                let dialog = NSSavePanel(); dialog.nameFieldStringValue = (name as NSString).lastPathComponent; dialog.canCreateDirectories = true; panel = dialog
                dialog.beginSheetModal(for: window) { response in
                    guard response == .OK, let url = dialog.url else { self.finish(id, ["status": "cancelled"]); return }
                    guard self.active == id else { return }
                    do { try content.write(to: url, atomically: true, encoding: .utf8); self.finish(id, ["status": "complete", "name": url.lastPathComponent, "message": "已保存：" + url.lastPathComponent]) }
                    catch { self.finish(id, ["error": error.localizedDescription]) }
                }
            case "folder":
                guard let name = body["name"] as? String, let entries = body["files"] as? [[String: String]] else { throw ImageAnalyzer.problem("导出内容无效。") }
                let files = entries.compactMap { entry -> FirmwareExport.File? in guard let path = entry["path"], let content = entry["content"] else { return nil }; return .init(path: path, content: content) }
                guard files.count == entries.count else { throw ImageAnalyzer.problem("导出文件无效。") }
                try FirmwareExport.validate(name: name, files: files)
                let dialog = NSOpenPanel(); dialog.canChooseDirectories = true; dialog.canChooseFiles = false; dialog.canCreateDirectories = true; dialog.allowsMultipleSelection = false; dialog.message = "创建固件目录“\(name)”，不覆盖已有目录。"; panel = dialog
                dialog.beginSheetModal(for: window) { response in
                    guard response == .OK, let url = dialog.url else { self.finish(id, ["status": "cancelled"]); return }
                    guard self.active == id else { return }
                    do { let root = try FirmwareExport.write(parent: url, name: name, files: files); self.finish(id, ["status": "complete", "name": root.lastPathComponent, "message": "已导出固件：" + root.path]) }
                    catch { self.finish(id, ["error": error.localizedDescription]) }
                }
            case "image":
                if body["operation"] as? String == "paste" {
                    guard let source = try ImageAnalyzer.clipboardSource(pasteboard()) else { throw ImageAnalyzer.problem("剪贴板中没有图片。") }
                    loadImage(source, name: "聊天粘贴截图", id: id)
                } else {
                    let dialog = NSOpenPanel(); dialog.allowedContentTypes = [.image]; dialog.allowsMultipleSelection = false; panel = dialog
                    dialog.beginSheetModal(for: window) { response in
                        guard response == .OK, let url = dialog.url else { self.finish(id, ["status": "cancelled"]); return }
                        self.loadImage(.file(url), name: url.deletingPathExtension().lastPathComponent, id: id)
                    }
                }
            case "recognize", "labels":
                guard let dataURL = body["data"] as? String, dataURL.count < 25 * 1024 * 1024,
                      dataURL.hasPrefix("data:image/"), let comma = dataURL.firstIndex(of: ","),
                      let bytes = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])) else { throw ImageAnalyzer.problem("图片数据无效。") }
                let (image, _) = try ImageAnalyzer.load(.data(bytes))
                let labels = body["kind"] as? String == "labels"
                let regions = body["regions"] as? [[String: Any]] ?? []
                guard !labels || regions.count <= 500 else { throw ImageAnalyzer.problem("一次最多识别 500 个键。") }
                DispatchQueue.global(qos: .userInitiated).async {
                    do {
                        let result: [String: Any] = labels ? ["labels": ImageAnalyzer.readLabels(image, regions: regions)] : ["vision": try ImageAnalyzer.analyze(image)]
                        DispatchQueue.main.async { self.finish(id, result) }
                    } catch { DispatchQueue.main.async { self.finish(id, ["error": error.localizedDescription]) } }
                }
            default: throw ImageAnalyzer.problem("未授权的本机流程。")
            }
        } catch { finish(id, ["error": error.localizedDescription]) }
    }
    func loadImage(_ source: ImageAnalyzer.Source, name: String, id: String) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let (image, png) = try ImageAnalyzer.load(source)
                let vision = try ImageAnalyzer.analyze(image)
                let payload: [String: Any] = ["name": name, "data": "data:image/png;base64," + png.base64EncodedString(), "width": image.width, "height": image.height]
                DispatchQueue.main.async { self.finish(id, ["image": payload, "vision": vision]) }
            } catch { DispatchQueue.main.async { self.finish(id, ["error": error.localizedDescription]) } }
        }
    }
}
