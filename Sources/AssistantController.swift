import AppKit
import Security

struct AssistantSettings: Codable {
    var endpoint = "https://api.openai.com/v1/chat/completions"
    var model = ""
    var tested = false
}

enum AssistantCredential {
    private static let service = "local.yuezhiping.keyboard-workshop.assistant"
    private static let account = "model-api-key"
    private static var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account] }
    static func read() -> String? {
        var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?; guard SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func write(_ value: String) throws {
        var q = query; q[kSecValueData as String] = Data(value.utf8); q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(q as CFDictionary, nil)
        if status == errSecDuplicateItem {
            guard SecItemUpdate(query as CFDictionary, [kSecValueData as String: Data(value.utf8)] as CFDictionary) == errSecSuccess else { throw AssistantAPI.problem("无法更新系统钥匙串。") }
        } else if status != errSecSuccess { throw AssistantAPI.problem("无法将 API Key 保存到系统钥匙串。") }
    }
    static func remove() { SecItemDelete(query as CFDictionary) }
}

// 禁止重定向，避免把认证头带到其他主机；无磁盘缓存、Cookie 或请求日志。
// 非流式请求在模型思考期间没有任何字节返回，超时需覆盖思考模型的整段推理。
final class AssistantAPI: NSObject, URLSessionTaskDelegate {
    lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.urlCache = nil; config.httpCookieStorage = nil; config.httpShouldSetCookies = false
        config.timeoutIntervalForRequest = 110; config.timeoutIntervalForResource = 120
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()
    static let names: Set<String> = ["inspect_project", "select_keys", "analyze_log", "propose_changes", "navigate", "propose_layout_changes", "propose_plate_changes", "propose_workshop_changes", "propose_firmware_changes", "project_workflow", "file_workflow", "image_workflow", "github_workflow"]
    static func problem(_ text: String) -> NSError { NSError(domain: "KeyboardWorkshop.Assistant", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }
    static func endpoint(_ value: String) throws -> URL {
        guard let url = URL(string: value), url.scheme == "https", let host = url.host, !host.isEmpty, url.user == nil, url.password == nil, url.query == nil, url.fragment == nil, url.path.hasSuffix("/chat/completions") else { throw problem("请填写 HTTPS Chat Completions 完整地址，以 /chat/completions 结尾，不含密码或查询参数。") }
        return url
    }
    static func validate(_ body: [String: Any]) throws -> ([[String: Any]], [[String: Any]]) {
        guard let messages = body["messages"] as? [[String: Any]], (2...70).contains(messages.count), messages.first?["role"] as? String == "system",
              let tools = body["tools"] as? [[String: Any]], tools.count == names.count else { throw problem("助手请求格式无效。") }
        let toolNames = tools.compactMap { ($0["function"] as? [String: Any])?["name"] as? String }
        guard Set(toolNames) == names, toolNames.count == tools.count else { throw problem("助手请求包含未授权工具。") }
        var ids = Set<String>(), waiting = Set<String>()
        for (index, message) in messages.enumerated() {
            guard let role = message["role"] as? String, ["system", "user", "assistant", "tool"].contains(role), (role != "system" || index == 0), Set(message.keys).isSubset(of: ["role", "content", "reasoning_content", "tool_calls", "tool_call_id"]) else { throw problem("消息角色或字段无效。") }
            if let content = message["content"], !(content is String) && !(content is NSNull) { throw problem("当前支持文字消息。图片请先用本机识别。") }
            if let reasoning = message["reasoning_content"], !(reasoning is String) && !(reasoning is NSNull) { throw problem("模型思考字段格式无效。") }
            if role == "tool" {
                guard let id = message["tool_call_id"] as? String, waiting.remove(id) != nil else { throw problem("工具结果与调用不匹配。") }
            } else if !waiting.isEmpty { throw problem("工具调用尚未返回结果。") }
            if let calls = message["tool_calls"] as? [[String: Any]] {
                guard role == "assistant", !calls.isEmpty, calls.count <= 8 else { throw problem("工具调用格式错误。") }
                for call in calls {
                    guard let id = call["id"] as? String, id.count <= 200, ids.insert(id).inserted, call["type"] as? String == "function", let fn = call["function"] as? [String: Any], let name = fn["name"] as? String, names.contains(name), let args = fn["arguments"] as? String, args.utf8.count <= 32000 else { throw problem("工具调用重复或未授权。") }
                    waiting.insert(id)
                }
            }
        }
        guard waiting.isEmpty else { throw problem("缺少工具返回结果。") }
        let data = try JSONSerialization.data(withJSONObject: ["messages": messages, "tools": tools])
        // 思考模型在同一轮工具往返中需带回 reasoning_content（中文按 UTF-8 每字 3 字节），预留余量。
        guard data.count <= 480000 else { throw problem("上下文过大，请开始新对话或缩短日志。") }
        return (messages, tools)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    @discardableResult func complete(settings: AssistantSettings, key: String, messages: [[String: Any]], tools: [[String: Any]], completion: @escaping (Result<[String: Any], Error>) -> Void) throws -> URLSessionDataTask {
        let url = try Self.endpoint(settings.endpoint)
        guard !settings.model.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, settings.model.count <= 200, !key.isEmpty, key.count <= 4096, !key.contains("\n"), !key.contains("\r") else { throw Self.problem("请在模型设置填写模型名称和有效 API Key。") }
        var request = URLRequest(url: url); request.httpMethod = "POST"; request.setValue("Bearer " + key, forHTTPHeaderField: "Authorization"); request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var payload: [String: Any] = ["model": settings.model, "messages": messages, "stream": false]
        // 不发送 tool_choice：省略时各服务默认 auto，而 DeepSeek 等思考模式（含经第三方网关
        // 转发）会拒绝任何显式取值。不要为个别服务重新加入 "none"、"required" 或指定函数。
        if !tools.isEmpty { payload["tools"] = tools }
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let task = session.dataTask(with: request) { data, response, error in
            let result: Result<[String: Any], Error>
            do {
                if let error {
                    let code = (error as NSError).code
                    throw Self.problem(code == NSURLErrorCancelled ? "请求已取消。" : code == NSURLErrorTimedOut ? "模型超过 2 分钟没有返回，可能是思考时间过长或网络较慢；请缩小问题后重试。" : "网络请求失败，请检查服务地址、网络或代理设置。")
                }
                guard let http = response as? HTTPURLResponse else { throw Self.problem("模型服务未返回 HTTP 响应。") }
                guard (200...299).contains(http.statusCode) else {
                    let hint = http.statusCode == 401 || http.statusCode == 403 ? "请检查 API Key 和模型权限。" : http.statusCode == 429 ? "额度或速率受限，请稍后重试。" : "请检查模型、服务地址和服务状态。"
                    let detail = data.flatMap { String(data: $0, encoding: .utf8) }?.replacingOccurrences(of: key, with: "[凭证已隐藏]").trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                    let safeDetail = String(detail.prefix(500)).replacingOccurrences(of: "\n", with: " ")
                    throw Self.problem("模型服务返回 HTTP \(http.statusCode)。\(hint)\(safeDetail.isEmpty ? "" : " 服务端信息：\(safeDetail)")")
                }
                guard let data, data.count <= 1000000, let raw = String(data: data, encoding: .utf8), let safe = raw.replacingOccurrences(of: key, with: "[凭证已隐藏]").data(using: .utf8), let object = try JSONSerialization.jsonObject(with: safe) as? [String: Any], let choices = object["choices"] as? [[String: Any]], let message = choices.first?["message"] as? [String: Any] else { throw Self.problem("模型返回格式无效，或响应超过 1 MB。") }
                guard message["role"] as? String == "assistant" else { throw Self.problem("模型消息角色无效。") }
                result = .success(message)
            } catch { result = .failure(error) }
            DispatchQueue.main.async { completion(result) }
        }
        task.resume(); return task
    }
}

final class AssistantController {
    let window: NSWindow
    let file: URL
    let send: (String, Any) -> Void
    let api = AssistantAPI()
    var settings: AssistantSettings
    var requests = [String: URLSessionDataTask]()
    var testing: URLSessionDataTask?
    var testGeneration = UUID()
    init(window: NSWindow, directory: URL, send: @escaping (String, Any) -> Void) {
        self.window = window; self.file = directory.appendingPathComponent("assistant.json"); self.send = send
        self.settings = (try? JSONDecoder().decode(AssistantSettings.self, from: Data(contentsOf: file))) ?? AssistantSettings()
    }
    func persist() throws { try JSONEncoder().encode(settings).write(to: file, options: .atomic) }
    func state(message: String? = nil, error: Bool = false) {
        var payload: [String: Any] = ["configured": settings.tested && !settings.model.isEmpty && !(AssistantCredential.read() ?? "").isEmpty, "model": settings.model]
        if let message { payload["message"] = message; payload["error"] = error }; send("assistantState", payload)
    }
    func handle(_ body: [String: Any]) {
        switch body["action"] as? String {
        case "assistantState": state()
        case "assistantSettings": configure()
        case "assistantCancel": if let id = body["id"] as? String { requests.removeValue(forKey: id)?.cancel() }
        case "assistantRequest":
            guard let id = body["id"] as? String, id.count <= 100 else { return }
            do {
                guard requests.isEmpty, testing == nil, settings.tested else { throw AssistantAPI.problem("请等待当前请求结束，或先在模型设置完成连接测试。") }
                let (messages, tools) = try AssistantAPI.validate(body)
                guard let key = AssistantCredential.read(), !key.isEmpty else { throw AssistantAPI.problem("尚未配置 API Key，请打开模型设置。") }
                requests[id] = try api.complete(settings: settings, key: key, messages: messages, tools: tools) { [weak self] result in
                    guard let self, self.requests.removeValue(forKey: id) != nil else { return }
                    switch result { case .success(let message): self.send("assistantResponse", ["id": id, "message": message] as [String: Any]); case .failure(let error): self.send("assistantResponse", ["id": id, "error": error.localizedDescription]) }
                }
            } catch { send("assistantResponse", ["id": id, "error": error.localizedDescription]) }
        default: break
        }
    }
    func configure() {
        guard requests.isEmpty else { state(message: "请先停止当前分析，再修改模型设置。", error: true); return }
        let alert = NSAlert(); alert.messageText = "工坊助手 · 模型设置"
        alert.informativeText = "使用兼容 Chat Completions 且支持工具调用的模型。服务商将收到你的问题、工程摘要、按需读取的配置和附加日志。API Key 仅保存到系统钥匙串。"
        alert.addButton(withTitle: "保存并测试"); alert.addButton(withTitle: "取消"); alert.addButton(withTitle: "移除密钥")
        let box = NSView(frame: NSRect(x: 0, y: 0, width: 460, height: 224))
        func field(_ title: String, _ value: String, _ y: CGFloat, secure: Bool = false) -> NSTextField {
            let label = NSTextField(labelWithString: title); label.frame = NSRect(x: 0, y: y + 30, width: 460, height: 18); label.font = .systemFont(ofSize: 12, weight: .semibold); box.addSubview(label)
            let input: NSTextField = secure ? NSSecureTextField() : NSTextField(); input.frame = NSRect(x: 0, y: y, width: 460, height: 26); input.stringValue = value; input.font = .systemFont(ofSize: 12); box.addSubview(input); return input
        }
        let url = field("API 完整地址（HTTPS）", settings.endpoint, 170)
        let model = field("模型名称", settings.model, 98); model.placeholderString = "填写服务商提供的模型 ID，需支持工具调用"
        let key = field("API Key（留空保留已保存密钥）", "", 26, secure: true); key.placeholderString = "密钥不会传给网页或保存在工程中"
        alert.accessoryView = box
        alert.beginSheetModal(for: window) { [weak self] answer in
            guard let self else { return }
            if answer == .alertThirdButtonReturn { self.testGeneration = UUID(); self.testing?.cancel(); self.testing = nil; AssistantCredential.remove(); self.settings.tested = false; try? self.persist(); self.state(message: "已移除模型 API Key，现有编辑功能可继续使用。"); return }
            guard answer == .alertFirstButtonReturn else { return }
            do {
                let endpoint = url.stringValue.trimmingCharacters(in: .whitespacesAndNewlines), modelName = model.stringValue.trimmingCharacters(in: .whitespacesAndNewlines), entered = key.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
                _ = try AssistantAPI.endpoint(endpoint)
                guard !modelName.isEmpty, modelName.count <= 200 else { throw AssistantAPI.problem("请填写有效的模型名称。") }
                if !entered.isEmpty { try AssistantCredential.write(entered) }
                guard let secret = AssistantCredential.read(), !secret.isEmpty else { throw AssistantAPI.problem("请填写 API Key。") }
                self.settings = AssistantSettings(endpoint: endpoint, model: modelName, tested: false); try self.persist(); self.test(key: secret)
            } catch { self.state(message: error.localizedDescription, error: true) }
        }
    }
    func test(key: String) {
        testGeneration = UUID(); let generation = testGeneration; testing?.cancel()
        let nonce = UUID().uuidString
        let parameters: [String: Any] = ["type": "object", "properties": ["nonce": ["type": "string", "enum": [nonce]] as [String: Any]], "required": ["nonce"], "additionalProperties": false]
        let function: [String: Any] = ["name": "workshop_probe", "description": "Return the supplied nonce to verify tool calling.", "parameters": parameters]
        let tools: [[String: Any]] = [["type": "function", "function": function]]
        let messages: [[String: Any]] = [["role": "system", "content": "Follow the requested tool protocol exactly."], ["role": "user", "content": "Call workshop_probe with nonce \(nonce). After its tool result, reply with exactly the tool result text."]]
        state(message: "正在测试模型工具调用与结果往返…")
        do {
            testing = try api.complete(settings: settings, key: key, messages: messages, tools: tools) { [weak self] result in
                guard let self, generation == self.testGeneration else { return }
                do {
                    let message = try result.get()
                    guard let calls = message["tool_calls"] as? [[String: Any]], calls.count == 1, let call = calls.first, call["type"] as? String == "function", let id = call["id"] as? String, let fn = call["function"] as? [String: Any], fn["name"] as? String == "workshop_probe", let args = fn["arguments"] as? String, let argData = args.data(using: .utf8), let parsed = try JSONSerialization.jsonObject(with: argData) as? [String: String], parsed == ["nonce": nonce] else { throw AssistantAPI.problem("模型未正确调用测试工具，请选择支持工具调用的模型。") }
                    let expected = "TOOL_OK_" + nonce
                    var assistantCall: [String: Any] = ["role": "assistant", "content": NSNull(), "tool_calls": calls]
                    if let reasoning = message["reasoning_content"] { assistantCall["reasoning_content"] = reasoning }
                    let next = messages + [assistantCall, ["role": "tool", "tool_call_id": id, "content": expected]]
                    // Keep the tool list for the normal tool-result round trip.
                    self.testing = try self.api.complete(settings: self.settings, key: key, messages: next, tools: tools) { [weak self] final in
                        guard let self, generation == self.testGeneration else { return }
                        self.testing = nil
                        do { let reply = try final.get(); guard reply["tool_calls"] == nil, let text = reply["content"] as? String, text.trimmingCharacters(in: .whitespacesAndNewlines) == expected else { throw AssistantAPI.problem("模型未正确理解工具返回结果，连接测试未通过。") }; self.settings.tested = true; try self.persist(); self.state(message: "连接测试通过：工具调用与结果往返正常。当前使用文字，图片请先本机识别。") }
                        catch { self.state(message: error.localizedDescription, error: true) }
                    }
                } catch { self.testing = nil; self.state(message: error.localizedDescription, error: true) }
            }
        } catch { testing = nil; state(message: error.localizedDescription, error: true) }
    }
}
